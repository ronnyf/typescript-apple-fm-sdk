// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import * as fm from '../src/index.ts';
import { fixture } from './helpers.ts';

const Age = fm.generable('Age', { years: fm.integer(), months: fm.integer() });
const Cat = fm.generable(
  'Cat',
  {
    name: fm.string(),
    age: fm.ref(Age, { description: 'The age of the cat, at most 20 years' }),
    profile: fm.string({ description: "One sentence about this cat's personality" }),
  },
  { description: 'A description of a cute cat' },
);

interface Folder {
  name: string;
  children: Folder[];
  parent?: Folder;
}
const Folder: fm.GenerableType<Folder> = fm.generable('Folder', {
  name: fm.string(),
  children: fm.array(fm.ref(() => Folder), { maxItems: 3 }),
  parent: fm.optional(fm.ref(() => Folder)),
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(): T | void => {};

describe('type inference', () => {
  test('shapes infer value types', () => {
    const Pet = fm.generable('Pet', {
      kind: fm.string({ anyOf: ['cat', 'dog'] }),
      status: fm.string({ constant: 'adopted' }),
      tags: fm.array(fm.string(), { count: 2 }),
      scores: fm.array(fm.number()),
      nickname: fm.optional(fm.string()),
      owner: Age,
      friendly: fm.boolean(),
    });
    assertType<
      Equal<
        fm.Infer<typeof Pet>,
        {
          kind: 'cat' | 'dog';
          status: 'adopted';
          tags: string[];
          scores: number[];
          owner: { years: number; months: number };
          friendly: boolean;
          nickname?: string;
        }
      >
    >();
    assert.equal(Pet.name, 'Pet');
  });
});

describe('GenerationSchema', () => {
  test('matches the schema the Swift framework encodes for the same type', () => {
    const expected = JSON.parse(readFileSync(fixture('cat.json'), 'utf8'));
    assert.deepEqual(Cat.generationSchema().toDict(), expected);
  });

  test('is cached per type', () => {
    assert.equal(Cat.generationSchema(), Cat.generationSchema());
  });

  test('guides serialize into the schema', () => {
    const Hedgehog = fm.generable('Hedgehog', {
      name: fm.string({ regex: '^[A-Z][a-z]+$' }),
      age: fm.integer({ range: [0, 8] }),
      weight: fm.number({ minimum: 0.5, maximum: 2 }),
      foods: fm.array(fm.string({ anyOf: ['worms', 'beetles'] }), { minItems: 1, maxItems: 4 }),
      scores: fm.array(fm.integer({ range: [0, 100] }), { count: 3 }),
      nickname: fm.optional(fm.string()),
    });
    const { properties, required } = Hedgehog.generationSchema().toDict() as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    assert.deepEqual(required, ['name', 'age', 'weight', 'foods', 'scores']);
    assert.equal(properties['age']!['minimum'], 0);
    assert.equal(properties['age']!['maximum'], 8);
    assert.equal(properties['weight']!['minimum'], 0.5);
    assert.equal(properties['foods']!['minItems'], 1);
    assert.equal(properties['foods']!['maxItems'], 4);
    assert.deepEqual((properties['foods']!['items'] as { enum: string[] }).enum, ['worms', 'beetles']);
    assert.equal(properties['scores']!['minItems'], 3);
    assert.equal(properties['scores']!['maxItems'], 3);
    assert.equal((properties['scores']!['items'] as { maximum: number }).maximum, 100);
    assert.ok(String(properties['name']!['pattern']).includes('[A-Z]'));
  });

  test('arrays of generable types keep their description', () => {
    const Club = fm.generable('Club', { members: fm.array(Age, { description: 'Member ages', maxItems: 2 }) });
    const { properties } = Club.generationSchema().toDict() as { properties: Record<string, { description?: string }> };
    assert.equal(properties['members']!.description, 'Member ages');
  });

  test('self-referential types resolve', () => {
    const schema = Folder.generationSchema().toDict() as { properties: Record<string, unknown> };
    assert.deepEqual(Object.keys(schema.properties).sort(), ['children', 'name', 'parent']);
  });

  test('nested types are collected transitively', () => {
    const Shelter = fm.generable('Shelter', { cats: fm.array(Cat, { maxItems: 3 }), name: fm.string() });
    const schema = Shelter.generationSchema().toDict() as { $defs: Record<string, unknown> };
    assert.deepEqual(Object.keys(schema.$defs).sort(), ['Age', 'Cat']);
  });

  test('invalid definitions are rejected', () => {
    assert.throws(() => fm.generable('Not a name', { a: fm.string() }), fm.InvalidGenerationSchemaError);
    assert.throws(() => fm.generable('Empty', {}), fm.InvalidGenerationSchemaError);
    assert.throws(() => fm.generable('number', { a: fm.string() }), /reserved/);
    // @ts-expect-error: plain values are not fields.
    assert.throws(() => fm.generable('Bad', { a: 'string' }), fm.InvalidGenerationSchemaError);
    assert.throws(() => fm.integer({ range: [5, 1] }), RangeError);
    assert.throws(() => fm.integer({ minimum: 1.5 }), RangeError);
    assert.throws(() => fm.number({ maximum: Number.NaN }), RangeError);
    assert.throws(() => fm.array(fm.boolean()), TypeError);
    assert.throws(() => fm.array(fm.array(fm.string()) as never), TypeError);
    assert.throws(() => fm.array(fm.string(), { count: 0 }), RangeError);
    assert.throws(() => fm.string({ anyOf: [] }), TypeError);

    const OtherAge = fm.generable('Age', { value: fm.integer() });
    const Clash = fm.generable('Clash', { a: Age, b: OtherAge });
    assert.throws(() => Clash.generationSchema(), /two different generable types named 'Age'/);

    const BadRegex = fm.generable('BadRegex', { a: fm.string({ regex: '([' }) });
    assert.throws(() => BadRegex.generationSchema(), fm.InvalidGenerationSchemaError);
  });
});

describe('decoding', () => {
  test('optional nulls are dropped and nested types decoded', () => {
    const value = Folder.decode({
      name: 'root',
      children: [{ name: 'child', children: [], parent: null }],
      parent: null,
      extra: 'ignored',
    });
    assert.deepEqual(value, { name: 'root', children: [{ name: 'child', children: [] }] });
  });

  test('missing required properties are an error', () => {
    assert.throws(() => Cat.decode({ name: 'Maomao' }), /missing required property 'age'/);
    assert.throws(() => Cat.decode('not an object'), /expected an object/);
  });

  test('GeneratedContent exposes properties', () => {
    const content = fm.GeneratedContent.fromJSON('{"name":"Maomao","age":2}');
    assert.equal(content.property('name'), 'Maomao');
    assert.equal(content.property('missing'), undefined);
    assert.equal(content.isComplete, true);
    assert.equal(JSON.stringify(content), '{"name":"Maomao","age":2}');
    assert.throws(() => new fm.GeneratedContent([1]).property('x'), fm.FoundationModelsError);
  });
});
