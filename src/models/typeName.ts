import { AnyType } from './node';

export class TypeName {
	public readonly name: string;
	public readonly namespaces: readonly string[] | undefined;
	public readonly typeArguments: readonly AnyType[] | undefined;

	constructor(
		name: string,
		namespaces: readonly string[] | undefined = undefined,
		typeArguments: readonly AnyType[] | undefined = undefined,
	) {
		this.name = name;
		this.namespaces = namespaces;
		this.typeArguments = typeArguments;
	}

	toString(): string {
		if (!this.namespaces || this.namespaces.length === 0) {
			return formatNameWithTypeArguments(this.name, this.typeArguments);
		}

		return `${this.namespaces.join('.')}.${formatNameWithTypeArguments(this.name, this.typeArguments)}`;
	}
}

function formatNameWithTypeArguments(
	name: string,
	typeArguments: readonly AnyType[] | undefined,
): string {
	if (!typeArguments || typeArguments.length === 0) {
		return name;
	}

	const args = typeArguments.map((arg) => arg.toString()).join(', ');
	return `${name}<${args}>`;
}
