import * as React from 'react';

/**
 * A test component
 */
export const TestComponent = function TestComponent(props: Props): React.ReactElement {
	return <div {...props} />;
};

interface Props {
	className?: string;
	id?: string;
}
