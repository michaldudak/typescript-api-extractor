import ts from 'typescript';
import * as t from '../types';
import { type ParserContext } from '../parser';
import { getParameterDescriptionFromNode } from './documentationParser';
import { resolveType } from './typeResolver';

export function parseFunctionType(type: ts.Type, context: ParserContext) {
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

	return new t.FunctionNode(name, parsedCallSignatures);
}

function parseFunctionSignature(
	signature: ts.Signature,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): t.CallSignature {
	const { checker } = context;

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

	const parameterDescriptions = documentationNodeCandidate
		? getParameterDescriptionFromNode(documentationNodeCandidate)
		: {};

	const parameters = signature.parameters.map((parameterSymbol) => {
		const parameterDeclaration = parameterSymbol.valueDeclaration as ts.ParameterDeclaration;
		const parameterType = resolveType(
			checker.getTypeOfSymbolAtLocation(parameterSymbol, parameterSymbol.valueDeclaration!),
			parameterSymbol.getName(),
			context,
			skipResolvingComplexTypes,
		);

		const documentation: t.Documentation = {};
		documentation.description = parameterDescriptions[parameterSymbol.getName()];
		const initializer = parameterDeclaration.initializer;
		if (initializer) {
			const initializerType = checker.getTypeAtLocation(initializer);
			if (initializerType.flags & ts.TypeFlags.Literal) {
				if (initializerType.isStringLiteral()) {
					documentation.defaultValue = `"${initializer.getText()}"`;
				} else {
					documentation.defaultValue = initializer.getText();
				}
			}
		}

		const hasDocumentation = documentation.description || documentation.defaultValue;

		return new t.ParameterNode(
			parameterType,
			parameterSymbol.getName(),
			hasDocumentation ? documentation : undefined,
		);
	});

	const returnValueType = resolveType(
		signature.getReturnType(),
		signature.getDeclaration().name?.getText() || '',
		context,
	);

	return {
		parameters,
		returnValueType,
	};
}
