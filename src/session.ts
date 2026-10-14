// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import { GeneratedContent } from './content.ts';
import { FoundationModelsError, errorForStatus } from './errors.ts';
import type { SystemLanguageModel } from './model.ts';
import {
  NativeObject,
  allocateHandlerId,
  fm,
  handlers,
  responseCallback,
  retainEventLoop,
  runTask,
  structuredResponseCallback,
  type Pointer,
  type TaskResult,
} from './native.ts';
import { encodeGenerationOptions, type GenerationOptions } from './options.ts';
import { withComposedPrompt, type Prompt } from './prompt.ts';
import type { GenerableType, GenerationSchema } from './schema.ts';
import { toolPointers, type Tool } from './tool.ts';
import { Transcript } from './transcript.ts';

export interface LanguageModelSessionOptions {
  /** Guidance that applies to every request in the session, for example a role or a tone. */
  instructions?: string;
  /** Defaults to the system model with default settings. */
  model?: SystemLanguageModel;
  /** Tools the model may call while it responds. */
  tools?: readonly Tool<unknown>[];
}

export interface RequestOptions {
  options?: GenerationOptions;
  /** Cancels the request; the promise, or the stream, rejects with `signal.reason`. */
  signal?: AbortSignal;
}

type NoGuide = { generating?: never; schema?: never; jsonSchema?: never };

type RespondOptions<T> = RequestOptions &
  (
    | NoGuide
    | { generating: GenerableType<T>; schema?: never; jsonSchema?: never }
    | { schema: GenerationSchema; generating?: never; jsonSchema?: never }
    | { jsonSchema: object; generating?: never; schema?: never }
  );

const transcriptSource = Symbol('transcriptSource');
interface CreationOptions extends LanguageModelSessionOptions {
  [transcriptSource]?: Transcript;
}

// How long to wait for the framework to wind down a cancelled request before accepting new ones.
const cancellationGracePeriodMs = 1000;
const cancellationPollIntervalMs = 10;

/** Serializes requests: a session handles one at a time. */
class Mutex {
  #tail: Promise<void> = Promise.resolve();

  /** Resolves with an idempotent unlock function; rejects with `signal.reason` if aborted while waiting. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const previous = this.#tail;
    this.#tail = previous.then(() => released);
    const acquired = previous.then(() => release);
    if (!signal) return acquired;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        // Give up the place in line, but only once it's reached, so the order holds.
        void acquired.then((unlock) => unlock());
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      void acquired.then((unlock) => {
        if (signal.aborted) return;
        signal.removeEventListener('abort', onAbort);
        resolve(unlock);
      });
    });
  }
}

/**
 * A conversation with the model. The session keeps a transcript, so each request sees the ones
 * before it. Requests on one session run one at a time; create more sessions to run requests in
 * parallel.
 */
export class LanguageModelSession implements Disposable {
  /** The session's history; it reads the live session, so it's always current. */
  readonly transcript: Transcript;
  readonly #handle: NativeObject;
  // Held so their native callbacks outlive every request that might call them.
  readonly #tools: readonly Tool<unknown>[];
  readonly #lock = new Mutex();

