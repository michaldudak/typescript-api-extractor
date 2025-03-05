import ts from 'typescript';
import { ParserContext } from '../parser';
import { EnumMember, enumNode, literalNode, memberNode } from '../types';
import { getDocumentationFromNode } from './documentationParser';

export function parseEnum(declaration: ts.EnumDeclaration, context: ParserContext) {
	const { checker } = context;
	const members = declaration.members.map((member) => {
		const memberSymbol = checker.getSymbolAtLocation(member.name);

		if (!memberSymbol) {
			throw new Error('Could not find symbol for member');
		}

		const memberType = checker.getTypeAtLocation(member);

		return {
			name: member.name.getText(),
			value: (memberType as any).value,
			documentation: getDocumentationFromNode(member),
		} satisfies EnumMember;
	});

	return enumNode(declaration.name.getText(), members, getDocumentationFromNode(declaration));
}
