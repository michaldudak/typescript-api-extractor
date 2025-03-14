import { ArrayNode } from './array';
import { ComponentNode } from './component';
import { EnumNode } from './enum';
import { ExportNode } from './export';
import { FunctionNode } from './function';
import { IntrinsicNode } from './intrinsic';
import { LiteralNode } from './literal';
import { MemberNode } from './member';
import { ModuleNode } from './module';
import { ObjectNode } from './object';
import { ParameterNode } from './parameter';
import { ProgramNode } from './program';
import { ReferenceNode } from './reference';
import { TupleNode } from './tuple';
import { TypeParameterNode } from './typeParameter';
import { UnionNode } from './union';

export type TypeNode =
	| ArrayNode
	| ComponentNode
	| EnumNode
	| FunctionNode
	| IntrinsicNode
	| LiteralNode
	| ObjectNode
	| ReferenceNode
	| TupleNode
	| TypeParameterNode
	| UnionNode;

export type Node = TypeNode | ExportNode | MemberNode | ParameterNode | ProgramNode | ModuleNode;

export interface BaseNode {
	toObject(): Record<string, unknown>;
}
