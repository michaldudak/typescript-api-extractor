export type OffsetFunction = (data: {
  side: 'top' | 'bottom';
  anchor: { width: number };
}) => number;

export interface BaseProps {
  sideOffset?: number | OffsetFunction;
  toast: { id: string };
}
