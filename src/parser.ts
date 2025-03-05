import ts from 'typescript';
import * as t from './types';
import {
	parseComponentProps,
	parseFunction,
	parseFunctionComponent,
	parseHook,
} from './parsers/functionParser';
import { parseEnum } from './parsers/enumParser';

export interface ParserContext {
	checker: ts.TypeChecker;
	shouldInclude: ParserOptions['shouldInclude'];
	shouldResolveObject: ParserOptions['shouldResolveObject'];
	shouldResolveFunction: ParserOptions['shouldResolveFunction'];
	sourceFile: ts.SourceFile;
	visitedNodes: Set<ts.Node>;
	typeStack: Set<number>;
	includeExternalTypes: boolean;
}

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
	includeExternalTypes?: boolean;
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

	if (!sourceFile) {
		throw new Error(`Program doesn't contain file: "${filePath}"`);
	}

	const reactImports: string[] = [];
	const visitedNodes = new Set<ts.Node>();
	const foundNodes: (t.ComponentNode | t.HookNode | t.FunctionNode | t.EnumNode | undefined)[] = [];

	const parserContext: ParserContext = {
		checker,
		shouldInclude,
		shouldResolveObject,
		shouldResolveFunction,
		sourceFile,
		visitedNodes,
		typeStack: new Set<number>(),
		includeExternalTypes: parserOptions.includeExternalTypes || false,
	};

	ts.forEachChild(sourceFile, visitImports);
	ts.forEachChild(sourceFile, visit);

	return t.programNode(foundNodes.filter((node) => node !== undefined));

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
		if (visitedNodes.has(node)) {
			return;
		}

		if (ts.isFunctionDeclaration(node) && node.name) {
			if (node.name.getText().startsWith('use')) {
				// function useHook(parameters: type): type
				foundNodes.push(parseHook(node, parserContext));
			} else if (/^[A-Z]/.test(node.name.getText()) && node.parameters.length === 1) {
				// function x(props: type) { return <div/> }
				foundNodes.push(parseFunctionComponent(node, parserContext));
			} else if (isDefinedInModuleScope(node)) {
				// plain function
				foundNodes.push(parseFunction(node, parserContext));
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
					if (/^[A-Z]/.test(variableNode.name.getText())) {
						const type = checker.getTypeAtLocation(variableNode.name);
						if (!variableNode.initializer) {
							if (
								checkDeclarations &&
								type.aliasSymbol &&
								type.aliasTypeArguments &&
								checker.getFullyQualifiedName(type.aliasSymbol) === 'React.ComponentType'
							) {
								foundNodes.push(
									parseComponentProps(
										variableNode.name.getText(),
										type.aliasTypeArguments[0],
										node.getSourceFile(),
										node,
										parserContext,
									),
								);
							} else if (checkDeclarations) {
								foundNodes.push(parseFunctionComponent(variableNode, parserContext));
							}
						} else if (
							ts.isArrowFunction(variableNode.initializer) ||
							ts.isFunctionExpression(variableNode.initializer)
						) {
							// x = (props: type) => { return <div/> }
							// x = function(props: type) { return <div/> }
							// x = function y(props: type) { return <div/> }
							foundNodes.push(parseFunctionComponent(variableNode, parserContext));
						} else if (
							ts.isCallExpression(variableNode.initializer) &&
							variableNode.initializer.arguments.length > 0
						) {
							// x = react.memo((props:type) { return <div/> })
							const callString = variableNode.initializer.expression.getText();
							const arg = variableNode.initializer.arguments[0];
							if (
								reactImports.includes(callString) &&
								(ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
								arg.parameters.length > 0
							) {
								const propsType = checker.getTypeAtLocation(arg.parameters[0]);
								if (propsType) {
									foundNodes.push(
										parseComponentProps(
											variableNode.name.getText(),
											propsType,
											node.getSourceFile(),
											node,
											parserContext,
										),
									);
								}
							}
						}
					} else if (
						variableNode.name.getText().startsWith('use') &&
						variableNode.initializer &&
						(ts.isArrowFunction(variableNode.initializer) ||
							ts.isFunctionExpression(variableNode.initializer))
					) {
						// const useHook = function useHook(parameters: type): type
						// const useHook = (parameters: type): type
						foundNodes.push(parseHook(variableNode, parserContext));
					} else if (isDefinedInModuleScope(node)) {
						// plain function
						foundNodes.push(parseFunction(variableNode, parserContext));
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
				foundNodes.push(
					parseComponentProps(
						node.name.getText(),
						checker.getTypeAtLocation(arg.typeArguments[0]),
						node.getSourceFile(),
						node,
						parserContext,
					),
				);
			}
		} else if (ts.isEnumDeclaration(node)) {
			foundNodes.push(parseEnum(node, parserContext));
		}
	}
}

function isDefinedInModuleScope(node: ts.Node) {
	while (node) {
		if (ts.isModuleBlock(node) || ts.isSourceFile(node)) {
			return true;
		}

		node = node.parent;
	}

	return false;
}
