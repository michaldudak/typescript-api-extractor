import * as React from 'react';

export function Component(props: Props): React.ReactElement {
	return <div {...props} />;
}

interface Props {
	onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onClosing: OnClosingCallback;
	onOpen: OnOpenCallback;
	onClosed?: () => void;
}

type OnClosingCallback = (animated: boolean) => boolean;

interface OnOpenCallback {
	(animated: boolean): void;
}
