import ts from 'typescript';
import * as t from '../types';

export function getDocumentationFromSymbol(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): t.Documentation | undefined {
	if (!symbol) {
		return undefined;
	}

	const decl = symbol.getDeclarations();
	if (decl) {
		return getDocumentationFromNode(decl[0]);
	}

	const comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
	return comment ? new t.Documentation(comment) : undefined;
}

export function getDocumentationFromNode(node: ts.Node): t.Documentation | undefined {
	const comments = ts.getJSDocCommentsAndTags(node);
	if (comments && comments.length === 1) {
		const commentNode = comments[0];
		if (ts.isJSDoc(commentNode)) {
			const tags = commentNode.tags
				?.filter(
					(tag) =>
						!['default', 'private', 'internal', 'public', 'param'].includes(tag.tagName.text),
				)
				.map(parseTag);

			return new t.Documentation(
				commentNode.comment as string | undefined,
				commentNode.tags?.find((t) => t.tagName.text === 'default')?.comment,
				getVisibilityFromJSDoc(commentNode) ?? 'public',
				tags ?? [],
			);
		}
	}
}

function getVisibilityFromJSDoc(doc: ts.JSDoc): t.Documentation['visibility'] | undefined {
	if (doc.tags?.some((tag) => tag.tagName.text === 'public')) {
		return 'public';
	}

	if (doc.tags?.some((tag) => tag.tagName.text === 'internal')) {
		return 'internal';
	}

	if (doc.tags?.some((tag) => tag.tagName.text === 'private')) {
		return 'private';
	}

	return undefined;
}

export function getParameterDescriptionFromNode(node: ts.Node) {
	const comments = ts.getJSDocCommentsAndTags(node);
	if (comments && comments.length >= 1) {
		const commentNode = comments[0];
		if (ts.isJSDoc(commentNode)) {
			const paramComments: Record<string, string> = {};
			commentNode.tags?.forEach((tag) => {
				if (ts.isJSDocParameterTag(tag) && typeof tag.comment === 'string') {
					paramComments[tag.name.getText()] = tag.comment.replace(/^[\s-*:]+/g, '');
				}
			});

			return paramComments;
		}
	}

	return {};
}

function parseTag(tag: ts.JSDocTag): t.DocumentationTag {
	if (ts.isJSDocTypeTag(tag)) {
		return {
			name: tag.tagName.text,
			value: tag.typeExpression?.type.getText(),
		};
	}

	return {
		name: tag.tagName.text,
		value: typeof tag.comment === 'string' ? tag.comment : undefined,
	};
}
