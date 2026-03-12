import ts from 'typescript';
import { type ParserContext } from '../parser';
import { TypeParameterNode } from '../models';
import { resolveType } from './typeResolver';

export function parseSignatureTypeParameters(
	signature: ts.Signature,
	context: ParserContext,
): TypeParameterNode[] {
	const typeParams = signature.typeParameters;
	if (!typeParams || typeParams.length === 0) {
		return [];
	}

	return typeParams.map((tp) => {
		const symbol = tp.symbol;
		const declaration = symbol?.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
		const name =
			symbol?.name ??
			(declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : '');

		let constraintType: ts.Type | undefined;
		if (declaration?.constraint) {
			const constraintFromNode = context.checker.getTypeAtLocation(declaration.constraint);
			const shouldUseBaseConstraint =
				(constraintFromNode.flags & ts.TypeFlags.Any) !== 0 ||
				(constraintFromNode.flags & ts.TypeFlags.Index) !== 0;

			if (shouldUseBaseConstraint) {
				const baseConstraint = context.checker.getBaseConstraintOfType(tp);
				constraintType = baseConstraint ?? constraintFromNode;
			} else {
				constraintType = constraintFromNode;
			}
		}

		return new TypeParameterNode(
			name,
			constraintType ? resolveType(constraintType, undefined, context) : undefined,
			declaration?.default
				? resolveType(context.checker.getTypeAtLocation(declaration.default), undefined, context)
				: undefined,
		);
	});
}
