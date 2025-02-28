import ts from 'typescript';
import * as t from './types';

/**
 * Options that specify how the parser should act
 */
export interface ParserOptions {
	/**
	 * Called before a PropType is added to a component/object
	 * @return true to include the PropType, false to skip it, or undefined to
	 * use the default behaviour
	 * @default name !== 'ref'
	 */
	shouldInclude: (data: { name: string; depth: number }) => boolean | undefined;
	/**
	 * Called before the shape of an object is resolved
	 * @return true to resolve the shape of the object, false to just use a object, or undefined to
	 * use the default behaviour
	 * @default propertyCount <= 50 && depth <= 3
	 */
	shouldResolveObject: (data: {
		name: string;
		propertyCount: number;
		depth: number;
	}) => boolean | undefined;
	/**
	 * Called before the shape of a function is resolved
	 * @return true to resolve the shape of the function, false to just use a Function, or undefined to
	 * use the default behaviour
	 * @default parameterCount <= 5 && depth <= 2
	 */
	shouldResolveFunction: (data: { name: string; depth: number }) => boolean | undefined;
	/**
	 * Control if const declarations should be checked
	 * @default false
	 * @example declare const Component: React.ComponentType<Props>;
	 */
	checkDeclarations?: boolean;
}

/**
 * A wrapper for `ts.createProgram`
 * @param files The files to later be parsed with `parseFromProgram`
 * @param options The options to pass to the compiler
 */
export function createProgram(files: string[], options: ts.CompilerOptions) {
	return ts.createProgram(files, options);
}

/**
 * Creates a program, parses the specified file and returns the PropTypes as an AST, if you need to parse more than one file
 * use `createProgram` and `parseFromProgram` for better performance
 * @param filePath The file to parse
 * @param options The options from `loadConfig`
 * @param parserOptions Options that specify how the parser should act
 */
export function parseFile(
	filePath: string,
	options: ts.CompilerOptions,
	parserOptions: Partial<ParserOptions> = {},
) {
	const program = ts.createProgram([filePath], options);
	return parseFromProgram(filePath, program, parserOptions);
}

/**
 * Parses the specified file and returns the PropTypes as an AST
 * @param filePath The file to get the PropTypes from
 * @param program The program object returned by `createProgram`
 * @param parserOptions Options that specify how the parser should act
 */
