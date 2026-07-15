import ts from 'typescript';

/** Returns whether TypeScript's semantic array target is the built-in readonly array. */
export function isSemanticallyReadonlyArray(type: ts.Type): boolean {
	const targetSymbol =
		type.flags & ts.TypeFlags.Object && 'target' in type
			? (type as ts.TypeReference).target.symbol
			: undefined;
	return (
		targetSymbol?.name === 'ReadonlyArray' &&
		Boolean(
			targetSymbol.declarations?.some((declaration) =>
				/[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName),
			),
		)
	);
}

/** Returns whether TypeScript's semantic tuple target is readonly. */
export function isSemanticallyReadonlyTuple(type: ts.Type): boolean {
	return 'target' in type && Boolean((type as ts.TupleTypeReference).target.readonly);
}

export interface TupleElementSyntax {
	typeNode: ts.TypeNode;
	isRest: boolean;
}

/** Removes named/rest/optional tuple wrappers while retaining authored rest metadata. */
export function unwrapTupleElementSyntax(typeNode: ts.TypeNode): TupleElementSyntax {
	let current = typeNode;
	let isRest = false;

	if (ts.isNamedTupleMember(current)) {
		isRest = current.dotDotDotToken != null;
		current = current.type;
	}

	while (ts.isOptionalTypeNode(current) || ts.isRestTypeNode(current)) {
		isRest ||= ts.isRestTypeNode(current);
		current = current.type;
	}

	return { typeNode: current, isRest };
}

export function isRestTupleElementNode(typeNode: ts.TypeNode): boolean {
	return unwrapTupleElementSyntax(typeNode).isRest;
}
