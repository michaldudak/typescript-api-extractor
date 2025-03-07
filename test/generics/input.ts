export function genericFunction<T extends React.HTMLAttributes<HTMLElement>>(
	params: GenericFunctionParameters<T>,
): T {
	return params.value;
}

export interface GenericFunctionParameters<T extends React.HTMLAttributes<HTMLElement>> {
	value: T;
}
