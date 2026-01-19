import * as React from 'react';

// Simulates Base UI's pattern where State is a generic type parameter
// WITHOUT a constraint in the BaseUIComponentProps definition

namespace Accordion {
	export namespace Panel {
		export interface State {
			open: boolean;
			disabled: boolean;
		}
	}
}

// This is how Base UI defines component props - State is just a type parameter
// with NO constraint at the definition site
type BaseUIComponentProps<
	ElementType extends React.ElementType,
	State,
	RenderFunctionProps = React.HTMLAttributes<HTMLElement>,
> = {
	/**
	 * className callback - State has no constraint here
	 */
	className?: string | ((state: State) => string | undefined);
	/**
	 * render callback - State has no constraint here
	 */
	render?: React.ReactElement | ((props: RenderFunctionProps, state: State) => React.ReactElement);
};

// When actually used, State is instantiated with a concrete type
interface AccordionPanelProps extends BaseUIComponentProps<'div', Accordion.Panel.State> {}

// Export type for testing
export type { AccordionPanelProps };