  constructor(options: LanguageModelSessionOptions = {}) {
    const { instructions, model, tools = [], [transcriptSource]: source } = options as CreationOptions;
    const pointers = toolPointers(tools);
    const pointer = source
      ? fm.LanguageModelSessionCreateFromTranscript(source.sessionPointer, model?.pointer ?? null, pointers, tools.length)
      : fm.LanguageModelSessionCreateFromSystemLanguageModel(model?.pointer ?? null, instructions ?? null, pointers, tools.length);
    this.#handle = new NativeObject(pointer, 'language model session');
    this.#tools = [...tools];
    this.transcript = new Transcript(this.#handle);
  }

  /**
   * Continues a conversation from a transcript, for example one exported from a Swift app. The
   * instructions come from the transcript. Pass `tools` to let the model make new tool calls; the
   * transcript only records past ones.
   */
  static fromTranscript(
    transcript: Transcript,
    options: Omit<LanguageModelSessionOptions, 'instructions'> = {},
  ): LanguageModelSession {
    return new LanguageModelSession({ ...options, [transcriptSource]: transcript } as CreationOptions);
  }

  get isResponding(): boolean {
    return fm.LanguageModelSessionIsResponding(this.#handle.pointer);
  }

  /** The tools this session offers the model. */
  get tools(): readonly Tool<unknown>[] {
    return this.#tools;
  }

  /**
   * Responds to a prompt. With `generating`, the response is constrained to that type and
   * returned as a value of it; with `schema` or `jsonSchema`, it's returned as {@link GeneratedContent}.
   */
  respond(prompt: Prompt, options?: RequestOptions & NoGuide): Promise<string>;
  respond<T>(prompt: Prompt, options: RequestOptions & { generating: GenerableType<T> }): Promise<T>;
  respond(prompt: Prompt, options: RequestOptions & { schema: GenerationSchema }): Promise<GeneratedContent>;
  respond(prompt: Prompt, options: RequestOptions & { jsonSchema: object }): Promise<GeneratedContent>;
  async respond<T>(prompt: Prompt, options: RespondOptions<T> = {}): Promise<string | T | GeneratedContent> {
    const { generating, schema, jsonSchema, signal } = options;
    if ([generating, schema, jsonSchema].filter((guide) => guide !== undefined).length > 1) {
      throw new TypeError("Pass at most one of 'generating', 'schema', or 'jsonSchema'");
    }
    const optionsJSON = encodeGenerationOptions(options.options);

    if (generating !== undefined) {
      const content = await this.#respondStructured(prompt, generating.generationSchema(), optionsJSON, signal);
      return generating.decode(content.value);
    }
    if (schema !== undefined || jsonSchema !== undefined) {
      return this.#respondStructured(prompt, schema ?? JSON.stringify(jsonSchema), optionsJSON, signal);
    }
    return this.#exclusively(signal, () =>
      runTask<string>({
        subscribe: (id, settle) =>
          handlers.response.set(id, (status, text) =>
            settle(status === 0 ? { ok: true, value: text ?? '' } : { ok: false, error: errorForStatus(status, text) }),
          ),
        unsubscribe: (id) => handlers.response.delete(id),
        launch: (id) =>
          withComposedPrompt(prompt, (composedPrompt) =>
            fm.LanguageModelSessionRespond(this.#handle.pointer, composedPrompt, optionsJSON, id, responseCallback),
          ),
        signal,
        afterCancel: () => this.#windDownCancelledRequest(),
      }),
    );
  }

  /**
   * Streams the response to a prompt. Each value is the full response so far, not only the newest
   * text. Breaking out of the loop cancels generation.
   */
  async *streamResponse(prompt: Prompt, options: RequestOptions = {}): AsyncGenerator<string, void, undefined> {
    const { signal } = options;
    const optionsJSON = encodeGenerationOptions(options.options);
    const unlock = await this.#lock.acquire(signal);
    const releaseEventLoop = retainEventLoop();
    const snapshots: string[] = [];
    let finished = false; // The consumer should stop reading.
    let nativeDone = false; // The framework has stopped generating.
    let failure: unknown;
    let wake: (() => void) | undefined;
    const stop = (error?: unknown) => {
      if (finished) return;
      finished = true;
      failure = error;
      wake?.();
      wake = undefined;
    };
    // Native completion frees the session and the event loop even if the caller abandons the
    // iterator without calling return(); `finally` covers every other exit.
    const releaseSession = () => {
      releaseEventLoop();
      unlock();
    };

    const id = allocateHandlerId();
    handlers.response.set(id, (status, text) => {
      if (status === 0 && text !== null) {
        snapshots.push(text);
        wake?.();
        wake = undefined;
        return;
      }
      nativeDone = true;
      handlers.response.delete(id);
      releaseSession();
      stop(status === 0 ? undefined : errorForStatus(status, text));
    });
    const onAbort = () => stop(signal?.reason);
    let stream: Pointer | null = null;
    let generating = false;
    try {
      signal?.throwIfAborted();
      signal?.addEventListener('abort', onAbort, { once: true });
      stream = withComposedPrompt(prompt, (composedPrompt) =>
        fm.LanguageModelSessionStreamResponse(this.#handle.pointer, composedPrompt, optionsJSON),
      );
      if (stream === null) throw new FoundationModelsError('Failed to create response stream');
      fm.LanguageModelSessionResponseStreamIterate(stream, id, responseCallback);
      generating = true;
      for (;;) {
        while (snapshots.length > 0) yield snapshots.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => (wake = resolve));
      }
      if (failure !== undefined) throw failure;
    } finally {
      handlers.response.delete(id);
      signal?.removeEventListener('abort', onAbort);
      // Releasing the stream cancels its iteration if it's still running.
      if (stream !== null) fm.Release(stream);
      if (!nativeDone) {
        try {
          if (generating) await this.#windDownCancelledRequest();
        } finally {
          releaseSession();
        }
      }
    }
  }

  [Symbol.dispose](): void {
    this.#handle[Symbol.dispose]();
  }

  async #respondStructured(
    prompt: Prompt,
    schema: GenerationSchema | string,
    optionsJSON: string | null,
    signal: AbortSignal | undefined,
  ): Promise<GeneratedContent> {
    return this.#exclusively(signal, () =>
      runTask<GeneratedContent>({
        subscribe: (id, settle) =>
          handlers.structuredResponse.set(id, (status, json, isComplete) => settle(structuredResult(status, json, isComplete))),
        unsubscribe: (id) => handlers.structuredResponse.delete(id),
        launch: (id) =>
          withComposedPrompt(prompt, (composedPrompt) =>
            typeof schema === 'string'
              ? fm.LanguageModelSessionRespondWithSchemaFromJSON(
                  this.#handle.pointer,
                  composedPrompt,
                  schema,
                  optionsJSON,
                  id,
                  structuredResponseCallback,
                )
              : fm.LanguageModelSessionRespondWithSchema(
                  this.#handle.pointer,
                  composedPrompt,
                  schema.pointer,
                  optionsJSON,
                  id,
                  structuredResponseCallback,
                ),
          ),
        signal,
        afterCancel: () => this.#windDownCancelledRequest(),
      }),
    );
  }

