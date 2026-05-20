import ts, { FunctionDeclaration } from 'typescript';
import { type ScopedParserContext } from '../../parserContext';
import { FunctionNode, type AnyType } from '../../models';
import { getFullName } from '../common';
import { TypeName } from '../../models/typeName';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';
import { parseCallSignature } from './signatureParser';

// Callable type handling lives in one resolver module. The
// exported resolver selects call-signature types, while signatureParser owns
// shared parameter, default, documentation, and return-type details.

export function resolveCallableType(
	{ type }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (type.getCallSignatures().length < 1) {
		return undefined;
	}

	return buildFunctionNodeFromType(type, session.context, session.resolveWithContext);
}

/**
 * Builds a FunctionNode after a resolver has selected a callable type. Nested
 * parameter and return types are resolved through the active session callback
 * so function construction does not restart resolution through the public API.
 */
function buildFunctionNodeFromType(
	type: ts.Type,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): FunctionNode | undefined {
	const parsedCallSignatures = type
		.getCallSignatures()
		.map((signature) => parseCallSignature(signature, context, resolveTypeReference));

	if (parsedCallSignatures.length === 0) {
		return;
	}

	const symbol = type.aliasSymbol ?? type.getSymbol();

	const fqn = getFullName(type, undefined, context);

	let name = fqn?.name;

	// Functions with `export default` are named "default" in the type checker.
	// Their original name is stored in the value declaration.
	if (name === 'default') {
		name =
			(symbol?.valueDeclaration as FunctionDeclaration | undefined)?.name?.getText() ?? 'default';
	}

	const typeName =
		name !== undefined ? new TypeName(name, fqn?.namespaces, fqn?.typeArguments) : undefined;

	return new FunctionNode(typeName, parsedCallSignatures);
}
