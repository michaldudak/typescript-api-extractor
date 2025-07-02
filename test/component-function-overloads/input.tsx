export function Component(props: Props1): React.ReactNode;
export function Component(props: Props2): React.ReactNode;
export function Component(props: Props1 | Props2): React.ReactNode {
	return null;
}

interface Props1 {
	discriminant?: false | undefined;
	variant1Prop: string;
	variant1OptionalProp?: string;
	mandatoryProp: string;
}

interface Props2 {
	discriminant: true;
	variant2Prop: string;
	variant2OptionalProp?: string;
	mandatoryProp: string;
}
