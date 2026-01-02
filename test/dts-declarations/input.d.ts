// This file tests .d.ts declaration files with various patterns
// Combines: reexports-from-js (importing from .js in d.ts) and mui-overridable-component patterns

// Part 1: Re-exports from .js files (simulates built output)
import {
	FormattedProperty,
	FormattedParameter,
	Container,
	ProcessingStatus,
	formatType,
	parseParameters,
} from './source.js';

// Re-export types directly
export type { FormattedProperty, FormattedParameter };

// Re-export with renaming
export type { Container as TypeContainer };

// Re-export a const enum pattern
export { ProcessingStatus };

// Re-export functions
export { formatType, parseParameters };

// Function using re-exported types as both parameter and return type
export function processType(input: FormattedParameter): FormattedProperty;

// Function using re-exported generic type
export function wrapValue<T>(value: T): Container<T>;

// Part 2: Material UI's OverridableComponent pattern
declare const Component: OverridableComponent<ComponentTypeMap> & { muiName: string };

export { Component };

interface ComponentOwnProps {
	variant?: 'default' | 'small' | 'large';
}

interface ComponentTypeMap<AdditionalProps = {}, RootComponent extends React.ElementType = 'span'> {
	props: AdditionalProps & ComponentOwnProps;
	defaultComponent: RootComponent;
}

interface OverridableComponent<TypeMap extends OverridableTypeMap> {
	<RootComponent extends React.ElementType>(
		props: {
			/**
			 * The component used for the root node.
			 */
			component: RootComponent;
		} & OverrideProps<TypeMap, RootComponent>,
	): React.JSX.Element | null;
	(props: DefaultComponentProps<TypeMap>): React.JSX.Element | null;
}

type OverrideProps<
	TypeMap extends OverridableTypeMap,
	RootComponent extends React.ElementType,
> = BaseProps<TypeMap> &
	DistributiveOmit<React.ComponentPropsWithRef<RootComponent>, keyof BaseProps<TypeMap>>;

type DefaultComponentProps<TypeMap extends OverridableTypeMap> = BaseProps<TypeMap> &
	DistributiveOmit<
		React.ComponentPropsWithRef<TypeMap['defaultComponent']>,
		keyof BaseProps<TypeMap>
	>;

interface OverridableTypeMap {
	props: {};
	defaultComponent: React.ElementType;
}

type BaseProps<TypeMap extends OverridableTypeMap> = TypeMap['props'] & CommonProps;

interface CommonProps {
	className?: string;
	style?: React.CSSProperties;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
