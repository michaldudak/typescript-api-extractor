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
	return comment ? { description: comment } : undefined;
}

export function getDocumentationFromNode(node: ts.Node): t.Documentation | undefined {
	const comments = ts.getJSDocCommentsAndTags(node);
	if (comments && comments.length === 1) {
		const commentNode = comments[0];
		if (ts.isJSDoc(commentNode)) {
			return {
				description: commentNode.comment as string | undefined,
				defaultValue: commentNode.tags?.find((t) => t.tagName.text === 'default')?.comment,
				visibility: getVisibilityFromJSDoc(commentNode),
			};
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
