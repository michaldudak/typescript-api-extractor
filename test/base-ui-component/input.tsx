import * as React from 'react';

export const BaseUIComponent = React.forwardRef(function BaseUIComponent(
	props: BaseUIComponent.Props,
	ref: React.ForwardedRef<HTMLDivElement>,
) {
	return <div ref={ref} />;
});

export namespace BaseUIComponent {
	export interface Props extends BaseUIComponentProps<'div', State> {
		value?: string;
		onValueChange?: (value: string) => void;
		actionsRef?: React.RefObject<Actions>;
	}

	export interface State {
		state: string;
	}

	export interface Actions {
		ping: () => void;
	}
}

type BaseUIComponentProps<
	ElementType extends React.ElementType,
	State,
	RenderFunctionProps = GenericHTMLProps,
> = Omit<WithBaseUIEvent<React.ComponentPropsWithoutRef<ElementType>>, 'className'> & {
	/**
	 * CSS class applied to the element, or a function that
	 * returns a class based on the component’s state.
	 */
	className?: string | ((state: State) => string);
	/**
	 * Allows you to replace the component’s HTML element
	 * with a different tag, or compose it with another component.
	 *
	 * Accepts a `ReactElement` or a function that returns the element to render.
	 */
	render?:
		| ComponentRenderFn<RenderFunctionProps, State>
		| React.ReactElement<Record<string, unknown>>;
};

type ComponentRenderFn<Props, State> = (props: Props, state: State) => React.ReactElement<unknown>;

type WithBaseUIEvent<T> = {
	[K in keyof T]: WithPreventBaseUIHandler<T[K]>;
};

export type GenericHTMLProps = React.HTMLAttributes<any> & { ref?: React.Ref<any> | undefined };

export type BaseUIEvent<E extends React.SyntheticEvent<Element, Event>> = E & {
	preventBaseUIHandler: () => void;
	readonly baseUIHandlerPrevented?: boolean;
};

type WithPreventBaseUIHandler<T> = T extends (event: infer E) => any
	? E extends React.SyntheticEvent<Element, Event>
		? (event: BaseUIEvent<E>) => ReturnType<T>
		: T
	: T extends undefined
		? undefined
		: T;
