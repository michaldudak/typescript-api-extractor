// Tests that function parameter types retain their properties when accessed
// through a deep chain involving Omit<> and generic methods.
import type { BaseProps } from './types';

export interface DerivedProps extends Omit<BaseProps, 'toast'> {}

export interface AddOptions<Data extends object> {
  props?: DerivedProps;
  data?: Data;
}

export interface Manager {
  add: <Data extends object>(options: AddOptions<Data>) => string;
}

export interface ProviderProps {
  manager?: Manager;
}

export function Provider(props: ProviderProps): null {
  return null;
}
