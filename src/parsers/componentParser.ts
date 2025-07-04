import {
	CallSignature,
	ComponentNode,
	ExportNode,
	FunctionNode,
	IntrinsicNode,
	PropertyNode,
	ObjectNode,
	ExternalTypeNode,
	UnionNode,
	IntersectionNode,
} from '../models';
import { TypeName } from '../models/typeName';
import { ParserContext } from '../parser';

const componentReturnTypes = [/Element/, /ReactNode/, /ReactElement(<.*>)?/];

function isReactReturnType(type: ExternalTypeNode) {
	return componentReturnTypes.some((regex) => regex.test(type.typeName?.name ?? ''));
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
			const typeName = node.type.typeName
				? new TypeName(
						node.type.typeName?.name,
						node.type.typeName?.namespaces,
						node.type.typeName?.typeArguments,
					)
				: undefined;
			return new ExportNode(
				node.name,
				new ComponentNode(typeName, newCallSignatures),
				node.documentation,
			);
		}

		return node;
	});
}

function hasReactNodeLikeReturnType(type: FunctionNode) {
	return type.callSignatures.some(
		(signature) =>
			(signature.returnValueType instanceof ExternalTypeNode &&
				isReactReturnType(signature.returnValueType)) ||
			(signature.returnValueType instanceof UnionNode &&
				signature.returnValueType.types.some(
					(type) => type instanceof ExternalTypeNode && isReactReturnType(type),
				)),
	);
}

function squashComponentProps(callSignatures: CallSignature[], context: ParserContext) {
	// squash props
	// { variant: 'a', href: string } | { variant: 'b' }
	// to
	// { variant: 'a' | 'b', href?: string }
	const props: Map<string, PropertyNode> = new Map<string, PropertyNode>();
	const usedPropsPerSignature: Set<string>[] = [];

	const propsFromCallSignatures = callSignatures
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

	propsFromCallSignatures.forEach((propsObject) => {
		const usedProps: Set<string> = new Set();

		propsObject.properties.forEach((propNode) => {
			usedProps.add(propNode.name);

			// Check if a prop with a given name has already been encountered.
			const existingPropNode = props.get(propNode.name);
			if (existingPropNode === undefined) {
				// If not, we can just add it.
				props.set(propNode.name, propNode);
			} else {
				// If it has, we need to merge the types in a union.
				// If both prop objects define the prop with the same type, the UnionNode constructor will deduplicate them.
				const mergedPropType = new UnionNode(undefined, [existingPropNode.type, propNode.type]);

				// If the current prop is optional, the whole union will be optional.
				const mergedPropNode = new PropertyNode(
					existingPropNode.name,
					mergedPropType.types.length === 1 ? mergedPropType.types[0] : mergedPropType,
					existingPropNode.documentation,
					existingPropNode.optional || propNode.optional,
				);

				props.set(propNode.name, mergedPropNode);
			}
		});

		usedPropsPerSignature.push(usedProps);
	});

	// If a prop is used in some signatures, but not in others, we need to mark it as optional.
	return [...props.entries()].map(([name, property]) => {
		const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
		if (onlyUsedInSomeSignatures) {
			return markPropertyAsOptional(property, context);
		}

		return property;
	});
}

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

function markPropertyAsOptional(property: PropertyNode, context: ParserContext) {
	const canBeUndefined =
		property.type instanceof UnionNode &&
		property.type.types.some(
			(type) => type instanceof IntrinsicNode && type.intrinsic === 'undefined',
		);

	const { compilerOptions } = context;
	if (!canBeUndefined && !compilerOptions.exactOptionalPropertyTypes) {
		const newType = new UnionNode(undefined, [property.type, new IntrinsicNode('undefined')]);
		return new PropertyNode(property.name, newType, property.documentation, true);
	}

	return new PropertyNode(property.name, property.type, property.documentation, true);
}
