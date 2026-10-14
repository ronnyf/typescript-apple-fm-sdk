// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

/**
 * Schemas for guided generation: describe a type once with the field builders, get both the native
 * `GenerationSchema` and the TypeScript type of what the model returns.
 *
 * ```ts
 * const Cat = fm.generable('Cat', {
 *   name: fm.string(),
 *   age: fm.integer({ description: 'Age in years', range: [0, 20] }),
 * }, { description: "A cat's profile" });
 * type Cat = fm.Infer<typeof Cat>; // { name: string; age: number }
 * ```
 */

import { FoundationModelsError, InvalidGenerationSchemaError } from './errors.ts';
import { NativeObject, callReportingError, fm, takeString, type Pointer } from './native.ts';

type ScalarKind = 'string' | 'integer' | 'number' | 'boolean';

/** @internal */
export type Guide =
  | { readonly kind: 'anyOf'; readonly values: readonly string[] }
  | { readonly kind: 'regex'; readonly pattern: string }
  | { readonly kind: 'minimum' | 'maximum'; readonly value: number }
  | { readonly kind: 'range'; readonly min: number; readonly max: number }
  | { readonly kind: 'count' | 'minItems' | 'maxItems'; readonly value: number };

/** @internal */
export type ElementType =
  | { readonly kind: ScalarKind; readonly guides: readonly Guide[] }
  | { readonly kind: 'reference'; readonly target: () => GenerableType<unknown> };

/** @internal */
export type FieldType = ElementType | { readonly kind: 'array'; readonly element: ElementType; readonly guides: readonly Guide[] };

/** One property of a generable type. `T` is the value the model produces for it. */
export class Field<T, Optional extends boolean = false> {
  declare readonly _value: T;
  readonly description: string | undefined;
  readonly isOptional: Optional;
  /** @internal */
  readonly type: FieldType;

  /** @internal */
  constructor(type: FieldType, description: string | undefined, isOptional: Optional) {
    this.type = type;
    this.description = description;
    this.isOptional = isOptional;
  }
}

/** The properties of a generable type, keyed by property name. */
export type Shape = { readonly [property: string]: Field<unknown, boolean> | GenerableType<unknown> };

