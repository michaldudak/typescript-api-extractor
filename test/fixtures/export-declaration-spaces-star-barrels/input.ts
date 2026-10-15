// A type-only star export masks the value space through any number of plain
// star exports behind it, and drops values that are not also pure types.
export type * from './barrel';

// A namespace re-export of a module that itself uses `export type *` carries no
// value for those members.
export * as TypeOnlyBarrelNamespace from './typeOnlyBarrel';

// A plain namespace re-export of a plain barrel keeps the value space.
export * as ValueBarrelNamespace from './barrel';

// A plain star export of a barrel holding a named type-only re-export keeps the
// type and masks the value.
export * from './typeReexportBarrel';
