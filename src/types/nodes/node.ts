import { ArrayNode } from './array';
import { ComponentNode } from './component';
import { ExportNode } from './export';
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
import { EnumNode } from './enum';
import { TupleNode } from './tuple';
import { TypeParameterNode } from './typeParameter';
import { ModuleNode } from './module';

export type TypeNode =
	| ArrayNode
	| ComponentNode
	| EnumNode
	| FunctionNode
	| HookNode
	| InterfaceNode
	| IntrinsicNode
	| LiteralNode
	| ObjectNode
	| ReferenceNode
	| TupleNode
	| TypeParameterNode
	| UnionNode;

export type Node = TypeNode | ExportNode | MemberNode | ParameterNode | ProgramNode | ModuleNode;
