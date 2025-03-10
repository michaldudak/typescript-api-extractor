import * as React from 'react';

export function Test(props: Props) {}

interface Props {
	onClick: React.MouseEventHandler;
	onKeyDown?: React.KeyboardEventHandler;
}
