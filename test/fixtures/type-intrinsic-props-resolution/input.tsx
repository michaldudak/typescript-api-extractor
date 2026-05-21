import * as React from 'react';

export function Component(props: Props): React.ReactElement {
	return <div>{props.s}</div>;
}

interface Props {
	s: string;
	nb: number;
	b: boolean;
	n: null;
}
