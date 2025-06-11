export namespace Root {
	export namespace Sub {
		export function fn1(params: Params) {}

		export interface Params {
			s: Grade;
			a: NamespacedType;
		}

		export enum Grade {
			good,
			bad,
		}

		export function Component() {
			return <div />;
		}

		export function useHook() {
			return {};
		}
	}

	export function fn2() {}

	export type NamespacedType = OutsideType;
}

export function fn3(params: Root.Sub.Params) {}

export function fn4(a: Root.NamespacedType) {}

type OutsideType = 'one' | 'two';
