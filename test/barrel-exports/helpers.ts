export interface HelperProps {
	value: string;
}

export type HelperState = 'idle' | 'loading';

export function helperFunction(): string {
	return 'helper';
}
