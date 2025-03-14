export interface TypeNode extends SerializableNode {
	readonly kind: string;
	name: string | undefined;
}

export interface SerializableNode {
	toObject(): Record<string, unknown>;
}
