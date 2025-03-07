export interface Documentation {
	description?: string;
	defaultValue?: any;
	visibility?: 'public' | 'private' | 'internal';
	tags?: Array<{
		tag: string;
		value: string | undefined;
	}>;
}
