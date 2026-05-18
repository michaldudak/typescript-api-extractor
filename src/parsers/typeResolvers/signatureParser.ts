import ts from 'typescript';
import { type ParserContext } from '../../parser';
import {
	CallSignature,
	Documentation,
	type DocumentationTag,
	Parameter,
	type Visibility,
	type AnyType,
} from '../../models';
import { ParserError } from '../../ParserError';
import { type ResolveTypeInContext } from '../typeResolutionTypes';
import { buildSignatureTypeParameterNodes } from './signatureTypeParameterNodes';

// Function-like signature parsing lives here so free functions, constructors,
// and class methods do not drift on parameter docs, defaults, or return types.

/**
 * Parses a TypeScript call signature into the API model. Handles function
 * declarations like `fn(value: string): number` and class methods like
 * `instance.update(value = 1): void`.
 */
export function parseCallSignature(
	signature: ts.Signature,
	context: ParserContext,
	resolveTypeReference: ResolveTypeInContext,
): CallSignature {
	return new CallSignature(
		signature.parameters.map((parameterSymbol) =>
			parseParameter(parameterSymbol, context, resolveTypeReference),
		),
		parseReturnType(signature, context, resolveTypeReference),
		buildSignatureTypeParameterNodes(signature, context, resolveTypeReference),
	);
}

/**
 * Parses a signature parameter and its local metadata. Handles examples like
 * `value?: string`, `options = { dense: true }`, and JSDoc `@param` comments
 * attached to either function parameters or class method parameters.
 */
export function parseParameter(
	parameterSymbol: ts.Symbol,
	context: ParserContext,
	resolveTypeReference: ResolveTypeInContext,
): Parameter {
	const { checker } = context;

	return context.runWithSymbolScope(`parameter: ${parameterSymbol.name}`, () => {
		try {
			const parameterDeclaration = getParameterDeclaration(parameterSymbol);
			const parameterSourceNode =
				parameterDeclaration?.type ?? parameterDeclaration ?? parameterSymbol.valueDeclaration;
			const typeLocation =
				parameterSymbol.valueDeclaration ?? parameterSymbol.declarations?.[0] ?? context.sourceFile;

			return context.runWithSourceNodeScope(parameterSourceNode, () => {
				const parameterType = resolveTypeReference(
					checker.getTypeOfSymbolAtLocation(parameterSymbol, typeLocation),
					parameterDeclaration?.type,
					context,
				);
				const documentation = parseParameterDocumentation(parameterSymbol, checker);
				const initializer = parameterDeclaration?.initializer;

				return new Parameter(
					parameterType,
					parameterSymbol.getName(),
					documentation,
					parameterDeclaration?.questionToken !== undefined || initializer !== undefined,
					parseParameterDefaultValue(initializer, checker),
				);
			});
		} catch (error) {
			// Parameter resolution is frequently nested several levels below the
			// exported symbol; wrapping unknown errors keeps that symbol stack in
			// the final diagnostic instead of losing the call-site breadcrumb trail.
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}

/**
 * Parses a signature return type. Handles examples like `(): Promise<Result>`
 * while using the explicit return annotation only as diagnostic source context,
 * not as a forced type node override.
 */
export function parseReturnType(
	signature: ts.Signature,
	context: ParserContext,
	resolveTypeReference: ResolveTypeInContext,
): AnyType {
	const returnTypeNode = getReturnTypeNode(signature);

	return context.runWithSourceNodeScope(returnTypeNode, () =>
		resolveTypeReference(signature.getReturnType(), undefined, context),
	);
}

/**
 * Builds documentation that belongs to a single parameter. Handles `@param`
 * summaries while preserving extra tags like `@public` or `@internal` as
 * parameter metadata rather than copying the parent function documentation.
 */
export function parseParameterDocumentation(
	parameterSymbol: ts.Symbol,
	checker: ts.TypeChecker,
): Documentation | undefined {
	const summary = parameterSymbol
		.getDocumentationComment(checker)
		.map((comment) => comment.text)
		.join('\n')
		.replace(/^[\s-*:]*/, '');

	const rawTags = parameterSymbol.getJsDocTags(checker);
	const docTags: DocumentationTag[] = rawTags
		.filter((tag) => tag.name !== 'param')
		.map((tag) => {
			const text = tag.text?.map((part) => part.text).join(' ');
			return {
				name: tag.name,
				value: text,
			};
		});
	const visibility = parseDocumentationVisibility(rawTags);

	if (!summary.length && docTags.length === 0) {
		return undefined;
	}

	// Keep an empty description for tag-only parameter docs. Existing snapshots
	// expose that shape for function parameters, so the shared parser preserves
	// it instead of silently changing serialized API output.
	return new Documentation(summary, undefined, visibility, docTags);
}

function getReturnTypeNode(signature: ts.Signature): ts.TypeNode | undefined {
	const declaration = signature.getDeclaration();
	return declaration && 'type' in declaration ? declaration.type : undefined;
}

function getParameterDeclaration(parameterSymbol: ts.Symbol): ts.ParameterDeclaration | undefined {
	const declaration = parameterSymbol.valueDeclaration ?? parameterSymbol.declarations?.[0];
	return declaration && ts.isParameter(declaration) ? declaration : undefined;
}

function parseDocumentationVisibility(tags: ts.JSDocTagInfo[]): Visibility | undefined {
	if (tags.some((tag) => tag.name === 'private')) {
		return 'private';
	}

	if (tags.some((tag) => tag.name === 'internal')) {
		return 'internal';
	}

	if (tags.some((tag) => tag.name === 'public')) {
		return 'public';
	}

	return undefined;
}

function parseParameterDefaultValue(
	initializer: ts.Expression | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	if (!initializer) {
		return undefined;
	}

	const initializerType = checker.getTypeAtLocation(initializer);
	if (initializerType.flags & ts.TypeFlags.Literal) {
		if (initializerType.isStringLiteral()) {
			return `"${initializerType.value}"`;
		}

		if (initializerType.isLiteral()) {
			return initializerType.value.toString();
		}
	}

	// Literal defaults are normalized above. For object, array, identifier, and
	// call-expression defaults, preserve the authored initializer text so every
	// signature owner exposes the same non-literal default information.
	return initializer.getText();
}
