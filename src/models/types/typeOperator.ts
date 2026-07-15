import { type AnyType, type TypeNode } from '../node';
import { type TypeName } from '../typeName';

/** TypeScript operators whose authored syntax is preserved in the output model. */
export type TypeOperator = 'keyof';

/** Provenance of a checker-resolved type-operator result. */
export type TypeOperatorResolutionKind = 'exact' | 'baseConstraint' | 'fallback';

/** Authored type-operator syntax with an optional checker-resolved result. */
export class TypeOperatorNode implements TypeNode {
	readonly kind = 'typeOperator';
	readonly typeName: TypeName | undefined;

	/**
	 * Creates a preserved type operator.
	 *
	 * @param typeName - Optional public alias name for the complete operator.
	 * @param operator - Authored TypeScript operator.
	 * @param type - Authored operator operand.
	 * @param resolvedType - Checker-resolved operator result, omitted in syntax-only output.
	 * @param resolutionKind - Provenance of `resolvedType`, omitted with the resolved result.
	 */
	constructor(
		typeName: TypeName | undefined,
		readonly operator: TypeOperator,
		readonly type: AnyType,
		readonly resolvedType?: AnyType,
		readonly resolutionKind: TypeOperatorResolutionKind | undefined = resolvedType
			? 'exact'
			: undefined,
	) {
		this.typeName = typeName?.name ? typeName : undefined;
	}

	/** @returns The authored operator expression or its public alias name. */
	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		const renderedType = this.type.toString();
		const operand = this.type.kind === 'function' ? `(${renderedType})` : renderedType;
		return `${this.operator} ${operand}`;
	}
}
