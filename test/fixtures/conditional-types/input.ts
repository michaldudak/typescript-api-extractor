export function fn<T extends boolean>(x: T): T extends true ? number : null {
	return (x ? 1 : null) as T extends true ? number : null;
}

export function Component1<Multiple extends boolean>(props: Props<Multiple>) {
	return null;
}

interface Props<Multiple extends boolean> {
	value: Multiple extends true ? string | null : string[];
}
