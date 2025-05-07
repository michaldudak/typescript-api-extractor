import ts, { FunctionDeclaration } from 'typescript';
import { type ParserContext } from '../parser';
import { getTypeNamespaces, resolveType } from './typeResolver';
import { FunctionNode, CallSignature, Documentation, Parameter } from '../models';

export function parseFunctionType(type: ts.Type, context: ParserContext): FunctionNode | undefined {
	const parsedCallSignatures = type
		.getCallSignatures()
		.map((signature) => parseFunctionSignature(signature, context));

	if (parsedCallSignatures.length === 0) {
		return;
	}

	const symbol = type.aliasSymbol ?? type.getSymbol();
	let name = symbol?.getName();
	if (name === '__type') {
		name = undefined;
	}

	// Functions with `export default` are named "default" in the type checker.
	// Their original name is stored in the value declaration.
	if (name === 'default') {
		name =
			(symbol?.valueDeclaration as FunctionDeclaration | undefined)?.name?.getText() ?? 'default';
	}

	return new FunctionNode(name, getTypeNamespaces(type), parsedCallSignatures);
}

function parseFunctionSignature(
	signature: ts.Signature,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): CallSignature {
	// Node that possibly has JSDocs attached to it
	let documentationNodeCandidate: ts.Node | undefined = undefined;

	const functionDeclaration = signature.getDeclaration();
	if (ts.isFunctionDeclaration(functionDeclaration)) {
		// function foo(a: string) {}
		documentationNodeCandidate = functionDeclaration;
	} else if (
		ts.isFunctionExpression(functionDeclaration) ||
		ts.isArrowFunction(functionDeclaration)
	) {
		// const foo = function(a: string) {}
		// const foo = (a: string) => {}
		documentationNodeCandidate = functionDeclaration.parent;

		while (true) {
			// find the nearest variable declaration to look for JSDocs
			if (ts.isVariableStatement(documentationNodeCandidate)) {
				break;
			}

			if (ts.isSourceFile(documentationNodeCandidate)) {
				documentationNodeCandidate = undefined;
				break;
			}

			documentationNodeCandidate = documentationNodeCandidate?.parent;
		}
	}

	const parameters = signature.parameters.map((parameterSymbol) =>
		parseParameter(parameterSymbol, context, skipResolvingComplexTypes),
	);

	const returnValueType = resolveType(
		signature.getReturnType(),
		signature.getDeclaration().name?.getText() || '',
		context,
	);

	return new CallSignature(parameters, returnValueType);
}

function parseParameter(
	parameterSymbol: ts.Symbol,
	context: ParserContext,
	skipResolvingComplexTypes: boolean,
): Parameter {
	const { checker } = context;
	const parameterDeclaration = parameterSymbol.valueDeclaration as ts.ParameterDeclaration;
	const parameterType = resolveType(
		checker.getTypeOfSymbolAtLocation(parameterSymbol, parameterSymbol.valueDeclaration!),
		parameterSymbol.getName(),
		context,
		skipResolvingComplexTypes,
	);

	const summary = parameterSymbol
		.getDocumentationComment(checker)
		.map((comment) => comment.text)
		.join('\n')
		.replace(/^[\s-*:]*/, '');

	const documentation = summary?.length ? new Documentation(summary) : undefined;

	let defaultValue: string | undefined;
	const initializer = parameterDeclaration.initializer;
	if (initializer) {
		const initializerType = checker.getTypeAtLocation(initializer);
		if (initializerType.flags & ts.TypeFlags.Literal) {
			if (initializerType.isStringLiteral()) {
				defaultValue = `"${initializerType.value}"`;
			} else if (initializerType.isLiteral()) {
				defaultValue = initializerType.value.toString();
			} else {
				defaultValue = initializer.getText();
			}
		}
	}

	return new Parameter(
		parameterType,
		parameterSymbol.getName(),
		documentation,
		parameterDeclaration.questionToken !== undefined ||
			parameterDeclaration.initializer !== undefined,
		defaultValue,
	);
}
