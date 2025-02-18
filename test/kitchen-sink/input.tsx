import * as React from 'react';

/**
 * The tested component
 */
export function KitchenSink(props: KitchenSinkProps): React.JSX.Element {
	const { onChange, literalUnion = 'foo', ...rest } = props;
	return <div {...rest} />;
}

/**
 * The props of the component
 */
export interface KitchenSinkProps {
	/**
	 * The class name
	 */
	className?: string;
	children?: React.ReactNode;
	onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
	/**
	 * A union of literal types
	 * @default 'foo'
	 */
	literalUnion?: 'foo' | 'bar' | 'baz' | QuxOrQuux;
	boolProp?: boolean;
	requiredBoolProp: boolean;
}

type QuxOrQuux = 'qux' | 'quux';
