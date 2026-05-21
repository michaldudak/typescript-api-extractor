import * as React from 'react';

export function Component(props: PropsA | PropsB): React.ReactElement {
	return <div {...props} />;
}

interface PropsA {
	matching: boolean;
	uniqueA: string;
	conflictingOptionality: string;
	conflictingType: string;
}

interface PropsB {
	matching: boolean;
	uniqueB: string;
	conflictingOptionality?: string;
	conflictingType: number;
}
