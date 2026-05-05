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
		const isCapitalized = /^[A-Z]/.test(node.name) || node.name === 'default';
		if (!isCapitalized) {
			return node;
		}

		// Direct FunctionNode (e.g. plain function components, forwardRef).
		if (node.type instanceof FunctionNode && hasReactNodeLikeReturnType(node.type)) {
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
				node.reexportedFrom,
			);
		}

		// UnionNode whose members are all React-returning FunctionNodes. Happens
		// when TypeScript unfolds a polymorphic component (e.g. base-ui-style
		// RenderProp patterns used in mui-x Toolbar, ExportCsv, QuickFilter*,
		// AiAssistantPanelTrigger, ChartsToolbarImageExportTrigger, etc.) into a
		// union of overloaded call-signature holders. Flatten the overloads into
		// one ComponentNode so consumers see a single props table.
		if (node.type instanceof UnionNode) {
			const memberFunctions: FunctionNode[] = [];
			let allFunctions = true;
			for (const member of node.type.types) {
				if (member instanceof FunctionNode && hasReactNodeLikeReturnType(member)) {
					memberFunctions.push(member);
				} else {
					allFunctions = false;
					break;
				}
			}
			if (allFunctions && memberFunctions.length > 0) {
				const allCallSignatures = memberFunctions.flatMap((fn) => fn.callSignatures);
				const newCallSignatures = squashComponentProps(allCallSignatures, context);
				const anyTypeName = memberFunctions.find((fn) => fn.typeName)?.typeName;
				const typeName = anyTypeName
					? new TypeName(
							anyTypeName.name,
							anyTypeName.namespaces,
							anyTypeName.typeArguments,
						)
					: undefined;
				return new ExportNode(
					node.name,
					new ComponentNode(typeName, newCallSignatures),
					node.documentation,
					node.reexportedFrom,
				);
			}
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
				const ut = unwrapUnionType(propsParameter.type);
				return ut;
			}

			if (propsParameter.type instanceof IntersectionNode) {
				// Prefer the intersection's own aggregated properties (resolved at
				// the top level via parseObjectType) when available. This is the only
				// reliable source for large intersections like mui-x DataGridProps,
				// whose sub-types individually exceed `shouldResolveObject`'s limit
				// and get returned as empty ObjectNodes.
				if (propsParameter.type.properties.length > 0) {
					return new ObjectNode(undefined, [...propsParameter.type.properties], undefined);
				}
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

function unwrapUnionType(type: UnionNode): (ObjectNode | IntersectionNode)[] {
	return type.types
		.map((type) => {
			if (type instanceof ObjectNode || type instanceof IntersectionNode) {
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
