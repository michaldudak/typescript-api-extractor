export class TypeName {
	public readonly name: string;
	public readonly namespaces: readonly string[] | undefined;

	constructor(name: string, namespaces: readonly string[] | undefined = undefined) {
		this.name = name;
		this.namespaces = namespaces;
	}

	toString(): string {
		if (!this.namespaces || this.namespaces.length === 0) {
			return this.name;
		}

		return `${this.namespaces.join('.')}.${this.name}`;
	}
}
