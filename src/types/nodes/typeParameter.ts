import { Node, TypeNode } from './node';

const typeString = 'typeParameter';

export interface TypeParameterNode {
	nodeType: typeof typeString;
	name: string;
	constraint: string | undefined;
	defaultValue: TypeNode | undefined;
}

export function typeParameterNode(
	name: string,
	constraint: string | undefined,
	defaultValue: TypeNode | undefined,
): TypeParameterNode {
	return {
		nodeType: typeString,
		name,
		constraint,
		defaultValue,
	};
}

export function isTypeParameterNode(node: Node): node is TypeParameterNode {
	return node.nodeType === typeString;
}
