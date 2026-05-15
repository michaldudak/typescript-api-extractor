import ts, { FunctionDeclaration } from 'typescript';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';
import {
	FunctionNode,
	CallSignature,
	Documentation,
	DocumentationTag,
	Parameter,
	Visibility,
} from '../models';
import { ParserError } from '../ParserError';
import { getFullName } from './common';
import { TypeName } from '../models/typeName';
import { parseSignatureTypeParameters } from './signatureParser';

export function parseFunctionType(type: ts.Type, context: ParserContext): FunctionNode | undefined {
	const parsedCallSignatures = type.getCallSignatures().map((signature) => {
		return new CallSignature(
			signature.parameters.map((parameterSymbol) => parseParameter(parameterSymbol, context)),
			parseReturnType(signature, context),
			parseSignatureTypeParameters(signature, context),
		);
	});

	if (parsedCallSignatures.length === 0) {
		return;
	}

	const symbol = type.aliasSymbol ?? type.getSymbol();

	const fqn = getFullName(type, undefined, context);

	let name = fqn?.name;

	// Functions with `export default` are named "default" in the type checker.
	// Their original name is stored in the value declaration.
	if (name === 'default') {
		name =
			(symbol?.valueDeclaration as FunctionDeclaration | undefined)?.name?.getText() ?? 'default';
	}

	const typeName =
		name !== undefined ? new TypeName(name, fqn?.namespaces, fqn?.typeArguments) : undefined;

	return new FunctionNode(typeName, parsedCallSignatures);
}

function parseReturnType(signature: ts.Signature, context: ParserContext) {
	const returnTypeNode = getReturnTypeNode(signature);
	if (returnTypeNode) {
		context.sourceNodeStack.push(returnTypeNode);
	}

	try {
		return resolveType(signature.getReturnType(), returnTypeNode, context);
	} finally {
		if (returnTypeNode) {
			context.sourceNodeStack.pop();
		}
	}
}

function getReturnTypeNode(signature: ts.Signature): ts.TypeNode | undefined {
	const declaration = signature.getDeclaration();
	return declaration && 'type' in declaration ? declaration.type : undefined;
}

function parseParameter(parameterSymbol: ts.Symbol, context: ParserContext): Parameter {
	const { checker, parsedSymbolStack, sourceNodeStack } = context;
	parsedSymbolStack.push(`parameter: ${parameterSymbol.name}`);

	try {
		const parameterDeclaration = parameterSymbol.valueDeclaration as ts.ParameterDeclaration;
		sourceNodeStack.push(parameterDeclaration.type ?? parameterDeclaration);

		try {
			const parameterType = resolveType(
				checker.getTypeOfSymbolAtLocation(parameterSymbol, parameterSymbol.valueDeclaration!),
				parameterDeclaration.type,
				context,
			);

			const summary = parameterSymbol
				.getDocumentationComment(checker)
				.map((comment) => comment.text)
				.join('\n')
				.replace(/^[\s-*:]*/, '');

			const rawTags = parameterSymbol.getJsDocTags();

			const docTags: DocumentationTag[] = rawTags
				.filter((t) => t.name !== 'param')
				.map((t) => {
					const text = t.text?.map((t) => t.text).join(' ');
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

			const documentation =
				summary?.length || docTags.length
					? new Documentation(summary, undefined, visibility, docTags)
					: undefined;

			let defaultValue: string | undefined;
			const initializer = parameterDeclaration.initializer;
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
				}
			}

			return new Parameter(
				parameterType,
				parameterSymbol.getName(),
				documentation,
				parameterDeclaration.questionToken !== undefined ||
					parameterDeclaration.initializer !== undefined,
				defaultValue,
			);
		} finally {
			sourceNodeStack.pop();
		}
	} catch (error) {
		if (!(error instanceof ParserError)) {
			throw new ParserError(error, parsedSymbolStack);
		}

		throw error;
	} finally {
		parsedSymbolStack.pop();
	}
}
