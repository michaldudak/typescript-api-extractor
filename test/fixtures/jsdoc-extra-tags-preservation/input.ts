/**
 * This is a test.
 *
 * @example
 * test();
 *
 * @type {function}
 * @public
 * @category important-functions
 */
export function test(params: Params) {}

interface Params {
	s: string;
	/**
	 * @type {Integer}
	 */
	n: number;
	onChange: (
		event: React.ChangeEvent<HTMLInputElement>,
		/** @type ChangeReason */
		reason: string | undefined,
	) => void;
	/**
	 * For internal use only
	 * @internal
	 */
	_id?: string;
}
