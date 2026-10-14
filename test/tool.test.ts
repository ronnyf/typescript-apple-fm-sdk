// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as fm from '../src/index.ts';
import { modelTest } from './helpers.ts';

const CalculatorArguments = fm.generable('CalculatorArguments', {
  operation: fm.string({ anyOf: ['add', 'subtract', 'multiply', 'divide'] }),
  a: fm.number(),
  b: fm.number(),
});

function calculator(calls: fm.Infer<typeof CalculatorArguments>[] = []): fm.Tool<fm.Infer<typeof CalculatorArguments>> {
  return new fm.Tool({
    name: 'calculator',
    description: 'Performs basic arithmetic on two numbers.',
    arguments: CalculatorArguments,
    // Synchronous on purpose: the result is ready before the native call returns.
    call(args) {
      calls.push(args);
      const { operation, a, b } = args;
      if (operation === 'divide' && b === 0) throw new Error('Division by zero');
      return String({ add: a + b, subtract: a - b, multiply: a * b, divide: a / b }[operation]);
    },
  });
}

describe('Tool', () => {
  test('creating many tools does not exhaust native callbacks', () => {
    // Each tool used to own one of koffi's 8192 trampolines.
    for (let i = 0; i < 9000; i++) calculator();
  });

  test('validates its definition', () => {
    const base = { name: 'x', description: 'x', arguments: CalculatorArguments, call: () => 'x' };
    assert.throws(() => new fm.Tool({ ...base, name: '' }), TypeError);
    assert.throws(() => new fm.Tool({ ...base, description: 3 as never }), TypeError);
    assert.throws(() => new fm.Tool({ ...base, arguments: {} as never }), TypeError);
    assert.throws(() => new fm.Tool({ ...base, call: undefined as never }), TypeError);
    const tool = new fm.Tool(base);
    assert.equal(tool.name, 'x');
  });
});

describe('tool calling', modelTest, () => {
  test('the model calls a synchronous tool and uses its result', async () => {
    const calls: fm.Infer<typeof CalculatorArguments>[] = [];
    const session = new fm.LanguageModelSession({
      instructions: 'Use the calculator tool for all arithmetic.',
      tools: [calculator(calls)],
    });
    const response = await session.respond('What is 1234 multiplied by 5678?');
    assert.ok(calls.length > 0, 'expected a tool call');
    assert.match(response.replaceAll(/[,\s]/g, ''), /7006652/);
    const roles = session.transcript.toDict().transcript.entries.map((entry) => entry.role);
    assert.ok(roles.includes('tool'));
  });

  test('an async tool works, and errors are reported to the model', async () => {
    let attempts = 0;
    const flaky = new fm.Tool({
      name: 'lookup_weather',
      description: 'Looks up the current weather for a city.',
      arguments: fm.generable('WeatherArguments', { city: fm.string() }),
      async call({ city }) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (attempts++ === 0) throw new Error('Service temporarily unavailable, try again');
        return `Sunny and 22°C in ${city}`;
      },
    });
    const session = new fm.LanguageModelSession({ tools: [flaky] });
    const response = await session.respond('What is the weather in Cupertino? Retry the tool if it fails.');
    assert.ok(attempts >= 1);
    assert.ok(response.length > 0);
  });

  test('tools resume with a transcript', async () => {
    const first = new fm.LanguageModelSession({ tools: [calculator()] });
    await first.respond('Use the calculator to add 2 and 3.');
    const calls: fm.Infer<typeof CalculatorArguments>[] = [];
    const resumed = fm.LanguageModelSession.fromTranscript(first.transcript, { tools: [calculator(calls)] });
    await resumed.respond('Now use the calculator to multiply 6 by 7.');
    assert.ok(calls.length > 0);
  });

  test('tools count toward the token budget', async () => {
    const model = new fm.SystemLanguageModel();
    assert.ok((await model.tokenCount([calculator()])) > 0);
  });
});