  async #exclusively<T>(signal: AbortSignal | undefined, body: () => Promise<T>): Promise<T> {
    const unlock = await this.#lock.acquire(signal);
    try {
      return await body();
    } finally {
      unlock();
    }
  }

  /** Waits briefly for a cancelled request to stop, so the next request isn't rejected as concurrent. */
  async #windDownCancelledRequest(): Promise<void> {
    // The session may be disposed while this waits; there's then nothing left to wind down.
    const deadline = performance.now() + cancellationGracePeriodMs;
    while (!this.#handle.isDisposed && this.isResponding && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, cancellationPollIntervalMs));
    }
    if (!this.#handle.isDisposed) fm.LanguageModelSessionReset(this.#handle.pointer);
  }
}

function structuredResult(status: number, json: string | null, isComplete: boolean): TaskResult<GeneratedContent> {
  try {
    if (status !== 0) {
      // On failure the bindings wrap the error description in the content, as a JSON string.
      const description = json === null ? null : JSON.parse(json);
      return { ok: false, error: errorForStatus(status, typeof description === 'string' ? description : json) };
    }
    if (json === null) return { ok: false, error: new FoundationModelsError('No content returned from guided generation') };
    return { ok: true, value: new GeneratedContent(JSON.parse(json), isComplete) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new FoundationModelsError(String(error)) };
  }
}
