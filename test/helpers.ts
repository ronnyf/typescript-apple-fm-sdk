// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import * as fm from '../src/index.ts';

/** Model-backed tests skip when the model is unavailable, or when FM_SKIP_MODEL_TESTS is set. */
export const modelTest: { skip: string | false } = {
  skip: process.env['FM_SKIP_MODEL_TESTS']
    ? 'FM_SKIP_MODEL_TESTS is set'
    : new fm.SystemLanguageModel().isAvailable
      ? false
      : 'the system language model is unavailable',
};

export const fixture = (name: string): URL => new URL(`./fixtures/${name}`, import.meta.url);
