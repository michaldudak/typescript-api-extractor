import { ArrayNode } from './array';
import { ComponentNode } from './component';
import { FunctionNode } from './function';
import { FunctionTypeNode } from './functionType';
import { HookNode } from './hook';
import { InterfaceNode } from './interface';
import { LiteralNode } from './literal';
import { MemberNode } from './member';
import { ObjectNode } from './object';
import { ParameterNode } from './parameter';
import { ProgramNode } from './program';
import { IntrinsicNode } from './intrinsic';
import { UnionNode } from './union';
import { ReferenceNode } from './reference';
import { EnumNode } from './enum';
import { TupleNode } from './tuple';

export type TypeNode =
	| ArrayNode
	| FunctionTypeNode
	| InterfaceNode
	| IntrinsicNode
	| LiteralNode
	| ObjectNode
	| ReferenceNode
	| TupleNode
	| UnionNode
	| EnumNode;

export type Node =
	| TypeNode
	| FunctionNode
	| ComponentNode
	| HookNode
	| MemberNode
	| ParameterNode
	| ProgramNode;
