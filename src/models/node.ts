import { TypeName } from './typeName';
import { ArrayNode } from './types/array';
import { ComponentNode } from './types/component';
import { EnumNode } from './types/enum';
import { ExternalTypeNode } from './types/external';
import { FunctionNode } from './types/function';
import { IntersectionNode } from './types/intersection';
import { IntrinsicNode } from './types/intrinsic';
import { LiteralNode } from './types/literal';
import { ObjectNode } from './types/object';
import { TupleNode } from './types/tuple';
import { TypeParameterNode } from './types/typeParameter';
import { UnionNode } from './types/union';

export interface TypeNode {
	readonly kind: string;
	typeName: TypeName | undefined;
}

export type AnyType =
	| ArrayNode
	| ComponentNode
	| EnumNode
	| ExternalTypeNode
	| FunctionNode
	| IntersectionNode
	| IntrinsicNode
	| LiteralNode
	| ObjectNode
	| TupleNode
	| TypeParameterNode
	| UnionNode;
