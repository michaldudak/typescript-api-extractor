import ts from 'typescript';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';
import {
	ClassNode,
	ConstructSignature,
	ClassProperty,
	ClassMethod,
	CallSignature,
	Parameter,
	Documentation,
	DocumentationTag,
	Visibility,
} from '../models';
import { getFullName } from './common';
import { TypeName } from '../models/typeName';
import { getDocumentationFromSymbol } from './documentationParser';

/**
 * Parses a TypeScript class type into a ClassNode.
 *
 * @param type - The TypeScript type representing the class (static side / constructor)
 * @param context - Parser context with type checker and other utilities
 * @returns ClassNode if the type is a class, undefined otherwise
 */
export function parseClassType(type: ts.Type, context: ParserContext): ClassNode | undefined {
	const constructSignatures = type.getConstructSignatures();
	if (constructSignatures.length === 0) {
		return undefined;
	}

	const symbol = type.getSymbol();
	if (!symbol) {
		return undefined;
	}

	// Ensure this is actually a class, not just an interface/type with construct signatures
	// (e.g., `interface Constructable { new (): Foo }` should not be treated as a class)
	const isClass = symbol.flags & ts.SymbolFlags.Class;
	if (!isClass) {
		// Double-check via declarations - some class expressions may not have the Class flag
		const hasClassDeclaration = symbol.declarations?.some(
			(decl) => ts.isClassDeclaration(decl) || ts.isClassExpression(decl),
		);
		if (!hasClassDeclaration) {
			return undefined;
		}
	}

	const fqn = getFullName(type, undefined, context);
	const typeName = fqn?.name
		? new TypeName(fqn.name, fqn.namespaces, fqn.typeArguments)
		: undefined;

	// Parse construct signatures
	const parsedConstructSignatures = constructSignatures.map((sig) =>
		parseConstructSignature(sig, context),
	);

	// Parse instance properties and methods
	const properties: ClassProperty[] = [];
	const methods: ClassMethod[] = [];

	// Get the instance type to extract instance members
	const instanceType = constructSignatures[0]?.getReturnType();
	if (instanceType) {
		extractMembers(instanceType, false, properties, methods, context);
	}

	// Extract static members from the class constructor type itself
	// Static members are properties of the class object, not instances
	extractMembers(type, true, properties, methods, context);

	// Extract type parameters from the class declaration
	let typeParameters: TypeName[] | undefined;
	const declaration = symbol.declarations?.[0];
	if (declaration && ts.isClassDeclaration(declaration) && declaration.typeParameters) {
		typeParameters = declaration.typeParameters.map(
			(tp) => new TypeName(tp.name.text, undefined, undefined),
		);
	}

	return new ClassNode(typeName, parsedConstructSignatures, properties, methods, typeParameters);
}

/**
 * Extracts properties and methods from a type and adds them to the provided arrays.
 * Used for both instance members and static members.
 */
function extractMembers(
	type: ts.Type,
	isStatic: boolean,
	properties: ClassProperty[],
	methods: ClassMethod[],
	context: ParserContext,
): void {
	const { checker } = context;

	const members = checker.getPropertiesOfType(type);

	for (const member of members) {
		// Skip private and internal members (JSDoc tags)
		const memberDoc = getDocumentationFromSymbol(member, checker);
		if (
			memberDoc?.visibility === 'private' ||
			memberDoc?.visibility === 'internal' ||
			memberDoc?.tags?.some((tag) => tag.name === 'ignore')
		) {
			continue;
		}

		// Skip members starting with underscore (private by convention)
		if (member.name.startsWith('_')) {
			continue;
		}

		// Skip built-in properties that appear on class constructors (for static members)
		// These are inherited from Function and shouldn't be documented as class members
		if (isStatic && ['prototype', 'length', 'name', 'arguments', 'caller'].includes(member.name)) {
			continue;
		}

		const memberDeclaration = member.valueDeclaration ?? member.declarations?.[0];
		if (!memberDeclaration) {
			continue;
		}

		// Skip TypeScript private/protected members
		if (ts.canHaveModifiers(memberDeclaration)) {
			const modifiers = ts.getModifiers(memberDeclaration);
			if (
				modifiers?.some(
					(m: ts.Modifier) =>
						m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
				)
			) {
				continue;
			}
		}

		const memberType = checker.getTypeOfSymbolAtLocation(member, memberDeclaration);

		// Check if it's a method - must be declared as a method, not just have call signatures
		// (function-typed properties like `foo: () => void` should remain as properties)
		const isMethodDeclaration =
			ts.isMethodDeclaration(memberDeclaration) || ts.isMethodSignature(memberDeclaration);

		const tsCallSignatures = memberType.getCallSignatures();
		if (isMethodDeclaration && tsCallSignatures.length > 0) {
			// It's a method - parse all signatures into CallSignature array
			const signatures: CallSignature[] = tsCallSignatures.map((sig) => {
				const params = sig.parameters.map((paramSymbol) => parseParameter(paramSymbol, context));
				const returnType = resolveType(sig.getReturnType(), undefined, context);
				return new CallSignature(params, returnType);
			});

			methods.push(new ClassMethod(member.name, signatures, memberDoc, isStatic));
		} else {
			// It's a property
			const resolvedType = resolveType(memberType, undefined, context);
			const isOptional = (member.flags & ts.SymbolFlags.Optional) !== 0;

			// Check readonly in multiple ways:
			// 1. PropertyDeclaration with readonly modifier
			// 2. ParameterDeclaration with readonly modifier (constructor parameter property)
			// 3. Getter-only accessor (has getter but no setter)
			let isReadonly = false;
			if (
				memberDeclaration &&
				ts.isPropertyDeclaration(memberDeclaration) &&
				memberDeclaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
			) {
				isReadonly = true;
			} else if (
				memberDeclaration &&
				ts.isParameter(memberDeclaration) &&
				memberDeclaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
			) {
				// Constructor parameter property with readonly
				isReadonly = true;
			} else if (memberDeclaration && ts.isGetAccessorDeclaration(memberDeclaration)) {
				// Check if there's a corresponding setter
				const hasSetter = member.declarations?.some((d) => ts.isSetAccessorDeclaration(d));
				if (!hasSetter) {
					isReadonly = true;
				}
			}

			properties.push(
				new ClassProperty(member.name, resolvedType, memberDoc, isOptional, isReadonly, isStatic),
			);
		}
	}
}

