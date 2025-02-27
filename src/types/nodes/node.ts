import { ArrayNode } from './array';
import { ComponentNode } from './component';
import { FunctionNode } from './function';
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

export type TypeNode =
	| ArrayNode
	| FunctionNode
	| InterfaceNode
	| IntrinsicNode
	| LiteralNode
	| ObjectNode
	| ReferenceNode
	| UnionNode;

export type Node = TypeNode | ComponentNode | HookNode | MemberNode | ParameterNode | ProgramNode;
