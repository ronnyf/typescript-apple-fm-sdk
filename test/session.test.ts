// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import * as fm from '../src/index.ts';
import { fixture, modelTest } from './helpers.ts';

const Cat = fm.generable(
  'Cat',
  {
    name: fm.string(),
    age: fm.integer({ description: 'Age in years', range: [0, 20] }),
    mood: fm.string({ anyOf: ['happy', 'grumpy', 'sleepy'] }),
    toys: fm.array(fm.string(), { count: 2 }),
  },
  { description: "A rescue cat's profile" },
);

describe('SystemLanguageModel', modelTest, () => {
  test('reports availability, context size, and variant', () => {
    const model = new fm.SystemLanguageModel({ useCase: 'contentTagging', guardrails: 'permissiveContentTransformations' });
    assert.deepEqual(model.availability, { status: 'available' });
    assert.ok(model.contextSize > 0);
    const { variant } = model;
    if (variant !== undefined) assert.ok(variant.displayName.length > 0);
  });

  test('counts tokens for every input kind', async () => {
    const model = new fm.SystemLanguageModel();
    const session = new fm.LanguageModelSession({ instructions: 'Be brief.' });
    await session.respond('Hi');
    const counts = await Promise.all([
      model.tokenCount('Tell me about the history of Swift.'),
      model.tokenCount(['Describe this:', 'and this']),
      model.tokenCount({ instructions: 'You are a helpful assistant.' }),
      model.tokenCount(Cat),
      model.tokenCount(Cat.generationSchema()),
      model.tokenCount(session.transcript),
      model.tokenCount([]),
    ]);
    for (const count of counts.slice(0, 6)) assert.ok(count > 0, `expected a positive count, got ${count}`);
    assert.equal(counts[3], counts[4]);
  });

  test('token counting honors an aborted signal', async () => {
    await assert.rejects(
      new fm.SystemLanguageModel().tokenCount('Hi', { signal: AbortSignal.abort() }),
      { name: 'AbortError' },
    );
  });
});

