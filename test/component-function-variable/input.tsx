import * as React from 'react';

export const TestComponent = function TestComponent(props: Props): React.ReactElement {
	return <div {...props} />;
};

interface Props {
	className?: string;
	id?: string;
}