export function parseFromProgram(
	filePath: string,
	program: ts.Program,
	parserOptions: Partial<ParserOptions> = {},
) {
	const { checkDeclarations = false } = parserOptions;

	const shouldInclude: ParserOptions['shouldInclude'] = (data) => {
		if (parserOptions.shouldInclude) {
			const result = parserOptions.shouldInclude(data);
			if (result !== undefined) {
				return result;
			}
		}

		return data.name !== 'ref';
	};

	const shouldResolveObject: ParserOptions['shouldResolveObject'] = (data) => {
		if (parserOptions.shouldResolveObject) {
			const result = parserOptions.shouldResolveObject(data);
			if (result !== undefined) {
				return result;
			}
		}

		return data.propertyCount <= 50 && data.depth <= 3;
	};

	const shouldResolveFunction: ParserOptions['shouldResolveFunction'] = (data) => {
		if (parserOptions.shouldResolveFunction) {
			const result = parserOptions.shouldResolveFunction(data);
			if (result !== undefined) {
				return result;
			}
		}

		return data.depth <= 2;
	};

	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath);

	const programNode = t.programNode();
	const reactImports: string[] = [];
	const visitedNodes = new Set<number>();

	if (sourceFile) {
		ts.forEachChild(sourceFile, visitImports);
		ts.forEachChild(sourceFile, visit);
	} else {
		throw new Error(`Program doesn't contain file "${filePath}"`);
	}

	return programNode;

	function visitImports(node: ts.Node) {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			node.moduleSpecifier.text === 'react' &&
			node.importClause
		) {
			const imports = ['Component', 'PureComponent', 'memo', 'forwardRef'];

			// import x from 'react'
			if (node.importClause.name) {
				const nameText = node.importClause.name.text;
				reactImports.push(...imports.map((x) => `${nameText}.${x}`));
			}

			// import {x, y as z} from 'react'
			const bindings = node.importClause.namedBindings;
			if (bindings) {
				if (ts.isNamedImports(bindings)) {
					bindings.elements.forEach((spec) => {
						const nameIdentifier = spec.propertyName || spec.name;
						const nameText = nameIdentifier.getText();
						if (imports.includes(nameText)) {
							reactImports.push(spec.name.getText());
						}
					});
				}
				// import * as x from 'react'
				else {
					const nameText = bindings.name.text;
					reactImports.push(...imports.map((x) => `${nameText}.${x}`));
				}
			}
		}
	}

	function visit(node: ts.Node) {
		// A node can be processed while another node is visited.
		// If the node we're currently visiting has already been visited, skip it.
		if (visitedNodes.has(getNodeId(node))) {
			return;
		}

		if (ts.isFunctionDeclaration(node) && node.name) {
			if (node.name.getText().startsWith('use')) {
				// function useHook(parameters: type): type
				parseHook(node);
			} else if (node.parameters.length === 1) {
				// function x(props: type) { return <div/> }
				parseFunctionComponent(node, node);
			}
		}
		// const x = ...
		else if (ts.isVariableStatement(node)) {
			ts.forEachChild(node.declarationList, (variableNode) => {
				// x = (props: type) => { return <div/> }
				// x = function(props: type) { return <div/> }
				// x = function y(props: type) { return <div/> }
				// x = react.memo((props:type) { return <div/> })

				if (ts.isVariableDeclaration(variableNode) && variableNode.name) {
					const type = checker.getTypeAtLocation(variableNode.name);
					if (!variableNode.initializer) {
						if (
							checkDeclarations &&
							type.aliasSymbol &&
							type.aliasTypeArguments &&
							checker.getFullyQualifiedName(type.aliasSymbol) === 'React.ComponentType'
						) {
							parseComponentProps(
								variableNode.name.getText(),
								type.aliasTypeArguments[0],
								node.getSourceFile(),
							);
						} else if (checkDeclarations) {
							parseFunctionComponent(variableNode, node);
						}
					} else if (
						ts.isArrowFunction(variableNode.initializer) ||
						ts.isFunctionExpression(variableNode.initializer)
					) {
						if (variableNode.name.getText().startsWith('use')) {
							// const useHook = function useHook(parameters: type): type
							// const useHook = (parameters: type): type
							parseHook(variableNode);
						} else if (variableNode.initializer.parameters.length === 1) {
							// x = (props: type) => { return <div/> }
							// x = function(props: type) { return <div/> }
							// x = function y(props: type) { return <div/> }
							parseFunctionComponent(variableNode, node);
						}
					}
					// x = react.memo((props:type) { return <div/> })
					else if (
						ts.isCallExpression(variableNode.initializer) &&
						variableNode.initializer.arguments.length > 0
					) {
						const callString = variableNode.initializer.expression.getText();
						const arg = variableNode.initializer.arguments[0];
						if (
							reactImports.includes(callString) &&
							(ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
							arg.parameters.length > 0
						) {
							const propsType = checker.getTypeAtLocation(arg.parameters[0]);
							if (propsType) {
								parseComponentProps(
									variableNode.name.getText(),
									propsType,
									node.getSourceFile(),
									node,
								);
							}
						}
					}
				}
			});
		} else if (
			ts.isClassDeclaration(node) &&
			node.name &&
			node.heritageClauses &&
			node.heritageClauses.length === 1
		) {
			const heritage = node.heritageClauses[0];
			if (heritage.types.length !== 1) return;

			const arg = heritage.types[0];
			if (!arg.typeArguments) return;

			if (reactImports.includes(arg.expression.getText())) {
				parseComponentProps(
					node.name.getText(),
					checker.getTypeAtLocation(arg.typeArguments[0]),
					node.getSourceFile(),
				);
			}
		}
	}

	function isTypeJSXElementLike(type: ts.Type): boolean {
		if (type.isUnion()) {
			return type.types.every(
				(subType) => subType.flags & ts.TypeFlags.Null || isTypeJSXElementLike(subType),
			);
		} else if (type.symbol) {
			const name = checker.getFullyQualifiedName(type.symbol);
			return (
				name === 'global.JSX.Element' ||
				name === 'React.ReactElement' ||
				name === 'React.JSX.Element' ||
				name.endsWith('@types/react/jsx-runtime".JSX.Element') || // when `"jsx": "react-jsx"` in tsconfig
				name.endsWith('@types/react/jsx-dev-runtime".JSX.Element') // when `"jsx": "react-jsxdev"` in tsconfig
			);
		}

		return false;
	}

	function parseFunctionComponent(
		node: ts.VariableDeclaration | ts.FunctionDeclaration,
		documentationNode: ts.Node,
	) {
		if (!node.name) {
			return;
		}

		const symbol = checker.getSymbolAtLocation(node.name);
		if (!symbol) {
			return;
		}
		const componentName = node.name.getText();

		const type = checker.getTypeOfSymbolAtLocation(symbol, node);
		type.getCallSignatures().forEach((signature) => {
			if (!isTypeJSXElementLike(signature.getReturnType())) {
				return;
			}

			const propsType = checker.getTypeOfSymbolAtLocation(
				signature.parameters[0],
				signature.parameters[0].valueDeclaration!,
			);

			parseComponentProps(componentName, propsType, node.getSourceFile());
		});

		// squash props
		// { variant: 'a', href: string } & { variant: 'b' }
		// to
		// { variant: 'a' | 'b', href?: string }
		const props: Record<string, t.MemberNode> = {};
		const usedPropsPerSignature: Set<String>[] = [];
		programNode.body = programNode.body.filter((node) => {
			if (node.name === componentName && t.isComponentNode(node)) {
				const usedProps: Set<string> = new Set();
				// squash props
				node.props.forEach((propNode) => {
					usedProps.add(propNode.name);

					let { [propNode.name]: currentTypeNode } = props;
					if (currentTypeNode === undefined) {
						currentTypeNode = propNode;
					} else if (currentTypeNode.$$id !== propNode.$$id) {
						let mergedPropType = t.unionNode([currentTypeNode.type, propNode.type]);

						currentTypeNode = t.memberNode(
							currentTypeNode.name,
							{
								description: currentTypeNode.description,
								defaultValue: currentTypeNode.defaultValue,
								visibility: currentTypeNode.visibility,
							},
							mergedPropType.types.length === 1 ? mergedPropType.types[0] : mergedPropType,
							currentTypeNode.optional || propNode.optional,
							new Set(Array.from(currentTypeNode.filenames).concat(Array.from(propNode.filenames))),
							undefined,
						);
					}

					props[propNode.name] = currentTypeNode;
				});

				usedPropsPerSignature.push(usedProps);

				// delete each signature, we'll add it later unionized
				return false;
			}
			return true;
		});

		programNode.body.push(
			t.componentNode(
				componentName,
				Object.entries(props).map(([name, propType]) => {
					const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
					if (onlyUsedInSomeSignatures) {
						// mark as optional
						return {
							...propType,
							type: t.unionNode([propType.type, t.intrinsicNode('undefined')]),
						};
					}
					return propType;
				}),
				getDocumentationFromNode(documentationNode),
				node.getSourceFile().fileName,
			),
		);
	}

	function parseComponentProps(
		name: string,
		type: ts.Type,
		sourceFile: ts.SourceFile | undefined,
		documentationNode: ts.Node | undefined = undefined,
	) {
		let allProperties: ts.Symbol[];
		if (type.isUnion()) {
			allProperties = type.types.flatMap((x) => x.getProperties());
		} else {
			allProperties = type.getProperties();
		}

		const filteredProperties = allProperties.filter((symbol) =>
			shouldInclude({ name: symbol.getName(), depth: 1 }),
		);

		if (filteredProperties.length === 0) {
			return;
		}

		const propsFilename = sourceFile !== undefined ? sourceFile.fileName : undefined;

		const docs = documentationNode
			? getDocumentationFromNode(documentationNode)
			: getDocumentationFromSymbol(checker.getSymbolAtLocation(type.symbol?.valueDeclaration!));

		programNode.body.push(
			t.componentNode(
				name,
				filteredProperties.map((x) => checkSymbol(x, new Set([(type as any).id]))),
				docs,
				propsFilename,
			),
		);
	}

	function parseHook(node: ts.VariableDeclaration | ts.FunctionDeclaration) {
		if (!node.name) {
			return;
		}

		visitedNodes.add(getNodeId(node));

		const symbol = checker.getSymbolAtLocation(node.name);
		if (!symbol) {
			return;
		}
		const hookName = node.name.getText();

		const type = checker.getTypeOfSymbolAtLocation(symbol, node);
		const typeStack = new Set<number>([(type as any).id]);
		const parsedCallSignatures = type
			.getCallSignatures()
			.map((signature) => parseFunctionSignature(signature, typeStack));

		if (parsedCallSignatures.length === 0) {
			return;
		}

		programNode.body.push(
			t.hookNode(
				hookName,
				parsedCallSignatures,
				getDocumentationFromNode(node),
				node.getSourceFile().fileName,
			),
		);
	}

	function checkSymbol(
		symbol: ts.Symbol,
		typeStack: Set<number>,
		skipResolvingComplexTypes: boolean = false,
	): t.MemberNode {
		const declarations = symbol.getDeclarations();
		const declaration = declarations && declarations[0];

		const symbolFilenames = getSymbolFileNames(symbol);

		// TypeChecker keeps the name for
		// { a: React.ElementType, b: React.ReactElement | boolean }
		// but not
		// { a?: React.ElementType, b: React.ReactElement }
		// get around this by not using the TypeChecker
		if (
			declaration &&
			ts.isPropertySignature(declaration) &&
			declaration.type &&
			ts.isTypeReferenceNode(declaration.type)
		) {
			const name = declaration.type.typeName.getText();
			if (
				name === 'React.ElementType' ||
				name === 'React.ComponentType' ||
				name === 'React.ReactElement' ||
				name === 'React.MemoExoticComponent' ||
				name === 'React.Component'
			) {
				const elementNode = t.referenceNode(name);

				return t.memberNode(
					symbol.getName(),
					getDocumentationFromSymbol(symbol),
					elementNode,
					!!declaration.questionToken,
					symbolFilenames,
					(symbol as any).id,
				);
			}
		}

		const symbolType = declaration
			? // The proptypes aren't detailed enough that we need all the different combinations
				// so we just pick the first and ignore the rest
				checker.getTypeOfSymbolAtLocation(symbol, declaration)
			: // The properties of Record<..., ...> don't have a declaration, but the symbol has a type property
				((symbol as any).type as ts.Type);
		// get `React.ElementType` from `C extends React.ElementType`
		const declaredType =
			declaration !== undefined ? checker.getTypeAtLocation(declaration) : undefined;
		const baseConstraintOfType =
			declaredType !== undefined ? checker.getBaseConstraintOfType(declaredType) : undefined;
		const type =
			baseConstraintOfType !== undefined && baseConstraintOfType !== declaredType
				? baseConstraintOfType
				: symbolType;

		if (!type) {
			if (symbol.name) {
				throw new Error('No types found for symbol ' + symbol.name);
			} else {
				throw new Error('No types found for symbol');
			}
		}

		// Typechecker only gives the type "any" if it's present in a union
		// This means the type of "a" in {a?:any} isn't "any | undefined"
		// So instead we check for the questionmark to detect optional types
		let parsedType: t.Node | undefined = undefined;
		if (
			(type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) &&
			declaration &&
			ts.isPropertySignature(declaration)
		) {
			parsedType = t.intrinsicNode('any');
		} else {
			parsedType = checkType(type, typeStack, symbol.getName(), skipResolvingComplexTypes);
		}

		return t.memberNode(
			symbol.getName(),
			getDocumentationFromSymbol(symbol),
			parsedType,
			Boolean(declaration && ts.isPropertySignature(declaration) && declaration.questionToken),
			symbolFilenames,
			(symbol as any).id,
		);
	}

	function checkType(
		type: ts.Type,
		typeStack: Set<number>,
		name: string,
		skipResolvingComplexTypes: boolean = false,
	): t.TypeNode {
		// If the typeStack contains type.id we're dealing with an object that references itself.
		// To prevent getting stuck in an infinite loop we just set it to an objectNode
		if (typeStack.has((type as any).id)) {
			return t.objectNode();
		}

		{
			const propNode = type as any;

			const symbol = propNode.aliasSymbol ? propNode.aliasSymbol : propNode.symbol;
			const typeName = symbol ? checker.getFullyQualifiedName(symbol) : null;
			switch (typeName) {
				case 'global.JSX.Element':
				case 'React.JSX.Element':
				case 'React.ReactElement':
				case 'React.ElementType':
				case 'Date':
				case 'React.Component':
				case 'Element':
				case 'HTMLElement': {
					return t.referenceNode(typeName);
				}
				case 'React.ReactNode': {
					return t.unionNode([t.referenceNode(typeName), t.intrinsicNode('undefined')]);
				}
			}
		}

		// @ts-ignore - Private method
		if (checker.isArrayType(type)) {
			// @ts-ignore - Private method
			const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
			return t.arrayNode(checkType(arrayType, typeStack, name));
		}

		if (hasFlag(type.flags, ts.TypeFlags.Boolean)) {
			return t.intrinsicNode('boolean');
		}

		if (hasFlag(type.flags, ts.TypeFlags.Void)) {
			return t.intrinsicNode('void');
		}

		if (type.isUnion()) {
			const node = t.unionNode(type.types.map((x) => checkType(x, typeStack, name)));

			return node.types.length === 1 ? node.types[0] : node;
		}

		if (type.flags & ts.TypeFlags.String) {
			return t.intrinsicNode('string');
		}

		if (type.flags & ts.TypeFlags.Number) {
			return t.intrinsicNode('number');
		}

		if (type.flags & ts.TypeFlags.BigInt) {
			return t.intrinsicNode('bigint');
		}

		if (type.flags & ts.TypeFlags.Undefined) {
			return t.intrinsicNode('undefined');
		}

		if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) {
			return t.intrinsicNode('any');
		}

		if (type.flags & ts.TypeFlags.Literal) {
			if (type.isLiteral()) {
				return t.literalNode(
					type.isStringLiteral() ? `"${type.value}"` : type.value,
					getDocumentationFromSymbol(type.symbol)?.description,
				);
			}
			return t.literalNode(checker.typeToString(type));
		}

		if (type.flags & ts.TypeFlags.Null) {
			return t.literalNode('null');
		}

		const callSignatures = type.getCallSignatures();
		if (callSignatures.length >= 1) {
			if (
				skipResolvingComplexTypes ||
				!shouldResolveFunction({
					name,
					depth: typeStack.size,
				})
			) {
				return t.intrinsicNode('function');
			}

			return t.functionNode(
				callSignatures.map((signature) => parseFunctionSignature(signature, typeStack, true)),
			);
		}

		// Object-like type
		{
			const properties = type.getProperties();
			if (properties.length) {
				if (
					!skipResolvingComplexTypes &&
					shouldResolveObject({ name, propertyCount: properties.length, depth: typeStack.size })
				) {
					const filtered = properties.filter((symbol) =>
						shouldInclude({ name: symbol.getName(), depth: typeStack.size + 1 }),
					);
					if (filtered.length > 0) {
						return t.interfaceNode(
							filtered.map((x) =>
								checkSymbol(x, new Set([...typeStack.values(), (type as any).id])),
							),
						);
					}
				}

				const typeSymbol = type.getSymbol();
				if (typeSymbol) {
					const typeName = checker.getFullyQualifiedName(typeSymbol);
					return t.referenceNode(typeName);
				}

				return t.objectNode();
			}
		}

		// Object without properties or object keyword
		if (
			type.flags & ts.TypeFlags.Object ||
			(type.flags & ts.TypeFlags.NonPrimitive && checker.typeToString(type) === 'object')
		) {
			return t.objectNode();
		}

		console.warn(
			`Unable to handle node of type "ts.TypeFlags.${ts.TypeFlags[type.flags]}", using any`,
		);
		return t.intrinsicNode('any');
	}

	function parseFunctionSignature(
		signature: ts.Signature,
		typeStack: Set<number>,
		skipResolvingComplexTypes: boolean = false,
	): t.CallSignature {
		// Node that possibly has JSDocs attached to it
		let documentationNodeCandidate: ts.Node | undefined = undefined;

		const functionDeclaration = signature.getDeclaration();
		if (ts.isFunctionDeclaration(functionDeclaration)) {
			// function foo(a: string) {}
			documentationNodeCandidate = functionDeclaration;
			visitedNodes.add(getNodeId(functionDeclaration));
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

		return {
			parameters: signature.parameters.map((parameterSymbol) => {
				const parameterDeclaration = parameterSymbol.valueDeclaration as ts.ParameterDeclaration;
				const parameterType = checkType(
					checker.getTypeOfSymbolAtLocation(parameterSymbol, parameterSymbol.valueDeclaration!),
					typeStack,
					parameterSymbol.getName(),
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
			}),
			returnValueType: checkType(
				signature.getReturnType(),
				typeStack,
				signature.getDeclaration().name?.getText() || '',
			),
		};
	}

	function getDocumentationFromSymbol(symbol?: ts.Symbol): t.Documentation | undefined {
		if (!symbol) {
			return undefined;
		}

		const decl = symbol.getDeclarations();
		if (decl) {
			return getDocumentationFromNode(decl[0]);
		}

		const comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
		return comment ? { description: comment } : undefined;
	}

	function getDocumentationFromNode(node: ts.Node): t.Documentation | undefined {
		const comments = ts.getJSDocCommentsAndTags(node);
		if (comments && comments.length === 1) {
			const commentNode = comments[0];
			if (ts.isJSDoc(commentNode)) {
				return {
					description: commentNode.comment as string | undefined,
					defaultValue: commentNode.tags?.find((t) => t.tagName.text === 'default')?.comment,
					visibility: getVisibilityFromJSDoc(commentNode),
				};
			}
		}
	}

	function getSymbolFileNames(symbol: ts.Symbol): Set<string> {
		const declarations = symbol.getDeclarations() || [];

		return new Set(declarations.map((declaration) => declaration.getSourceFile().fileName));
	}
}

function hasFlag(typeFlags: number, flag: number) {
	return (typeFlags & flag) === flag;
}

function getVisibilityFromJSDoc(doc: ts.JSDoc): t.Documentation['visibility'] | undefined {
	if (doc.tags?.some((tag) => tag.tagName.text === 'public')) {
		return 'public';
	}

	if (doc.tags?.some((tag) => tag.tagName.text === 'internal')) {
		return 'internal';
	}

	if (doc.tags?.some((tag) => tag.tagName.text === 'private')) {
		return 'private';
	}

	return undefined;
}

function getParameterDescriptionFromNode(node: ts.Node) {
	const comments = ts.getJSDocCommentsAndTags(node);
	if (comments && comments.length >= 1) {
		const commentNode = comments[0];
		if (ts.isJSDoc(commentNode)) {
			const paramComments: Record<string, string> = {};
			commentNode.tags?.forEach((tag) => {
				if (ts.isJSDocParameterTag(tag) && typeof tag.comment === 'string') {
					paramComments[tag.name.getText()] = tag.comment.replace(/^[\s-*:]+/g, '');
				}
			});

			return paramComments;
		}
	}

	return {};
}

function getNodeId(node: ts.Node) {
	return (node as any).id;
}
