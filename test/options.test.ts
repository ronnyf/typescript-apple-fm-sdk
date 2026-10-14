// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as fm from '../src/index.ts';
import { encodeGenerationOptions } from '../src/options.ts';

describe('GenerationOptions encoding', () => {
  test('defaults encode as null', () => {
    assert.equal(encodeGenerationOptions(undefined), null);
    assert.equal(encodeGenerationOptions({}), '{}');
  });

  test('random sampling values are JSON numbers the Swift side can cast', () => {
    const json = encodeGenerationOptions({
      sampling: fm.SamplingMode.random({ top: 50, seed: 42 }),
      temperature: 0.7,
      maximumResponseTokens: 500,
    });
    assert.deepEqual(JSON.parse(json!), {
      sampling: { mode: 'random', top_k: 50, seed: 42 },
      temperature: 0.7,
      maximum_response_tokens: 500,
    });
    assert.deepEqual(JSON.parse(encodeGenerationOptions({ sampling: fm.SamplingMode.random({ probabilityThreshold: 0.9 }) })!), {
      sampling: { mode: 'random', top_p: 0.9 },
    });
    assert.deepEqual(JSON.parse(encodeGenerationOptions({ sampling: fm.SamplingMode.greedy() })!), {
      sampling: { mode: 'greedy' },
    });
  });

  test('an explicitly undefined top still encodes the threshold', () => {
    const sampling = { mode: 'random', probabilityThreshold: 0.5, top: undefined } as unknown as fm.SamplingMode;
    assert.deepEqual(JSON.parse(encodeGenerationOptions({ sampling })!), { sampling: { mode: 'random', top_p: 0.5 } });
  });

  test('invalid values are rejected', () => {
    assert.throws(() => fm.SamplingMode.random({ top: 0 }), RangeError);
    assert.throws(() => fm.SamplingMode.random({ top: 1.5 }), RangeError);
    assert.throws(() => fm.SamplingMode.random({ probabilityThreshold: 1.5 }), RangeError);
    assert.throws(() => fm.SamplingMode.random({ top: 5, seed: -1 }), RangeError);
    // @ts-expect-error: top and probabilityThreshold are exclusive.
    assert.throws(() => fm.SamplingMode.random({ top: 5, probabilityThreshold: 0.5 }), RangeError);
    // @ts-expect-error: one constraint is required.
    assert.throws(() => fm.SamplingMode.random({ seed: 1 }), RangeError);
    assert.throws(() => encodeGenerationOptions({ temperature: -0.1 }), RangeError);
    assert.throws(() => encodeGenerationOptions({ maximumResponseTokens: 0 }), RangeError);
    assert.throws(() => encodeGenerationOptions({ maximumResponseTokens: 2.5 }), RangeError);
  });
});

describe('errors', () => {
  test('status codes map to error subclasses', async () => {
    const { errorForStatus } = await import('../src/errors.ts');
    const refusal = errorForStatus(fm.GenerationErrorCode.refusal, 'nope');
    assert.ok(refusal instanceof fm.RefusalError);
    assert.ok(refusal instanceof fm.GenerationError);
    assert.ok(refusal instanceof fm.FoundationModelsError);
    assert.equal(refusal.message, 'Model refused to generate content: nope');
    assert.equal(refusal.statusCode, 9);
    assert.equal(refusal.debugDescription, 'nope');
    assert.equal(refusal.name, 'RefusalError');
    assert.ok(errorForStatus(1) instanceof fm.ExceededContextWindowSizeError);
    assert.ok(errorForStatus(10) instanceof fm.InvalidGenerationSchemaError);
    const unknown = errorForStatus(255, 'boom');
    assert.equal(unknown.constructor, fm.GenerationError);
    assert.equal(unknown.message, 'Generation error (status: 255): boom');
  });
});
