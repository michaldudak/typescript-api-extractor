/**
 * Tests that external types record where they are declared, so a type from
 * TypeScript's default library can be told apart from a package type with the
 * same name.
 */
import { type Range as ShadowRange, type Intl as ShadowIntl } from 'shadow-lib';
import { type Widget } from '@scope/widgets';

export interface SourceProps {
	/**
	 * Declared in `lib.dom.d.ts`.
	 */
	selection?: Range;

	/**
	 * Declared in one of the `lib.es*.d.ts` files.
	 */
	locale?: Intl.LocalesArgument;

	/**
	 * Declared across several `lib.es*.d.ts` files.
	 */
	numberFormat?: Intl.NumberFormat;

	/**
	 * Declared in a package, with the same name as the DOM `Range`.
	 */
	range?: ShadowRange;

	/**
	 * Declared in a package, with the same name as the built-in `Intl.NumberFormat`.
	 */
	shadowNumberFormat?: ShadowIntl.NumberFormat;

	/**
	 * Declared in a scoped package.
	 */
	widget?: Widget;

	/**
	 * The DOM `Range` and the package `Range` stay distinct members.
	 */
	anyRange?: Range | ShadowRange;

	/**
	 * Callbacks that differ only in which `Range` they receive stay distinct members.
	 */
	onRange?: ((range: Range) => void) | ((range: ShadowRange) => void);
}
