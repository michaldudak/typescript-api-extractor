import * as React from 'react';

export function Component(props: Props): React.ReactElement {
	return <div {...props} />;
}

interface Props {
	requiredString: string;
	optionalString?: string;
	stringOrUndefined: string | undefined;
	requiredBoolean: boolean;
	optionalBoolean?: boolean;
}
