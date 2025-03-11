import ts from 'typescript';
import * as t from '../types';
import { type ParserContext } from '../parser';
import {
	getDocumentationFromNode,
	getDocumentationFromSymbol,
	getParameterDescriptionFromNode,
} from './documentationParser';
import { parseMember } from './memberParser';
import { resolveType } from './typeResolver';

export function parseComponentProps(
	componentName: string,
	propsType: ts.Type,
	sourceFile: ts.SourceFile | undefined,
	documentationNode: ts.Node | undefined,
	context: ParserContext,
) {
	const { checker, shouldInclude } = context;

	let allProperties: ts.Symbol[];
	if (propsType.isUnion()) {
		allProperties = propsType.types.flatMap((x) => x.getProperties());
	} else {
		allProperties = propsType.getProperties();
	}

	const filteredProperties = allProperties.filter(
		(symbol) =>
			shouldInclude({ name: symbol.getName(), depth: 1 }) &&
			(context.includeExternalTypes ||
				!symbol.declarations?.some((propDeclaration) =>
					propDeclaration.getSourceFile().fileName.includes('node_modules'),
				)),
	);

	if (filteredProperties.length === 0) {
		return;
	}

	const propsFilename = sourceFile !== undefined ? sourceFile.fileName : undefined;

	const docs = documentationNode
		? getDocumentationFromNode(documentationNode)
		: getDocumentationFromSymbol(
				checker.getSymbolAtLocation(propsType.symbol?.valueDeclaration!),
				checker,
			);

	return t.componentNode(
		componentName,
		filteredProperties.map((x) =>
			parseMember(x, x.valueDeclaration as ts.PropertySignature, context),
		),
		docs,
		propsFilename,
	);
}

export function parseFunction(
	node: ts.VariableDeclaration | ts.FunctionDeclaration,
	context: ParserContext,
) {
	const { checker, visitedNodes } = context;
	if (!node.name) {
		return;
	}

	const symbol = checker.getSymbolAtLocation(node.name);
	if (!symbol) {
		return;
	}

	// add all overloads to visited nodes
	for (const declaration of symbol.declarations?.filter(ts.isFunctionDeclaration) || []) {
		visitedNodes.add(declaration);
	}

	const functionName = node.name.getText();
	const type = checker.getTypeOfSymbolAtLocation(symbol, node);

	const parsedCallSignatures = type
		.getCallSignatures()
		.map((signature) => parseFunctionSignature(signature, context));

	if (parsedCallSignatures.length === 0) {
		return;
	}

	return t.functionNode(functionName, parsedCallSignatures, getDocumentationFromNode(node));
}

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

	return t.functionTypeNode(name, parsedCallSignatures);
}

export function parseFunctionComponent(
	node: ts.VariableDeclaration | ts.FunctionDeclaration,
	context: ParserContext,
) {
	const func = parseFunction(node, context);
	if (!func || !func.name) {
		return;
	}

	const props = squashComponentProps(func.callSignatures, context);
	return t.componentNode(func.name, props, func.documentation, node.getSourceFile().fileName);
}

export function parseHook(
	node: ts.VariableDeclaration | ts.FunctionDeclaration,
	context: ParserContext,
) {
	const func = parseFunction(node, context);
	if (!func || !func.name) {
		return;
	}

	return t.hookNode(func.name, func.callSignatures, func.documentation);
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

		return t.parameterNode(
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

function squashComponentProps(callSignatures: t.CallSignature[], context: ParserContext) {
	// squash props
	// { variant: 'a', href: string } & { variant: 'b' }
	// to
	// { variant: 'a' | 'b', href?: string }
	const props: Record<string, t.MemberNode> = {};
	const usedPropsPerSignature: Set<String>[] = [];

	function unwrapUnionType(type: t.UnionNode): t.InterfaceNode[] {
		return type.types
			.map((type) => {
				if (t.isInterfaceNode(type)) {
					return type;
				} else if (t.isUnionNode(type)) {
					return unwrapUnionType(type);
				}
			})
			.flat()
			.filter((t) => !!t);
	}

	const allParametersUnionMembers = callSignatures
		.map((signature) => {
			const propsParameter = signature.parameters[0];
			if (!propsParameter) {
				return undefined;
			}

			if (t.isInterfaceNode(propsParameter.type)) {
				return propsParameter.type;
			}

			if (t.isUnionNode(propsParameter.type)) {
				return unwrapUnionType(propsParameter.type);
			}
		})
		.flat()
		.filter((t) => !!t);

	allParametersUnionMembers.forEach((propUnionMember) => {
		const usedProps: Set<string> = new Set();

		propUnionMember.members.forEach((propNode) => {
			usedProps.add(propNode.name);

			let { [propNode.name]: currentTypeNode } = props;
			if (currentTypeNode === undefined) {
				currentTypeNode = propNode;
			} else if (currentTypeNode.$$id !== propNode.$$id) {
				let mergedPropType = t.unionNode(undefined, [currentTypeNode.type, propNode.type]);

				currentTypeNode = t.memberNode(
					currentTypeNode.name,
					mergedPropType.types.length === 1 ? mergedPropType.types[0] : mergedPropType,
					currentTypeNode.documentation,
					currentTypeNode.optional || propNode.optional,
					new Set(Array.from(currentTypeNode.filenames).concat(Array.from(propNode.filenames))),
					undefined,
				);
			}

			props[propNode.name] = currentTypeNode;
		});

		usedPropsPerSignature.push(usedProps);
	});

	const memberNodes = Object.entries(props).map(([name, propType]) => {
		const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
		if (onlyUsedInSomeSignatures) {
			// mark as optional
			return {
				...propType,
				type: t.unionNode(undefined, [propType.type, t.intrinsicNode('undefined')]),
				optional: true,
			};
		}

		return propType;
	});

	return memberNodes;
}
