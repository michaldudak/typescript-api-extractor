import { type TypeResolver } from '../typeResolutionTypes';
import { resolveArrayType } from './arrayTypeResolver';
import { resolveAuthoredKeyofAlias } from './authoredTypeAlias';
import { resolveClassType } from './classTypeResolver';
import { resolveEnumLikeType } from './enumTypeResolver';
import { resolveCallableType } from './functionTypeResolver';
import { resolveIntrinsicType } from './intrinsicTypeResolver';
import { resolveIntersectionType } from './intersectionTypeResolver';
import { resolveLiteralType } from './literalTypeResolver';
import { resolveObjectLikeType } from './objectTypeResolver';
import {
	resolveConditionalType,
	resolveIndexLikeType,
	resolveTypeParameterType,
} from './specialTypeResolvers';
import { resolveExternalType } from './externalTypeResolver';
import { resolveTupleType } from './tupleTypeResolver';
import { resolveTypeOperatorType } from './typeOperatorTypeResolver';
import { resolveUnionTypeNode } from './unionTypeResolver';

// Registry note: ordered from the most specific TS type shapes to broader
// fallbacks. Keep this list explicit so adding support for a new TypeScript
// shape does not require editing one long branch chain, and so resolver
// precedence is visible.
export const typeResolvers: TypeResolver[] = [
	{
		name: 'authored-keyof-alias',
		replaysAuthoredSyntax: true,
		resolve: resolveAuthoredKeyofAlias,
	},
	{ name: 'external', resolve: resolveExternalType },
	{ name: 'type-operator', replaysAuthoredSyntax: true, resolve: resolveTypeOperatorType },
	{ name: 'type-parameter', resolve: resolveTypeParameterType },
	{ name: 'array', resolve: resolveArrayType },
	{ name: 'intrinsic', resolve: resolveIntrinsicType },
	{ name: 'enum', resolve: resolveEnumLikeType },
	{ name: 'union', resolve: resolveUnionTypeNode },
	{ name: 'intersection', resolve: resolveIntersectionType },
	{ name: 'tuple', resolve: resolveTupleType },
	{ name: 'literal', resolve: resolveLiteralType },
	{ name: 'callable', resolve: resolveCallableType },
	{ name: 'class', resolve: resolveClassType },
	{ name: 'object', resolve: resolveObjectLikeType },
	{
		name: 'conditional',
		replayNameResolutionWarnings: false,
		resolve: resolveConditionalType,
	},
	{ name: 'index-like', replayNameResolutionWarnings: false, resolve: resolveIndexLikeType },
];
