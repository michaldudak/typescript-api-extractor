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
import { SimpleTypeNode } from './simpleType';
import { UnionNode } from './union';

export type TypeNode =
	| ArrayNode
	| FunctionNode
	| InterfaceNode
	| LiteralNode
	| ObjectNode
	| SimpleTypeNode
	| UnionNode;

export type Node = TypeNode | ComponentNode | HookNode | MemberNode | ParameterNode | ProgramNode;
