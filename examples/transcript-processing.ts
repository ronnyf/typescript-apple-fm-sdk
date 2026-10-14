// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

// Analyze a transcript exported from a Swift app, then continue the conversation.
// Run: node examples/transcript-processing.ts [transcript.json]

import { readFileSync } from 'node:fs';

import * as fm from '../src/index.ts';

const path = process.argv[2] ?? new URL('../test/fixtures/test_transcript_full.json', import.meta.url);
const data: fm.TranscriptData = JSON.parse(readFileSync(path, 'utf8'));
const { entries } = data.transcript;

const text = (entry: fm.TranscriptEntry) =>
  (entry.contents ?? []).flatMap((content) => (content.type === 'text' && content.text ? [content.text] : [])).join(' ');
const byRole = Object.groupBy(entries, (entry) => entry.role);
const toolCalls = (byRole.response ?? []).flatMap((entry) => (entry['toolCalls'] as unknown[] | undefined) ?? []);

console.log(`Entries: ${entries.length}`);
for (const [role, group = []] of Object.entries(byRole)) console.log(`  ${role}: ${group.length}`);
console.log(`Tool calls: ${toolCalls.length}`);
console.log(`Structured output requested: ${(byRole.user ?? []).some((entry) => 'responseFormat' in entry)}`);
for (const entry of entries.slice(0, 5)) console.log(`\n[${entry.role}] ${text(entry).slice(0, 120)}`);

// Tool calls in the transcript are history; pass tools to fromTranscript to allow new calls.
const transcript = fm.Transcript.fromDict(data);
const model = new fm.SystemLanguageModel();
console.log(`\nTranscript uses ${await model.tokenCount(transcript)} of ${model.contextSize} tokens.`);
const session = fm.LanguageModelSession.fromTranscript(transcript);
console.log(`Summary: ${await session.respond('Summarize this conversation in one sentence.')}`);
