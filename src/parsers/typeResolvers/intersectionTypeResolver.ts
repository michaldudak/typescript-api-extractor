import { IntersectionNode, ObjectNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { resolveCallableType } from './functionTypeResolver';
import { resolveObjectLikeType } from './objectTypeResolver';

// Intersection handling stays separate because it composes several
// other type classes. It preserves explicit intersection members, then asks the
// function/object resolvers for any merged shape TypeScript exposes.

export function resolveIntersectionType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!type.isIntersection()) {
		return undefined;
	}

	const memberTypes = type.types.map((memberType) => session.resolve(memberType, undefined));

	if (memberTypes.length === 0) {
		throw new Error('Encountered an intersection type with no members');
	}

	if (memberTypes.length === 1) {
		return memberTypes[0];
	}

	const callSignatures = type.getCallSignatures();
	if (callSignatures.length >= 1) {
		return resolveCallableType({ type, typeName, typeNode: undefined }, session)!;
	}

	const objectType = resolveObjectLikeType({ type, typeName, typeNode: undefined }, session);
	if (objectType instanceof ObjectNode) {
		return new IntersectionNode(typeName, memberTypes, objectType.properties);
	}

	return new IntersectionNode(typeName, memberTypes, []);
}
