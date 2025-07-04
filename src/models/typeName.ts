export class TypeName {
	public readonly name: string | undefined;
	public readonly namespaces: readonly string[] | undefined;

	constructor(name: string | undefined, namespaces: readonly string[] | undefined = undefined) {
		this.name = name;
		this.namespaces = namespaces;
	}

	toString(): string {
		if (!this.name) {
			return '';
		}

		if (!this.namespaces || this.namespaces.length === 0) {
			return this.name;
		}

		return `${this.namespaces.join('.')}.${this.name}`;
	}
}