function parseConstructSignature(
	signature: ts.Signature,
	context: ParserContext,
): ConstructSignature {
	const { checker } = context;

	const parameters = signature.parameters.map((paramSymbol) =>
		parseParameter(paramSymbol, context),
	);

	// Get documentation from the constructor declaration if available
	const declaration = signature.getDeclaration();
	let documentation: Documentation | undefined;
	if (declaration && 'symbol' in declaration) {
		const symbol = declaration.symbol as ts.Symbol | undefined;
		if (symbol) {
			documentation = getDocumentationFromSymbol(symbol, checker);
		}
	}

	return new ConstructSignature(parameters, documentation);
}

function parseParameter(parameterSymbol: ts.Symbol, context: ParserContext): Parameter {
	const { checker } = context;

	const parameterDeclaration = parameterSymbol.valueDeclaration as ts.ParameterDeclaration;

	const parameterType = resolveType(
		checker.getTypeOfSymbolAtLocation(parameterSymbol, parameterSymbol.valueDeclaration!),
		parameterDeclaration?.type,
		context,
	);

	// Clean up summary - remove leading dashes, asterisks, colons, whitespace
	// (matches functionParser behavior)
	const summary = parameterSymbol
		.getDocumentationComment(checker)
		.map((comment) => comment.text)
		.join('\n')
		.replace(/^[\s-*:]*/, '');

	const rawTags = parameterSymbol.getJsDocTags(checker);

	// Preserve all JSDoc tags except @param (matches functionParser behavior)
	const docTags: DocumentationTag[] = rawTags
		.filter((t) => t.name !== 'param')
		.map((t) => {
			const text = t.text?.map((part) => part.text).join(' ');
			return {
				name: t.name,
				value: text,
			};
		});

	let visibility: Visibility | undefined;
	if (rawTags.some((tag) => tag.name === 'private')) {
		visibility = 'private';
	} else if (rawTags.some((tag) => tag.name === 'internal')) {
		visibility = 'internal';
	} else if (rawTags.some((tag) => tag.name === 'public')) {
		visibility = 'public';
	}

	const optional =
		parameterDeclaration?.questionToken !== undefined ||
		parameterDeclaration?.initializer !== undefined;

	// Handle default values - extract literal values when possible (matches functionParser)
	let defaultValue: string | undefined;
	const initializer = parameterDeclaration?.initializer;
	if (initializer) {
		const initializerType = checker.getTypeAtLocation(initializer);
		if (initializerType.flags & ts.TypeFlags.Literal) {
			if (initializerType.isStringLiteral()) {
				defaultValue = `"${initializerType.value}"`;
			} else if (initializerType.isLiteral()) {
				defaultValue = initializerType.value.toString();
			} else {
				defaultValue = initializer.getText();
			}
		} else {
			defaultValue = initializer.getText();
		}
	}

	const documentation =
		summary?.length || docTags.length
			? new Documentation(summary || undefined, undefined, visibility, docTags)
			: undefined;

	return new Parameter(parameterType, parameterSymbol.name, documentation, optional, defaultValue);
}
