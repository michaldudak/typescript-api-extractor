import ts from 'typescript';
import { Documentation, DocumentationTag } from '../models';

export function getDocumentationFromSymbol(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): Documentation | undefined {
	if (!symbol) {
		return undefined;
	}

	const decl = symbol.getDeclarations();
	if (decl) {
		return getDocumentationFromNode(decl[0]);
	}

	const comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
	return comment ? new Documentation(comment) : undefined;
}

export function getDocumentationFromNode(node: ts.Node): Documentation | undefined {
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

			return new Documentation(
				commentNode.comment as string | undefined,
				commentNode.tags?.find((t) => t.tagName.text === 'default')?.comment,
				getVisibilityFromJSDoc(commentNode),
				tags ?? [],
			);
		}
	}
}

function getVisibilityFromJSDoc(doc: ts.JSDoc): Documentation['visibility'] | undefined {
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

function parseTag(tag: ts.JSDocTag): DocumentationTag {
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
