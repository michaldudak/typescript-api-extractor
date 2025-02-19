import * as React from 'react';

/**
 * The test component.
 *
 * @internal
 */
function Component(props: Props): React.ReactElement {
	return <div {...props} />;
}

interface Props {
	/**
	 * The class name.
	 * Used to make the component more classy.
	 */
	className?: string;
	/**
	 * A value.
	 *
	 * @default 10
	 */
	someValue?: number;
}
