// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

// Stream a response as it's generated.  Run: node examples/streaming.ts

import * as fm from '../src/index.ts';

const session = new fm.LanguageModelSession({ instructions: 'You are a helpful assistant.' });
const prompt = 'Tell me a short story about a cat.';
console.log(`User: ${prompt}\n`);
process.stdout.write('Assistant: ');

// Each snapshot is the whole response so far; print only what's new.
let printed = '';
for await (const snapshot of session.streamResponse(prompt)) {
  process.stdout.write(snapshot.startsWith(printed) ? snapshot.slice(printed.length) : `\n${snapshot}`);
  printed = snapshot;
}
process.stdout.write('\n');
