import * as t from '../index';
import { ParserContext } from '../index';

const componentReturnTypes = new Set([
	'Element',
	'ReactNode',
	'ReactElement',
	'JSX.Element',
	'React.JSX.Element',
	'React.ReactNode',
	'React.ReactElement',
]);

export function augmentComponentNodes(nodes: t.ExportNode[]) {
	return nodes.map((node) => {
		if (
			node.type instanceof t.FunctionNode &&
			/^[A-Z]/.test(node.name) &&
			hasReactNodeLikeReturnType(node.type)
		) {
			const newCallSignatures = squashComponentProps(node.type.callSignatures);
			return new t.ExportNode(
				node.name,
				new t.ComponentNode(node.type.name, newCallSignatures),
				node.documentation,
			);
		}

		return node;
	});
}

function hasReactNodeLikeReturnType(type: t.FunctionNode) {
	return type.callSignatures.some(
		(signature) =>
			(signature.returnValueType instanceof t.ReferenceNode &&
				componentReturnTypes.has(signature.returnValueType.typeName)) ||
			(signature.returnValueType instanceof t.UnionNode &&
				signature.returnValueType.types.some(
					(type) => type instanceof t.ReferenceNode && componentReturnTypes.has(type.typeName),
				)),
	);
}

function squashComponentProps(callSignatures: t.CallSignature[]) {
	// squash props
	// { variant: 'a', href: string } & { variant: 'b' }
	// to
	// { variant: 'a' | 'b', href?: string }
	const props: Record<string, t.MemberNode> = {};
	const usedPropsPerSignature: Set<String>[] = [];

	function unwrapUnionType(type: t.UnionNode): t.ObjectNode[] {
		return type.types
			.map((type) => {
				if (type instanceof t.ObjectNode) {
					return type;
				} else if (type instanceof t.UnionNode) {
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

			if (propsParameter.type instanceof t.ObjectNode) {
				return propsParameter.type;
			}

			if (propsParameter.type instanceof t.UnionNode) {
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
				let mergedPropType = new t.UnionNode(undefined, [currentTypeNode.type, propNode.type]);

				currentTypeNode = new t.MemberNode(
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

	const memberNodes = Object.entries(props).map(([name, propType]) => {
		const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
		if (onlyUsedInSomeSignatures) {
			// mark as optional
			return {
				...propType,
				type: new t.UnionNode(undefined, [propType.type, new t.IntrinsicNode('undefined')]),
				optional: true,
			};
		}

		return propType;
	});

	return memberNodes;
}
