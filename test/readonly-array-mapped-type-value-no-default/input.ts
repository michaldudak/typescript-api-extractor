export type Data<K extends string = string, V> = ReadonlyArray<{
  [key in K]?: V;
}>;