describe('LanguageModelSession', modelTest, () => {
  test('responds with text and records the transcript', async () => {
    const session = new fm.LanguageModelSession({ instructions: 'Answer in one short sentence.' });
    const response = await session.respond('What is the capital of France?');
    assert.match(response, /Paris/i);
    assert.equal(session.isResponding, false);
    const { entries } = session.transcript.toDict().transcript;
    assert.deepEqual(
      entries.map((entry) => entry.role),
      ['instructions', 'user', 'response'],
    );
  });

  test('keeps context across turns', async () => {
    const session = new fm.LanguageModelSession();
    await session.respond('My cat is named Maomao. Just say OK.');
    assert.match(await session.respond("What is my cat's name?"), /Maomao/);
  });

  test('applies generation options', async () => {
    const session = new fm.LanguageModelSession();
    const options: fm.GenerationOptions = {
      sampling: fm.SamplingMode.random({ top: 10, seed: 1 }),
      temperature: 0.3,
      maximumResponseTokens: 40,
    };
    assert.ok((await session.respond('Name a color.', { options })).length > 0);
    assert.ok(
      (await session.respond('Name a fruit.', { options: { sampling: fm.SamplingMode.greedy() } })).length > 0,
    );
  });

  test('serializes concurrent requests on one session', async () => {
    const session = new fm.LanguageModelSession({ instructions: 'Answer with one word.' });
    const responses = await Promise.all([session.respond('Say red.'), session.respond('Say blue.')]);
    assert.equal(responses.length, 2);
    assert.equal(session.transcript.toDict().transcript.entries.length, 5);
  });

  test('generates a generable type', async () => {
    const session = new fm.LanguageModelSession();
    const cat = await session.respond('Generate an adorable rescue cat.', {
      generating: Cat,
      options: { sampling: fm.SamplingMode.greedy() },
    });
    assert.equal(typeof cat.name, 'string');
    assert.ok(Number.isInteger(cat.age) && cat.age >= 0 && cat.age <= 20);
    assert.ok(['happy', 'grumpy', 'sleepy'].includes(cat.mood));
    assert.equal(cat.toys.length, 2);
  });

  test('generates against a schema or a JSON schema', async () => {
    const session = new fm.LanguageModelSession();
    const content = await session.respond('Generate a cat.', { schema: Cat.generationSchema() });
    assert.ok(content instanceof fm.GeneratedContent);
    assert.equal(typeof content.property('name'), 'string');

    const jsonSchema = JSON.parse(readFileSync(fixture('cat.json'), 'utf8'));
    const fromJSON = await session.respond('Generate a different cat.', { jsonSchema });
    assert.equal(typeof (fromJSON.property('age') as { years: unknown }).years, 'number');
  });

  test('rejects more than one guide', async () => {
    const session = new fm.LanguageModelSession();
    await assert.rejects(
      // @ts-expect-error: the guides are exclusive.
      session.respond('Hi', { generating: Cat, schema: Cat.generationSchema() }),
      TypeError,
    );
  });

  test('an invalid JSON schema fails with a generation error', async () => {
    const session = new fm.LanguageModelSession();
    await assert.rejects(session.respond('Hi', { jsonSchema: { type: 'nonsense' } }), fm.GenerationError);
  });

  test('aborting a request rejects it and leaves the session usable', async () => {
    const session = new fm.LanguageModelSession();
    const controller = new AbortController();
    const pending = session.respond('Write a 500-word essay about the ocean.', { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(session.isResponding, false);
    assert.ok((await session.respond('Say OK.')).length > 0);
  });

  test('an already-aborted signal rejects without starting', async () => {
    const session = new fm.LanguageModelSession();
    await assert.rejects(session.respond('Hi', { signal: AbortSignal.abort() }), { name: 'AbortError' });
    assert.equal(session.transcript.toDict().transcript.entries.length, 0);
  });

  test('aborting after the session is disposed rejects cleanly', async () => {
    const session = new fm.LanguageModelSession();
    const controller = new AbortController();
    const pending = session.respond('Write a 300-word essay.', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    session[Symbol.dispose]();
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  });

  test('aborting a queued request rejects it without waiting its turn', async () => {
    const session = new fm.LanguageModelSession();
    const first = session.respond('Write a 300-word essay about mountains.');
    const controller = new AbortController();
    const queued = session.respond('Say OK.', { signal: controller.signal });
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(queued, { name: 'AbortError' });
    assert.ok(performance.now() - started < 500, 'the queued request should reject promptly');
    await first;
  });

  test('disposing makes the session unusable', async () => {
    const session = new fm.LanguageModelSession();
    session[Symbol.dispose]();
    assert.throws(() => session.isResponding, fm.FoundationModelsError);
  });
});

describe('streaming', modelTest, () => {
  test('yields growing snapshots and records the transcript', async () => {
    const session = new fm.LanguageModelSession();
    const snapshots: string[] = [];
    for await (const snapshot of session.streamResponse('Count from 1 to 10, separated by commas.')) {
      snapshots.push(snapshot);
    }
    assert.ok(snapshots.length > 0);
    for (let i = 1; i < snapshots.length; i++) assert.ok(snapshots[i]!.startsWith(snapshots[i - 1]!.slice(0, -1)));
    assert.match(snapshots.at(-1)!, /10/);
    assert.equal(session.transcript.toDict().transcript.entries.length, 2);
  });

  test('breaking early cancels generation and frees the session', async () => {
    const session = new fm.LanguageModelSession();
    for await (const _ of session.streamResponse('Write a long story about a dragon.')) break;
    assert.equal(session.isResponding, false);
    assert.ok((await session.respond('Say OK.')).length > 0);
  });

  test('an abandoned iterator frees the session when generation ends', async () => {
    const session = new fm.LanguageModelSession();
    const iterator = session.streamResponse('Count from 1 to 5.');
    await iterator.next(); // Never finished or returned.
    assert.ok((await session.respond('Say OK.')).length > 0);
  });

  test('aborting a stream after dispose ends it with the abort reason', async () => {
    const session = new fm.LanguageModelSession();
    const controller = new AbortController();
    await assert.rejects(
      (async () => {
        for await (const _ of session.streamResponse('Write a long story.', { signal: controller.signal })) {
          session[Symbol.dispose]();
          controller.abort();
        }
      })(),
      { name: 'AbortError' },
    );
  });

  test('aborting rejects the iteration', async () => {
    const session = new fm.LanguageModelSession();
    const controller = new AbortController();
    await assert.rejects(
      (async () => {
        for await (const _ of session.streamResponse('Write a long story.', { signal: controller.signal })) {
          controller.abort();
        }
      })(),
      { name: 'AbortError' },
    );
  });

  test('applies generation options', async () => {
    const session = new fm.LanguageModelSession();
    let last = '';
    for await (const snapshot of session.streamResponse('Name three colors.', {
      options: { temperature: 0.2, maximumResponseTokens: 30 },
    })) {
      last = snapshot;
    }
    assert.ok(last.length > 0);
  });
});

describe('transcripts', modelTest, () => {
  test('round-trip a Swift-exported transcript', async () => {
    const data = JSON.parse(readFileSync(fixture('test_transcript_full.json'), 'utf8'));
    const transcript = fm.Transcript.fromDict(data);
    assert.equal(transcript.toDict().transcript.entries.length, data.transcript.entries.length);

    const session = fm.LanguageModelSession.fromTranscript(transcript);
    assert.ok((await session.respond('Summarize our conversation in one sentence.')).length > 0);
    assert.equal(session.transcript.toDict().transcript.entries.length, data.transcript.entries.length + 2);
    // The source transcript is untouched.
    assert.equal(transcript.toDict().transcript.entries.length, data.transcript.entries.length);
  });

  test('reject malformed data', () => {
    assert.throws(() => fm.Transcript.fromDict({ nonsense: true }), fm.DecodingFailureError);
  });
});

describe('image prompts', modelTest, () => {
  test('a missing file is rejected up front', () => {
    assert.throws(() => new fm.ImageAttachment('/no/such/image.png'), fm.ImagePromptError);
  });

  test('an image attachment is described', async (t) => {
    const session = new fm.LanguageModelSession();
    const image = new fm.ImageAttachment(fixture('test-simple-image.jpeg'), 'photo');
    try {
      const response = await session.respond(['Describe the image labeled photo in one sentence.', image]);
      assert.ok(response.length > 0);
    } catch (error) {
      if (error instanceof fm.ImagePromptError) t.skip(error.message);
      else throw error;
    }
  });
});
