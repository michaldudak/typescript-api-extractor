'use client';
import * as React from 'react';

// Reproduces mui-x DataGrid's shape:
//   type GridProps<R> = Omit<Partial<BigA<R>> & B & C<R>, ForcedKeys> & { pagination?: true };
//   const GridRaw = function Grid<R>(inProps: GridProps<R>, ref) { ... };
//   interface GridComponent { <R = any>(props: GridProps<R> & RefAttributes<HTMLDivElement>): JSX.Element; propTypes?: any; }
//   export const Grid = memo(forwardRef(GridRaw)) as GridComponent;
//
// The combined flattened props (51+) exceed `shouldResolveObject`'s default
// 50-property limit. Before the fix, the intersection sub-types were each
// returned as empty ObjectNodes and `squashComponentProps` only saw the
// tiny literal member (`{ pagination?: true }`), collapsing the component to
// a single prop.

interface ValidRowModel {
	[key: string]: any;
}

// 50 props on a single interface — above `shouldResolveObject`'s default cap
// so the old code path would drop this whole sub-intersection.
interface BigProps<R extends ValidRowModel> {
	p01: R;
	p02: R[];
	p03: string;
	p04: number;
	p05: boolean;
	p06: string;
	p07: number;
	p08: boolean;
	p09: string;
	p10: number;
	p11: boolean;
	p12: string;
	p13: number;
	p14: boolean;
	p15: string;
	p16: number;
	p17: boolean;
	p18: string;
	p19: number;
	p20: boolean;
	p21: string;
	p22: number;
	p23: boolean;
	p24: string;
	p25: number;
	p26: boolean;
	p27: string;
	p28: number;
	p29: boolean;
	p30: string;
	p31: number;
	p32: boolean;
	p33: string;
	p34: number;
	p35: boolean;
	p36: string;
	p37: number;
	p38: boolean;
	p39: string;
	p40: number;
	p41: boolean;
	p42: string;
	p43: number;
	p44: boolean;
	p45: string;
	p46: number;
	p47: boolean;
	p48: string;
	p49: number;
	p50: boolean;
	signature: string;
	pagination: boolean;
}

interface SmallProps {
	slots: { toolbar?: any };
	localeText: Record<string, string>;
}

interface OtherProps<R extends ValidRowModel> {
	onRowClick?: (row: R) => void;
	apiRef?: { current: any };
}

type ForcedPropsKey = 'signature' | 'pagination';

export type GridProps<R extends ValidRowModel = any> = Omit<
	Partial<BigProps<R>> & SmallProps & OtherProps<R>,
	ForcedPropsKey
> & {
	pagination?: true;
};

const GridRaw = function Grid<R extends ValidRowModel>(
	inProps: GridProps<R>,
	ref: React.Ref<HTMLDivElement>,
) {
	return <div ref={ref} />;
};

interface GridComponent {
	<R extends ValidRowModel = any>(
		props: GridProps<R> & React.RefAttributes<HTMLDivElement>,
	): React.JSX.Element;
	propTypes?: any;
}

/**
 * A grid component. Should surface all 50+ props despite each inner
 * intersection member exceeding the default `shouldResolveObject` limit.
 */
export const Grid = React.memo(React.forwardRef(GridRaw)) as GridComponent;
