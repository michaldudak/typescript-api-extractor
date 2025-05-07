export namespace Root {
	export namespace Sub {
		export function fn1(params: Params) {}

		export interface Params {
			s: Grade;
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
}

export function fn3(params: Root.Sub.Params) {}
