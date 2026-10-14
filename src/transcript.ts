// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import { NativeObject, callReportingError, fm, takeString, type Pointer } from './native.ts';

/** One piece of an entry's content. `text` and `structure` are the common types. */
export interface TranscriptContent {
  readonly type: string;
  readonly id?: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

/** One turn in a transcript; role-specific fields include `tools`, `toolCalls`, `toolName`, and `options`. */
export interface TranscriptEntry {
  readonly id: string;
  readonly role: 'instructions' | 'user' | 'response' | 'tool';
  readonly contents?: readonly TranscriptContent[];
  readonly [key: string]: unknown;
}

/** A transcript in the JSON form the Swift framework encodes, so it can round-trip with Swift apps. */
export interface TranscriptData {
  readonly version: number;
  readonly type: string;
  readonly transcript: { readonly entries: readonly TranscriptEntry[] };
}

/**
 * The history of a session: instructions, prompts, responses, and tool calls. Updated when a
 * request completes; failed or cancelled requests leave it unchanged.
 *
 * Tool calls in a transcript are history only; pass tools to
 * {@link LanguageModelSession.fromTranscript} to let the model make new calls.
 */
export class Transcript {
  // The bindings have no transcript object; a transcript is read from, and carried by, a session.
  readonly #session: NativeObject;

  /** @internal */
  constructor(session: NativeObject) {
    this.#session = session;
  }

  /** Decodes a transcript, for example one a Swift app exported, from its JSON form. */
  static fromDict(data: TranscriptData | object): Transcript {
    const session = callReportingError('Failed to create transcript from dictionary', (errorCode, errorDescription) =>
      fm.TranscriptCreateFromJSONString(JSON.stringify(data), errorCode, errorDescription),
    );
    return new Transcript(new NativeObject(session, 'transcript'));
  }

  /** @internal */
  get sessionPointer(): Pointer {
    return this.#session.pointer;
  }

  /** A snapshot of the transcript in its JSON form. */
  toDict(): TranscriptData {
    const json = callReportingError('Failed to fetch session transcript', (errorCode, errorDescription) =>
      fm.LanguageModelSessionGetTranscriptJSONString(this.sessionPointer, errorCode, errorDescription),
    );
    return JSON.parse(takeString(json) ?? 'null');
  }

  toJSON(): TranscriptData {
    return this.toDict();
  }
}
