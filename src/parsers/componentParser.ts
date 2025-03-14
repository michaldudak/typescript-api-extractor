import {
	CallSignature,
	ComponentNode,
	ExportNode,
	FunctionNode,
	IntrinsicNode,
	MemberNode,
	ObjectNode,
	ReferenceNode,
	UnionNode,
} from '../models';
import { ParserContext } from '../parser';

const componentReturnTypes = new Set([
	'Element',
	'ReactNode',
	'ReactElement',
	'JSX.Element',
	'React.JSX.Element',
	'React.ReactNode',
	'React.ReactElement',
]);

export function augmentComponentNodes(nodes: ExportNode[], context: ParserContext) {
	return nodes.map((node) => {
		if (
			node.type instanceof FunctionNode &&
			/^[A-Z]/.test(node.name) &&
			hasReactNodeLikeReturnType(node.type)
		) {
			const newCallSignatures = squashComponentProps(node.type.callSignatures, context);
			return new ExportNode(
				node.name,
				new ComponentNode(node.type.name, newCallSignatures),
				node.documentation,
			);
		}

		return node;
	});
}

function hasReactNodeLikeReturnType(type: FunctionNode) {
	return type.callSignatures.some(
		(signature) =>
			(signature.returnValueType instanceof ReferenceNode &&
				componentReturnTypes.has(signature.returnValueType.name)) ||
			(signature.returnValueType instanceof UnionNode &&
				signature.returnValueType.types.some(
					(type) => type instanceof ReferenceNode && componentReturnTypes.has(type.name),
				)),
	);
}

function squashComponentProps(callSignatures: CallSignature[], context: ParserContext) {
	// squash props
	// { variant: 'a', href: string } & { variant: 'b' }
	// to
	// { variant: 'a' | 'b', href?: string }
	const props: Record<string, MemberNode> = {};
	const usedPropsPerSignature: Set<String>[] = [];

	function unwrapUnionType(type: UnionNode): ObjectNode[] {
		return type.types
			.map((type) => {
				if (type instanceof ObjectNode) {
					return type;
				} else if (type instanceof UnionNode) {
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

			if (propsParameter.type instanceof ObjectNode) {
				return propsParameter.type;
			}

			if (propsParameter.type instanceof UnionNode) {
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
				let mergedPropType = new UnionNode(undefined, [currentTypeNode.type, propNode.type]);

				currentTypeNode = new MemberNode(
					currentTypeNode.name,
					mergedPropType.types.length === 1 ? mergedPropType.types[0] : mergedPropType,
					currentTypeNode.documentation,
					currentTypeNode.optional || propNode.optional,
					undefined,
				);
			}

			props[propNode.name] = currentTypeNode;
		});

		usedPropsPerSignature.push(usedProps);
	});

	const memberNodes = Object.entries(props).map(([name, property]) => {
		const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
		if (onlyUsedInSomeSignatures) {
			// mark as optional
			return markPropertyAsOptional(property, context);
		}

		return property;
	});

	return memberNodes;
}

function markPropertyAsOptional(property: MemberNode, context: ParserContext) {
	const canBeUndefined =
		property.type instanceof UnionNode &&
		property.type.types.some((type) => type instanceof IntrinsicNode && type.name === 'undefined');

	const { compilerOptions } = context;
	if (!canBeUndefined && !compilerOptions.exactOptionalPropertyTypes) {
		const newType = new UnionNode(undefined, [property.type, new IntrinsicNode('undefined')]);
		return new MemberNode(property.name, newType, property.documentation, true, undefined);
	}

	return new MemberNode(property.name, property.type, property.documentation, true, undefined);
}
