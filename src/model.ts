// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import { errorForStatus } from './errors.ts';
import { NativeObject, fm, handlers, runTask, takeString, tokenCountCallback, type Pointer } from './native.ts';
import { withComposedPrompt, type Prompt } from './prompt.ts';
import { GenerableType, GenerationSchema } from './schema.ts';
import { Tool, toolPointers } from './tool.ts';
import { Transcript } from './transcript.ts';

export type SystemLanguageModelUseCase = 'general' | 'contentTagging';
export type SystemLanguageModelGuardrails = 'default' | 'permissiveContentTransformations';
export type SystemLanguageModelUnavailableReason =
  | 'appleIntelligenceNotEnabled'
  | 'deviceNotEligible'
  | 'modelNotReady'
  | 'unknown';

export type SystemLanguageModelAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: SystemLanguageModelUnavailableReason };

/** The variant of the on-device model. */
export interface SystemLanguageModelVariant {
  /** The user-facing name, for example `AFM 3 Core`. */
  readonly displayName: string;
}

export interface SystemLanguageModelOptions {
  useCase?: SystemLanguageModelUseCase;
  guardrails?: SystemLanguageModelGuardrails;
}

/** Anything whose token cost can be measured. A list of tools counts their definitions. */
export type TokenCountInput =
  | Prompt
  | GenerationSchema
  | GenerableType<unknown>
  | Transcript
  | readonly Tool<unknown>[]
  | { readonly instructions: string };

const useCases: Record<SystemLanguageModelUseCase, number> = { general: 0, contentTagging: 1 };
const guardrailSettings: Record<SystemLanguageModelGuardrails, number> = {
  default: 0,
  permissiveContentTransformations: 1,
};
const unavailableReasons: Record<number, SystemLanguageModelUnavailableReason> = {
  0: 'appleIntelligenceNotEnabled',
  1: 'deviceNotEligible',
  2: 'modelNotReady',
};

/** The on-device foundation model at the core of Apple Intelligence. */
export class SystemLanguageModel implements Disposable {
  readonly #handle: NativeObject;

  constructor(options: SystemLanguageModelOptions = {}) {
    const useCase = useCases[options.useCase ?? 'general'];
    const guardrails = guardrailSettings[options.guardrails ?? 'default'];
    if (useCase === undefined) throw new TypeError(`Unknown use case '${options.useCase}'`);
    if (guardrails === undefined) throw new TypeError(`Unknown guardrails '${options.guardrails}'`);
    this.#handle = new NativeObject(fm.SystemLanguageModelCreate(useCase, guardrails), 'system language model');
  }

  /** @internal */
  get pointer(): Pointer {
    return this.#handle.pointer;
  }

  /** Whether the model can be used now, and if not, why. Check this before creating sessions. */
  get availability(): SystemLanguageModelAvailability {
    const reason: [number] = [0];
    if (fm.SystemLanguageModelIsAvailable(this.pointer, reason)) return { status: 'available' };
    return { status: 'unavailable', reason: unavailableReasons[reason[0]] ?? 'unknown' };
  }

  get isAvailable(): boolean {
    return this.availability.status === 'available';
  }

  /** The most tokens one session can hold: instructions, tools, prompts, and responses combined. */
  get contextSize(): number {
    return fm.SystemLanguageModelGetContextSize(this.pointer);
  }

  /**
   * The model variant, or `undefined` before macOS 27, or when the bindings were built with an
   * older SDK; rebuild them with `npm run build:native` under Xcode 27 or later.
   */
  get variant(): SystemLanguageModelVariant | undefined {
    const displayName = takeString(fm.SystemLanguageModelGetVariantDisplayName(this.pointer));
    return displayName === null ? undefined : { displayName };
  }

  /**
   * Counts the tokens an input would consume, without generating. Compare with {@link contextSize}.
   * Requires macOS 26.4 or later.
   */
  async tokenCount(input: TokenCountInput, options: { signal?: AbortSignal } = {}): Promise<number> {
    const model = this.pointer;
    return runTask<number>({
      subscribe: (id, settle) =>
        handlers.tokenCount.set(id, (status, tokenCount, errorDescription) =>
          settle(status === 0 ? { ok: true, value: tokenCount } : { ok: false, error: errorForStatus(status, errorDescription) }),
        ),
      unsubscribe: (id) => handlers.tokenCount.delete(id),
      launch: (id): Pointer => {
        if (input instanceof GenerableType) input = input.generationSchema();
        if (input instanceof GenerationSchema) {
          return fm.SystemLanguageModelTokenCountForSchema(model, input.pointer, id, tokenCountCallback);
        }
        if (input instanceof Transcript) {
          return fm.SystemLanguageModelTokenCountForTranscript(model, input.sessionPointer, id, tokenCountCallback);
        }
        if (isTools(input)) {
          return fm.SystemLanguageModelTokenCountForTools(model, toolPointers(input), input.length, id, tokenCountCallback);
        }
        if (isInstructions(input)) {
          return fm.SystemLanguageModelTokenCountForInstructions(model, input.instructions, id, tokenCountCallback);
        }
        return withComposedPrompt(input, (prompt) =>
          fm.SystemLanguageModelTokenCountForPrompt(model, prompt, id, tokenCountCallback),
        );
      },
      signal: options.signal,
    });
  }

  [Symbol.dispose](): void {
    this.#handle[Symbol.dispose]();
  }
}

function isTools(input: TokenCountInput): input is readonly Tool<unknown>[] {
  // An empty list counts as no tools.
  return Array.isArray(input) && (input as readonly unknown[]).every((item) => item instanceof Tool);
}

function isInstructions(input: TokenCountInput): input is { readonly instructions: string } {
  return typeof input === 'object' && !Array.isArray(input) && typeof (input as { instructions?: unknown }).instructions === 'string';
}
