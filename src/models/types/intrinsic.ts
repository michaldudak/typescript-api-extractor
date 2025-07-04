import { TypeNode } from '../node';
import { TypeName } from '../typeName';

type IntrinsicType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'bigint'
	| 'null'
	| 'undefined'
	| 'void'
	| 'any'
	| 'unknown'
	| 'function';

export class IntrinsicNode implements TypeNode {
	readonly kind = 'intrinsic';
	typeName: TypeName | undefined;
	intrinsic: IntrinsicType;

	constructor(intrinsic: IntrinsicType, typeName: TypeName | undefined = undefined) {
		this.intrinsic = intrinsic;
		this.typeName = typeName?.name ? typeName : undefined;
	}
}
