type OriginalType = 0 | 1;

export function Component(props: RootNamespace.Props) {
	return <div />;
}

namespace RootNamespace {
	export interface Props {
		onChange: (p: Alias | undefined) => void;
	}

	export type Alias = OriginalType;
}
