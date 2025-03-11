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

export function augmentComponentNodes(nodes: t.ExportNode[], context: ParserContext) {
	return nodes.map((node) => {
		if (
			t.isFunctionNode(node.type) &&
			node.type.callSignatures.some(
				(signature) =>
					t.isReferenceNode(signature.returnValueType) &&
					componentReturnTypes.has(signature.returnValueType.typeName),
			)
		) {
			const newCallSignatures = squashComponentProps(node.type.callSignatures, context);
			return {
				...node,
				type: t.componentNode(node.type.name, newCallSignatures),
			};
		}

		return node;
	});
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