type ValueOf<F> = F extends Field<infer T, boolean> ? T : F extends GenerableType<infer T> ? T : never;
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends Field<unknown, true> ? K : never }[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** The object type a shape describes; optional fields become optional properties. */
export type InferShape<S extends Shape> = Simplify<
  { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & {
    -readonly [K in OptionalKeys<S>]?: ValueOf<S[K]>;
  }
>;

/** The value type of a generable type: `fm.Infer<typeof Cat>`. */
export type Infer<G extends GenerableType<unknown>> = G extends GenerableType<infer T> ? T : never;

// MARK: - Field builders

interface Described {
  description?: string;
}

export interface StringFieldOptions extends Described {
  /** A regular expression the whole value must match. */
  regex?: string;
}

/** A string, optionally constrained to a fixed set of values or to a pattern. */
export function string(options?: StringFieldOptions): Field<string>;
export function string<const V extends string>(options: Described & { anyOf: readonly V[] }): Field<V>;
export function string<const V extends string>(options: Described & { constant: V }): Field<V>;
export function string(
  options: StringFieldOptions & { anyOf?: readonly string[]; constant?: string } = {},
): Field<string> {
  const guides: Guide[] = [];
  if (options.anyOf !== undefined) {
    if (options.anyOf.length === 0 || !options.anyOf.every((value) => typeof value === 'string')) {
      throw new TypeError('anyOf must be a non-empty list of strings');
    }
    guides.push({ kind: 'anyOf', values: [...options.anyOf] });
  }
  if (options.constant !== undefined) {
    if (typeof options.constant !== 'string') throw new TypeError('constant must be a string');
    guides.push({ kind: 'anyOf', values: [options.constant] });
  }
  if (options.regex !== undefined) {
    if (typeof options.regex !== 'string') throw new TypeError('regex must be a string');
    guides.push({ kind: 'regex', pattern: options.regex });
  }
  return new Field({ kind: 'string', guides }, options.description, false);
}

export interface NumericFieldOptions extends Described {
  minimum?: number;
  maximum?: number;
  /** Inclusive `[minimum, maximum]`. */
  range?: readonly [number, number];
}

/** An integer; bounds must be safe integers. */
export function integer(options: NumericFieldOptions = {}): Field<number> {
  return new Field({ kind: 'integer', guides: numericGuides(options, 'integer') }, options.description, false);
}

/** A floating-point number. */
export function number(options: NumericFieldOptions = {}): Field<number> {
  return new Field({ kind: 'number', guides: numericGuides(options, 'number') }, options.description, false);
}

export function boolean(options: Described = {}): Field<boolean> {
  return new Field({ kind: 'boolean', guides: [] }, options.description, false);
}

function numericGuides(options: NumericFieldOptions, kind: 'integer' | 'number'): Guide[] {
  // Swift converts integer bounds with Int(_:) and builds ranges with `min...max`; both trap on bad input.
  const check = (name: string, value: number) => {
    const valid = kind === 'integer' ? Number.isSafeInteger(value) : Number.isFinite(value);
    if (!valid) throw new RangeError(`${name} must be ${kind === 'integer' ? 'a safe integer' : 'a finite number'}`);
  };
  const guides: Guide[] = [];
  if (options.minimum !== undefined) {
    check('minimum', options.minimum);
    guides.push({ kind: 'minimum', value: options.minimum });
  }
  if (options.maximum !== undefined) {
    check('maximum', options.maximum);
    guides.push({ kind: 'maximum', value: options.maximum });
  }
  if (options.range !== undefined) {
    const [min, max] = options.range;
    check('range minimum', min);
    check('range maximum', max);
    if (min > max) throw new RangeError(`range minimum ${min} is greater than its maximum ${max}`);
    guides.push({ kind: 'range', min, max });
  }
  return guides;
}

export interface ArrayFieldOptions extends Described {
  /** The exact number of elements. */
  count?: number;
  minItems?: number;
  maxItems?: number;
}

/**
 * A list of strings, integers, numbers, or generable values. Guides on a scalar `element` apply to
 * each element; the element's own description is not used.
 */
export function array<T>(element: Field<T> | GenerableType<T>, options: ArrayFieldOptions = {}): Field<T[]> {
  const elementField = asField(element);
  const elementType = elementField.type;
  if (elementField.isOptional) throw new TypeError('Array elements cannot be optional');
  if (elementType.kind === 'array') throw new TypeError('Nested arrays are not supported');
  if (elementType.kind === 'boolean') throw new TypeError('Arrays of booleans are not supported by the native bindings');

  const guides: Guide[] = [];
  const checkCount = (name: string, value: number, minimum: number) => {
    if (!(Number.isSafeInteger(value) && value >= minimum)) {
      throw new RangeError(`${name} must be an integer of at least ${minimum}`);
    }
  };
  if (options.count !== undefined) {
    checkCount('count', options.count, 1);
    guides.push({ kind: 'count', value: options.count });
  }
  if (options.minItems !== undefined) {
    checkCount('minItems', options.minItems, 0);
    guides.push({ kind: 'minItems', value: options.minItems });
  }
  if (options.maxItems !== undefined) {
    checkCount('maxItems', options.maxItems, 0);
    guides.push({ kind: 'maxItems', value: options.maxItems });
  }
  return new Field({ kind: 'array', element: elementType, guides }, options.description, false);
}

/** Makes a field optional: the model may omit it, and its property becomes optional. */
export function optional<T>(field: Field<T> | GenerableType<T>): Field<T, true> {
  const { type, description } = asField(field);
  return new Field(type, description, true);
}

/**
 * A field holding another generable type. Pass a function to refer to a type defined later, or to
 * the type being defined; annotate that type explicitly so TypeScript can resolve the cycle:
 *
 * ```ts
 * interface Folder { name: string; children: Folder[] }
 * const Folder: fm.GenerableType<Folder> = fm.generable('Folder', {
 *   name: fm.string(),
 *   children: fm.array(fm.ref(() => Folder), { maxItems: 3 }),
 * });
 * ```
 */
export function ref<T>(target: GenerableType<T> | (() => GenerableType<T>), options: Described = {}): Field<T> {
  const resolve = target instanceof GenerableType ? () => target : target;
  return new Field({ kind: 'reference', target: resolve }, options.description, false);
}

function asField<T>(entry: Field<T, boolean> | GenerableType<T>): Field<T, boolean> {
  if (entry instanceof GenerableType) return ref(entry);
  if (entry instanceof Field) return entry;
  throw new TypeError(`Expected a field builder such as fm.string() or a generable type, got ${String(entry)}`);
}

// MARK: - Generable types

export interface GenerableOptions {
  /** Context for the model about what this type represents. */
  description?: string;
}

/** A type the model can generate, created with {@link generable}. */
export class GenerableType<T> {
  declare readonly _value: T;
  readonly name: string;
  readonly description: string | undefined;
  /** @internal */
  readonly shape: Shape;
  #schema: GenerationSchema | undefined;

  /** @internal */
  constructor(name: string, shape: Shape, description: string | undefined) {
    this.name = name;
    this.shape = shape;
    this.description = description;
  }

  /** The native schema for this type, built and validated on first use. */
  generationSchema(): GenerationSchema {
    if (this.#schema === undefined) {
      const schema = new GenerationSchema(buildNativeSchema(this as GenerableType<unknown>));
      schema.toDict(); // Surfaces native build errors, such as an invalid regex, here rather than mid-request.
      this.#schema = schema;
    }
    return this.#schema;
  }

  /** @internal Converts generated JSON to `T`, dropping `null` optional properties. */
  decode(value: unknown): T {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new FoundationModelsError(`Failed to convert generated content to ${this.name}: expected an object`);
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [property, entry] of Object.entries(this.shape)) {
      const field = asField(entry);
      const raw = source[property];
      if (raw === undefined || raw === null) {
        if (field.isOptional) continue;
        throw new FoundationModelsError(
          `Failed to convert generated content to ${this.name}: missing required property '${property}'`,
        );
      }
      result[property] = decodeValue(field.type, raw, `${this.name}.${property}`);
    }
    return result as T;
  }
}

function decodeValue(type: FieldType, raw: unknown, path: string): unknown {
  switch (type.kind) {
    case 'reference':
      return type.target().decode(raw);
    case 'array': {
      if (!Array.isArray(raw)) throw new FoundationModelsError(`Failed to convert ${path}: expected an array`);
      const { element } = type;
      return element.kind === 'reference' ? raw.map((item) => element.target().decode(item)) : raw;
    }
    default:
      return raw;
  }
}

const typeNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Type names the bindings resolve to scalars instead of references.
const reservedTypeNames = new Set(['string', 'number', 'float', 'double', 'integer', 'int', 'boolean', 'bool']);

/**
 * Defines a type the model can generate. `name` identifies the type inside schemas, so it must be
 * an identifier and unique among the types one schema references.
 */
export function generable<const S extends Shape>(
  name: string,
  shape: S,
  options: GenerableOptions = {},
): GenerableType<InferShape<S>> {
  // Swift matches array references with /array<(\w+)>/.
  if (!typeNamePattern.test(name)) {
    throw new InvalidGenerationSchemaError(`Generable type name '${name}' must be an identifier`);
  }
  if (reservedTypeNames.has(name)) {
    throw new InvalidGenerationSchemaError(`Generable type name '${name}' is reserved for a built-in type`);
  }
  const entries = Object.entries(shape);
  if (entries.length === 0) throw new InvalidGenerationSchemaError(`Generable type '${name}' has no properties`);
  for (const [property, entry] of entries) {
    if (!(entry instanceof Field || entry instanceof GenerableType)) {
      throw new InvalidGenerationSchemaError(
        `Property '${property}' of '${name}' must be a field builder such as fm.string(), or a generable type`,
      );
    }
  }
  return new GenerableType(name, Object.freeze({ ...shape }), options.description);
}

// MARK: - Native schema

/** A schema in its native form, for guided generation and token counting. */
export class GenerationSchema {
  readonly #handle: NativeObject;

  /** @internal */
  constructor(handle: NativeObject) {
    this.#handle = handle;
  }

  /** @internal */
  get pointer(): Pointer {
    return this.#handle.pointer;
  }

  /** The schema as JSON Schema, in the form the framework encodes it. */
  toDict(): Record<string, unknown> {
    const json = callReportingError('Failed to serialize GenerationSchema', (errorCode, errorDescription) =>
      fm.GenerationSchemaGetJSONString(this.pointer, errorCode, errorDescription),
    );
    return JSON.parse(takeString(json) ?? 'null');
  }
}

function buildNativeSchema(root: GenerableType<unknown>): NativeObject {
  const schema = createSchemaNode(root);
  try {
    // The bindings resolve every reference against the root's dependency list, so flatten the graph.
    for (const dependency of collectDependencies(root)) {
      const node = createSchemaNode(dependency);
      try {
        fm.GenerationSchemaAddReferenceSchema(schema.pointer, node.pointer);
      } finally {
        node[Symbol.dispose]();
      }
    }
  } catch (error) {
    schema[Symbol.dispose]();
    throw error;
  }
  return schema;
}

function collectDependencies(root: GenerableType<unknown>): GenerableType<unknown>[] {
  const byName = new Map<string, GenerableType<unknown>>([[root.name, root]]);
  const dependencies: GenerableType<unknown>[] = [];
  const visit = (type: GenerableType<unknown>) => {
    for (const entry of Object.values(type.shape)) {
      const target = referencedType(asField(entry).type, type.name);
      if (target === undefined) continue;
      const existing = byName.get(target.name);
      if (existing === target) continue;
      if (existing !== undefined) {
        throw new InvalidGenerationSchemaError(
          `Schema for '${root.name}' references two different generable types named '${target.name}'`,
        );
      }
      byName.set(target.name, target);
      dependencies.push(target);
      visit(target);
    }
  };
  visit(root);
  return dependencies;
}

function referencedType(type: FieldType, owner: string): GenerableType<unknown> | undefined {
  const reference = type.kind === 'array' ? type.element : type;
  if (reference.kind !== 'reference') return undefined;
  const target = reference.target();
  if (!(target instanceof GenerableType)) {
    throw new InvalidGenerationSchemaError(`A reference in '${owner}' did not resolve to a generable type`);
  }
  return target;
}

function nativeTypeName(type: FieldType): string {
  switch (type.kind) {
    case 'reference':
      return type.target().name;
    case 'array':
      return `array<${nativeTypeName(type.element)}>`;
    default:
      return type.kind;
  }
}

function createSchemaNode(type: GenerableType<unknown>): NativeObject {
  const node = new NativeObject(fm.GenerationSchemaCreate(type.name, type.description ?? null), `schema for ${type.name}`);
  try {
    for (const [property, entry] of Object.entries(type.shape)) addProperty(node.pointer, property, asField(entry));
  } catch (error) {
    node[Symbol.dispose]();
    throw error;
  }
  return node;
}

function addProperty(schema: Pointer, name: string, field: Field<unknown, boolean>): void {
  const { type } = field;
  const property: Pointer = fm.GenerationSchemaPropertyCreate(
    name,
    field.description ?? null,
    nativeTypeName(type),
    field.isOptional,
  );
  try {
    if (type.kind === 'array') {
      for (const guide of type.guides) addGuide(property, guide, false);
      if (type.element.kind !== 'reference') {
        for (const guide of type.element.guides) addGuide(property, guide, true);
      }
    } else if (type.kind !== 'reference') {
      for (const guide of type.guides) addGuide(property, guide, false);
    }
    fm.GenerationSchemaAddProperty(schema, property);
  } finally {
    fm.Release(property);
  }
}

function addGuide(property: Pointer, guide: Guide, wrapped: boolean): void {
  switch (guide.kind) {
    case 'anyOf':
      fm.GenerationSchemaPropertyAddAnyOfGuide(property, guide.values, guide.values.length, wrapped);
      break;
    case 'regex':
      fm.GenerationSchemaPropertyAddRegex(property, guide.pattern, wrapped);
      break;
    case 'minimum':
      fm.GenerationSchemaPropertyAddMinimumGuide(property, guide.value, wrapped);
      break;
    case 'maximum':
      fm.GenerationSchemaPropertyAddMaximumGuide(property, guide.value, wrapped);
      break;
    case 'range':
      fm.GenerationSchemaPropertyAddRangeGuide(property, guide.min, guide.max, wrapped);
      break;
    case 'count':
      fm.GenerationSchemaPropertyAddCountGuide(property, guide.value, wrapped);
      break;
    case 'minItems':
      fm.GenerationSchemaPropertyAddMinItemsGuide(property, guide.value);
      break;
    case 'maxItems':
      fm.GenerationSchemaPropertyAddMaxItemsGuide(property, guide.value);
      break;
  }
}
