export interface TypeNode {
	readonly kind: string;
	name: string | undefined;
	parentNamespaces: string[] | undefined;
}
