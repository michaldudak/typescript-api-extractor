import { Node, TypeNode } from './node';

const typeString = 'tuple';

export interface TupleNode {
	nodeType: typeof typeString;
	types: TypeNode[];
}

export function tupleNode(types: TypeNode[]): TupleNode {
	return {
		nodeType: typeString,
		types,
	};
}

export function isTupleNode(node: Node): node is TupleNode {
	return node.nodeType === typeString;
}
