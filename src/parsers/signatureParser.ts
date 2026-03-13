import ts from 'typescript';
import { type ParserContext } from '../parser';
import { type AnyType, TypeParameterNode } from '../models';
import { resolveType } from './typeResolver';

export function parseSignatureTypeParameters(
	signature: ts.Signature,
	context: ParserContext,
): TypeParameterNode[] | undefined {
	const typeParams = signature.typeParameters;
	if (!typeParams || typeParams.length === 0) {
		return undefined;
	}

	return typeParams.map((tp, index) => {
		const symbol = tp.symbol;
		let declaration: ts.TypeParameterDeclaration | undefined;
		const signatureDeclaration = signature.declaration;
		const signatureTypeParamNode =
			signatureDeclaration && signatureDeclaration.typeParameters
				? signatureDeclaration.typeParameters[index]
				: undefined;
		if (signatureTypeParamNode && ts.isTypeParameterDeclaration(signatureTypeParamNode)) {
			declaration = signatureTypeParamNode;
		} else if (symbol?.declarations && symbol.declarations.length > 0) {
			// Prefer the declaration whose parent matches the signature's own declaration,
			// since a symbol may have multiple declarations (e.g. merged interfaces).
			const candidates = symbol.declarations.filter(ts.isTypeParameterDeclaration);
			declaration = candidates.find((d) => d.parent === signatureDeclaration) ?? candidates[0];
		}
		let name = symbol?.name;
		if (!name && declaration && ts.isIdentifier(declaration.name)) {
			name = declaration.name.text;
		}
		if (!name) {
			name = `T${index}`;
		}

		let constraint: AnyType | undefined;
		if (declaration?.constraint) {
			const constraintFromNode = context.checker.getTypeAtLocation(declaration.constraint);
			constraint = resolveType(constraintFromNode, declaration.constraint, context);

			// If the model couldn't faithfully represent the constraint (degraded to 'any'
			// but the source constraint isn't actually 'any'), fall back to the base constraint
			// which may expand to a representable form (e.g., 'keyof T' → string | number | symbol).
			if (
				constraint.kind === 'intrinsic' &&
				constraint.intrinsic === 'any' &&
				(constraintFromNode.flags & ts.TypeFlags.Any) === 0
			) {
				const baseConstraint = context.checker.getBaseConstraintOfType(tp);
				if (baseConstraint) {
					constraint = resolveType(baseConstraint, undefined, context);
				}
			}
		}

		return new TypeParameterNode(
			name,
			constraint,
			declaration?.default
				? resolveType(
						context.checker.getTypeAtLocation(declaration.default),
						declaration.default,
						context,
					)
				: undefined,
		);
	});
}
