# Output Format

The parser returns a module object with the following structure. The default
`ResolvedModuleNode` and opt-in `SyntaxOnlyModuleNode` types are recursively
mode-aware versions of `ModuleNode`; both remain structurally compatible with
the runtime model.

```typescript
interface ModuleNode {
	name: string;
	exports: ExportNode[];
}

interface ExportNode {
	name: string;
	type: TypeNode;
	documentation?: DocumentationNode;
	isValue: boolean;
	isType: boolean;
	isNamespace: boolean;
}
```

`TypeNode` represents a TypeScript type. There are multiple classes of types. See
the contents of the `src/models/types` directory to discover them.

## Declaration Spaces

`isValue`, `isType`, and `isNamespace` report which of TypeScript's declaration
spaces the export occupies. `type` describes the resolved type shape, which does
not identify the declaration form: `export type X = 'x'` and
`export const x: X = 'x'` both resolve to the same literal type, and only the
declaration spaces tell them apart.

- `isValue`: the export exists at runtime — variables, functions, classes, enums.
- `isType`: the export names a type — type aliases, interfaces, classes, enums.
- `isNamespace`: the export declares a namespace or module.

Merged declarations occupy every space their declarations occupy: a class is
both a value and a type, `interface X {}` merged with `const X: X` is both, and
a namespace containing only types is neither a value nor a type, only a
namespace. Renamed and re-exported aliases report the spaces of the declaration
they resolve to.

## Type Operators

Authored `keyof` expressions are represented without expanding away their syntax:

```typescript
interface TypeOperatorNode {
	kind: 'typeOperator';
	operator: 'keyof';
	type: TypeNode;
	resolvedType?: TypeNode;
	resolutionKind?: 'exact' | 'baseConstraint' | 'fallback';
}

type ResolvedTypeOperatorNode = Omit<TypeOperatorNode, 'resolvedType' | 'resolutionKind'> & {
	resolvedType: TypeNode;
	resolutionKind: 'exact' | 'baseConstraint' | 'fallback';
};

type SyntaxOnlyTypeOperatorNode = Omit<TypeOperatorNode, 'resolvedType' | 'resolutionKind'> & {
	resolvedType?: never;
	resolutionKind?: never;
};
```

The exported `TypeOperatorNode` class represents both runtime modes, so its
payload fields are optional. Parser entry points correlate them recursively:
default and literal `'resolved'` calls return `ResolvedModuleNode`, literal
`'syntaxOnly'` calls return `SyntaxOnlyModuleNode`, and a dynamic mode returns
their union.

Type-query operands retain their authored expression without expanding the
queried value shape:

```typescript
interface TypeQueryNode {
	kind: 'typeQuery';
	expressionName: string;
}
```

For example, the `type` of `keyof typeof value` is a `TypeQueryNode` whose
`expressionName` is `value`.

Readonly arrays and tuples expose `isReadonly: true` in their public output,
including when they are nested inside a preserved operator:

```typescript
interface ArrayNode {
	kind: 'array';
	typeName?: TypeName;
	elementType: TypeNode;
	isReadonly?: true;
}

interface TupleNode {
	kind: 'tuple';
	typeName?: TypeName;
	types: TypeNode[];
	isReadonly?: true;
}
```

The optional field is omitted for mutable containers and serialized as `true`
for readonly containers. This keeps rendered operands and their resolved key
sets consistent.

- `type` is the authored operand. Named object operands are intentionally shallow
  references because expanding their properties does not change the operator or
  its key result.
- `resolvedType` is the checker result used to describe the keys available from
  the operator. Set `typeOperatorOutput: 'syntaxOnly'` to omit this potentially
  large payload together with `resolutionKind`; the default is `'resolved'`.
- `resolutionKind: 'exact'` means `resolvedType` is the concrete result.
- `resolutionKind: 'baseConstraint'` means the operand is still generic, so
  `resolvedType` is the best available base constraint rather than its eventual
  instantiated result. For example, `keyof T` commonly resolves to
  `string | number | symbol` at extraction time.
- `resolutionKind: 'fallback'` means the checker exposed neither a usable
  constraint nor a result the model can represent exactly; unsupported concrete
  results are represented by `any` and emit an `unsupported-type-fallback`
  warning.

Preservation follows authored operators through the supported reference,
container, mapped, indexed-access, conditional-branch, and heritage paths. It
does not reconstruct operators after TypeScript selector or inference utilities
have erased their source syntax. For example, `ReturnType`, `Parameters`,
`Awaited`, `ConstructorParameters`, `ThisParameterType`, and user-authored
conditional `infer` selectors can expose only their reduced semantic result.

## Example Output

For a React component like this:

```typescript
interface Props {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
}

export function MyComponent(props: Props) {
  return <div>{props.title}</div>;
}
```

`ModuleNode.name` is the parsed file path relative to `compilerOptions.rootDir`,
including the file extension. For a file at `src/MyComponent.ts`, the extractor
would produce:

```json
{
	"name": "src/MyComponent.ts",
	"exports": [
		{
			"name": "MyComponent",
			"type": {
				"kind": "component",
				"typeName": {
					"name": "MyComponent"
				},
				"props": [
					{
						"name": "title",
						"type": {
							"kind": "intrinsic",
							"intrinsic": "string"
						},
						"optional": false,
						"documentation": {
							"description": "The title to display"
						}
					},
					{
						"name": "disabled",
						"type": {
							"kind": "intrinsic",
							"intrinsic": "boolean"
						},
						"optional": true,
						"documentation": {
							"description": "Whether the component is disabled"
						}
					}
				]
			}
		}
	]
}
```
