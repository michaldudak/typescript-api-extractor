import * as React from 'react';

function Component(props: Props): React.ReactElement {
	return <div {...props} />;
}

interface Props {
	onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onClosing: (animated: boolean) => boolean;
}
