// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

// Create a session and hold a short conversation.  Run: node examples/simple-inference.ts

import * as fm from '../src/index.ts';

const model = new fm.SystemLanguageModel();
const { availability } = model;
if (availability.status !== 'available') {
  console.log(`Model not available: ${availability.reason}`);
  process.exit(1);
}

const session = new fm.LanguageModelSession({
  instructions: 'You are a helpful assistant that provides concise answers.',
});

for (const prompt of ['What is the capital of France?', 'What is its population?']) {
  console.log(`User: ${prompt}`);
  console.log(`Assistant: ${await session.respond(prompt)}\n`);
}
