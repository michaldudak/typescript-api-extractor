export function Component(props: Props) {
	return <div {...props} />;
}

interface Props {
	className?: string;
}
