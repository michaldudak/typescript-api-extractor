import { TypeNode } from '../node';
import { TypeName } from '../typeName';

export class ExternalTypeNode implements TypeNode {
	readonly kind = 'external';

	constructor(public typeName: TypeName) {}
}
