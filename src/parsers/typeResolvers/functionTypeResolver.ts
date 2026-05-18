import ts, { FunctionDeclaration } from 'typescript';
import { type ParserContext } from '../../parser';
import {
	FunctionNode,
	CallSignature,
	Documentation,
	DocumentationTag,
	Parameter,
	Visibility,
	type AnyType,
} from '../../models';
import { ParserError } from '../../ParserError';
import { getFullName } from '../common';
import { TypeName } from '../../models/typeName';
import { buildSignatureTypeParameterNodes } from './signatureTypeParameterNodes';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';

// Callable type handling lives in one resolver module. The
// exported resolver selects call-signature types, while private helpers build
// FunctionNode, parameter, and return-type details within the active session.

export function resolveCallableType(
	{ type }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (type.getCallSignatures().length < 1) {
		return undefined;
	}

	return buildFunctionNodeFromType(type, session.context, session.resolveWithContext);
}

/**
 * Builds a FunctionNode after a resolver has selected a callable type. Nested
 * parameter and return types are resolved through the active session callback
 * so function construction does not restart resolution through the public API.
 */
function buildFunctionNodeFromType(
	type: ts.Type,
	context: ParserContext,
	resolveTypeReference: ResolveTypeInContext,
): FunctionNode | undefined {
	const parsedCallSignatures = type.getCallSignatures().map((signature) => {
		return new CallSignature(
			signature.parameters.map((parameterSymbol) =>
				buildParameterNode(parameterSymbol, context, resolveTypeReference),
			),
			buildReturnType(signature, context, resolveTypeReference),
			buildSignatureTypeParameterNodes(signature, context, resolveTypeReference),
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

function buildReturnType(
	signature: ts.Signature,
	context: ParserContext,
	resolveTypeReference: ResolveTypeInContext,
) {
	const returnTypeNode = getReturnTypeNode(signature);
	if (returnTypeNode) {
		context.sourceNodeStack.push(returnTypeNode);
	}

	try {
		return resolveTypeReference(signature.getReturnType(), undefined, context);
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

function buildParameterNode(
	parameterSymbol: ts.Symbol,
	context: ParserContext,
	resolveTypeReference: ResolveTypeInContext,
): Parameter {
	const { checker, parsedSymbolStack, sourceNodeStack } = context;
	parsedSymbolStack.push(`parameter: ${parameterSymbol.name}`);

	try {
		const parameterDeclaration = parameterSymbol.valueDeclaration as ts.ParameterDeclaration;
		sourceNodeStack.push(parameterDeclaration.type ?? parameterDeclaration);

		try {
			const parameterType = resolveTypeReference(
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
