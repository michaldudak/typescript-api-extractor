import {
	CallSignature,
	ComponentNode,
	ExportNode,
	FunctionNode,
	IntrinsicNode,
	PropertyNode,
	ObjectNode,
	ReferenceNode,
	UnionNode,
	IntersectionNode,
} from '../models';
import { ParserContext } from '../parser';

const componentReturnTypes = [/Element/, /ReactNode/, /ReactElement(<.*>)?/];

function isReactReturnType(type: ReferenceNode) {
	return componentReturnTypes.some((regex) => regex.test(type.name));
}

export function augmentComponentNodes(nodes: ExportNode[], context: ParserContext): ExportNode[] {
	return nodes.map((node) => {
		// This heuristic is not perfect, but it's good enough for now.
		// A better way would be to explicitly mark components with a JSDoc tag.
		if (
			node.type instanceof FunctionNode &&
			(/^[A-Z]/.test(node.name) || node.name === 'default') &&
			hasReactNodeLikeReturnType(node.type)
		) {
			const newCallSignatures = squashComponentProps(node.type.callSignatures, context);
			return new ExportNode(
				node.name,
				new ComponentNode(node.type.name, node.type.parentNamespaces, newCallSignatures),
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
				isReactReturnType(signature.returnValueType)) ||
			(signature.returnValueType instanceof UnionNode &&
				signature.returnValueType.types.some(
					(type) => type instanceof ReferenceNode && isReactReturnType(type),
				)),
	);
}

function squashComponentProps(callSignatures: CallSignature[], context: ParserContext) {
	// squash props
	// { variant: 'a', href: string } & { variant: 'b' }
	// to
	// { variant: 'a' | 'b', href?: string }
	const props: Record<string, PropertyNode> = {};
	const usedPropsPerSignature: Set<string>[] = [];

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

			if (propsParameter.type instanceof IntersectionNode) {
				return propsParameter.type.types.filter((type) => type instanceof ObjectNode);
			}
		})
		.flat()
		.filter((t) => !!t);

	allParametersUnionMembers.forEach((propUnionMember) => {
		const usedProps: Set<string> = new Set();

		propUnionMember.properties.forEach((propNode) => {
			usedProps.add(propNode.name);

			let { [propNode.name]: currentTypeNode } = props;
			if (currentTypeNode === undefined) {
				currentTypeNode = propNode;
			} else if (currentTypeNode.$$id !== propNode.$$id) {
				const mergedPropType = new UnionNode(undefined, [], [currentTypeNode.type, propNode.type]);

				currentTypeNode = new PropertyNode(
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

	return Object.entries(props).map(([name, property]) => {
		const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
		if (onlyUsedInSomeSignatures) {
			// mark as optional
			return markPropertyAsOptional(property, context);
		}

		return property;
	});
}

function markPropertyAsOptional(property: PropertyNode, context: ParserContext) {
	const canBeUndefined =
		property.type instanceof UnionNode &&
		property.type.types.some(
			(type) => type instanceof IntrinsicNode && type.intrinsic === 'undefined',
		);

	const { compilerOptions } = context;
	if (!canBeUndefined && !compilerOptions.exactOptionalPropertyTypes) {
		const newType = new UnionNode(undefined, [], [property.type, new IntrinsicNode('undefined')]);
		return new PropertyNode(property.name, newType, property.documentation, true, undefined);
	}

	return new PropertyNode(property.name, property.type, property.documentation, true, undefined);
}
