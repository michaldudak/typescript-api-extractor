import { Node } from './node';

const typeString = 'intrinsic';

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

export interface IntrinsicNode {
	nodeType: typeof typeString;
	type: IntrinsicType;
}

export function intrinsicNode(type: IntrinsicType): IntrinsicNode {
	return {
		nodeType: typeString,
		type,
	};
}

export function isIntrinsicNode(node: Node): node is IntrinsicNode {
	return node.nodeType === typeString;
}
