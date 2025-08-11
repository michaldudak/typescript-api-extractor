export function Comp(props: Props) {}

export interface Props {
	coords?: Coords;
	rect?: Rect;
}

// types from Floating UI Utils:

type Axis = 'x' | 'y';

type Coords = {
	[key in Axis]: number;
};

type Length = 'width' | 'height';

type Dimensions = {
	[key in Length]: number;
};

type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

type Rect = Prettify<Coords & Dimensions>;
