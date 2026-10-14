// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import { FoundationModelsError } from './errors.ts';

/**
 * Structured content the model generated against a schema.
 *
 * The native object is read eagerly and released, so this is a plain JS value with no native lifetime.
 */
export class GeneratedContent {
  /** The content as parsed JSON. */
  readonly value: unknown;
  /** Whether generation finished, as opposed to a partial snapshot. */
  readonly isComplete: boolean;

  constructor(value: unknown, isComplete = true) {
    this.value = value;
    this.isComplete = isComplete;
  }

  static fromJSON(json: string): GeneratedContent {
    return new GeneratedContent(JSON.parse(json));
  }

  /** The value of one top-level property, or `undefined` when the content has no such property. */
  property(name: string): unknown {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) {
      throw new FoundationModelsError(`Generated content is not an object, so it has no property '${name}'`);
    }
    return (this.value as Record<string, unknown>)[name];
  }

  get jsonString(): string {
    return JSON.stringify(this.value);
  }

  toJSON(): unknown {
    return this.value;
  }
}
