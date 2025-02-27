/**
 * A hook defined as a function.
 *
 * @internal
 */
export function useHook(
	value: string,
	severity: Severity,
	onChange: (newValue: string) => void,
): number {
	return 42;
}

type Severity = 'low' | 'high';
