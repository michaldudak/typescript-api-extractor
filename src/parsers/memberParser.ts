import ts from 'typescript';
import * as t from '../types';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ParserContext } from '../parser';
import { resolveType } from './typeResolver';

export function parseMember(
	symbol: ts.Symbol,
	typeStack: Set<number>,
	context: ParserContext,
	skipResolvingComplexTypes: boolean = false,
): t.MemberNode {
	const { checker } = context;
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
				elementNode,
				getDocumentationFromSymbol(symbol, checker),
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
		parsedType = resolveType(type, symbol.getName(), context, skipResolvingComplexTypes);
	}

	return t.memberNode(
		symbol.getName(),
		parsedType,
		getDocumentationFromSymbol(symbol, checker),
		Boolean(declaration && ts.isPropertySignature(declaration) && declaration.questionToken),
		symbolFilenames,
		(symbol as any).id,
	);
}

function getSymbolFileNames(symbol: ts.Symbol): Set<string> {
	const declarations = symbol.getDeclarations() || [];

	return new Set(declarations.map((declaration) => declaration.getSourceFile().fileName));
}
