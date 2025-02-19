import { PropNode } from './prop';

export interface Node {
	type: string;
}

export interface DefinitionHolder extends Node {
	types: PropNode[];
}
