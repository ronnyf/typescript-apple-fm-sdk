// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

/**
 * @internal
 * koffi bindings to `foundation-models-c`.
 *
 * Callbacks arrive on Swift concurrency threads; koffi relays each one to the JS thread and blocks
 * the Swift thread until it returns, so borrowed `const char *` arguments are valid for the call.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import koffi, { type TypeObject } from 'koffi';

import { FoundationModelsError, errorForStatus } from './errors.ts';

/** An opaque native reference. koffi represents pointers as BigInt and NULL as `null`. */
export type Pointer = bigint;

const libraryPath =
  process.env['APPLE_FM_SDK_LIBRARY'] ?? fileURLToPath(new URL('../lib/libFoundationModels.dylib', import.meta.url));
if (!existsSync(libraryPath)) {
  throw new FoundationModelsError(
    `Foundation Models C bindings not found at ${libraryPath}. Run \`npm run build:native\` to build them.`,
  );
}
const lib = koffi.load(libraryPath);

const ResponseCallback = koffi.proto(
  'void FMResponseCallback(int status, const uint8_t *content, size_t length, intptr_t userInfo)',
);
const StructuredResponseCallback = koffi.proto(
  'void FMStructuredResponseCallback(int status, const void *content, intptr_t userInfo)',
);
const TokenCountCallback = koffi.proto(
  'void FMTokenCountCallback(int status, int tokenCount, const char *errorDescription, intptr_t userInfo)',
);
const BridgedToolCallable: TypeObject = koffi.proto(
  'void FMBridgedToolCallable(const void *arguments, unsigned int callId, const void *tool, intptr_t userInfo)',
);

type Nullable = Pointer | null;
type OutCode = [number];
type OutString = [Pointer | null];

/** JS signatures of the bindings below; koffi itself types every function as `any`. */
export interface Bindings {
  SystemLanguageModelCreate(useCase: number, guardrails: number): Nullable;
  SystemLanguageModelIsAvailable(model: Pointer, reason: OutCode): boolean;
  SystemLanguageModelGetContextSize(model: Pointer): number;
  SystemLanguageModelGetVariantDisplayName(model: Pointer): Nullable;

  SystemLanguageModelTokenCountForPrompt(model: Pointer, prompt: Pointer, userInfo: number, callback: Pointer): Pointer;
  SystemLanguageModelTokenCountForInstructions(model: Pointer, instructions: string, userInfo: number, callback: Pointer): Pointer;
  SystemLanguageModelTokenCountForTools(model: Pointer, tools: Pointer[] | null, toolCount: number, userInfo: number, callback: Pointer): Pointer;
  SystemLanguageModelTokenCountForSchema(model: Pointer, schema: Pointer, userInfo: number, callback: Pointer): Pointer;
  SystemLanguageModelTokenCountForTranscript(model: Pointer, session: Pointer, userInfo: number, callback: Pointer): Pointer;

  LanguageModelSessionCreateFromSystemLanguageModel(model: Nullable, instructions: string | null, tools: Pointer[] | null, toolCount: number): Nullable;
  LanguageModelSessionCreateFromTranscript(session: Pointer, model: Nullable, tools: Pointer[] | null, toolCount: number): Nullable;
  LanguageModelSessionIsResponding(session: Pointer): boolean;
  LanguageModelSessionReset(session: Pointer): void;
  LanguageModelSessionRespond(session: Pointer, prompt: Pointer, optionsJSON: string | null, userInfo: number, callback: Pointer): Pointer;
  LanguageModelSessionRespondWithSchema(session: Pointer, prompt: Pointer, schema: Pointer, optionsJSON: string | null, userInfo: number, callback: Pointer): Pointer;
  LanguageModelSessionRespondWithSchemaFromJSON(session: Pointer, prompt: Pointer, schemaJSON: string, optionsJSON: string | null, userInfo: number, callback: Pointer): Pointer;
  LanguageModelSessionStreamResponse(session: Pointer, prompt: Pointer, optionsJSON: string | null): Nullable;
  LanguageModelSessionResponseStreamIterate(stream: Pointer, userInfo: number, callback: Pointer): void;
  LanguageModelSessionGetTranscriptJSONString(session: Pointer, errorCode: OutCode, errorDescription: OutString): Nullable;
  TranscriptCreateFromJSONString(json: string, errorCode: OutCode, errorDescription: OutString): Nullable;

  ComposedPromptInitialize(): Pointer;
  ComposedPromptAddText(prompt: Pointer, text: string): void;
  ComposedPromptAddAttachment(prompt: Pointer, imagePath: string, label: string | null, error: OutCode): boolean;

  GenerationSchemaCreate(name: string, description: string | null): Nullable;
  GenerationSchemaPropertyCreate(name: string, description: string | null, typeName: string, isOptional: boolean): Pointer;
  GenerationSchemaPropertyAddAnyOfGuide(property: Pointer, anyOf: readonly string[], choiceCount: number, wrapped: boolean): void;
  GenerationSchemaPropertyAddCountGuide(property: Pointer, count: number, wrapped: boolean): void;
  GenerationSchemaPropertyAddMaximumGuide(property: Pointer, maximum: number, wrapped: boolean): void;
  GenerationSchemaPropertyAddMinimumGuide(property: Pointer, minimum: number, wrapped: boolean): void;
  GenerationSchemaPropertyAddMinItemsGuide(property: Pointer, minItems: number): void;
  GenerationSchemaPropertyAddMaxItemsGuide(property: Pointer, maxItems: number): void;
  GenerationSchemaPropertyAddRangeGuide(property: Pointer, minValue: number, maxValue: number, wrapped: boolean): void;
  GenerationSchemaPropertyAddRegex(property: Pointer, pattern: string, wrapped: boolean): void;
  GenerationSchemaAddProperty(schema: Pointer, property: Pointer): void;
  GenerationSchemaAddReferenceSchema(schema: Pointer, referenceSchema: Pointer): void;
  GenerationSchemaGetJSONString(schema: Pointer, errorCode: OutCode, errorDescription: OutString): Nullable;

  GeneratedContentGetJSONString(content: Pointer): Nullable;
  GeneratedContentIsComplete(content: Pointer): boolean;

  BridgedToolCreateWithUserInfo(name: string, description: string, parameters: Pointer, callable: Pointer, userInfo: number, errorCode: OutCode, errorDescription: OutString): Nullable;
  BridgedToolFinishCall(tool: Pointer, callId: number, output: string): void;

  TaskCancel(task: Pointer): void;
  Release(object: Pointer): void;
  FreeString(string: Pointer): void;
}

// Strings the bindings allocate are returned as `void *` so they can be passed back to FMFreeString.
export const fm: Bindings = {
  SystemLanguageModelCreate: lib.func('const void *FMSystemLanguageModelCreate(int useCase, int guardrails)'),
  SystemLanguageModelIsAvailable: lib.func('bool FMSystemLanguageModelIsAvailable(const void *model, _Out_ int *reason)'),
  SystemLanguageModelGetContextSize: lib.func('int FMSystemLanguageModelGetContextSize(const void *model)'),
  SystemLanguageModelGetVariantDisplayName: lib.func('void *FMSystemLanguageModelGetVariantDisplayName(const void *model)'),

  SystemLanguageModelTokenCountForPrompt: lib.func(
    'const void *FMSystemLanguageModelTokenCountForPrompt(const void *model, const void *prompt, intptr_t userInfo, FMTokenCountCallback *callback)',
  ),
  SystemLanguageModelTokenCountForInstructions: lib.func(
    'const void *FMSystemLanguageModelTokenCountForInstructions(const void *model, const char *instructions, intptr_t userInfo, FMTokenCountCallback *callback)',
  ),
  SystemLanguageModelTokenCountForTools: lib.func(
    'const void *FMSystemLanguageModelTokenCountForTools(const void *model, const void **tools, int toolCount, intptr_t userInfo, FMTokenCountCallback *callback)',
  ),
  SystemLanguageModelTokenCountForSchema: lib.func(
    'const void *FMSystemLanguageModelTokenCountForSchema(const void *model, const void *schema, intptr_t userInfo, FMTokenCountCallback *callback)',
  ),
  SystemLanguageModelTokenCountForTranscript: lib.func(
    'const void *FMSystemLanguageModelTokenCountForTranscript(const void *model, const void *session, intptr_t userInfo, FMTokenCountCallback *callback)',
  ),

  LanguageModelSessionCreateFromSystemLanguageModel: lib.func(
    'const void *FMLanguageModelSessionCreateFromSystemLanguageModel(const void *model, const char *instructions, const void **tools, int toolCount)',
  ),
  LanguageModelSessionCreateFromTranscript: lib.func(
    'const void *FMLanguageModelSessionCreateFromTranscript(const void *session, const void *model, const void **tools, int toolCount)',
  ),
  LanguageModelSessionIsResponding: lib.func('bool FMLanguageModelSessionIsResponding(const void *session)'),
  LanguageModelSessionReset: lib.func('void FMLanguageModelSessionReset(const void *session)'),
  LanguageModelSessionRespond: lib.func(
    'const void *FMLanguageModelSessionRespond(const void *session, const void *prompt, const char *optionsJSON, intptr_t userInfo, FMResponseCallback *callback)',
  ),
  LanguageModelSessionRespondWithSchema: lib.func(
    'const void *FMLanguageModelSessionRespondWithSchema(const void *session, const void *prompt, const void *schema, const char *optionsJSON, intptr_t userInfo, FMStructuredResponseCallback *callback)',
  ),
  LanguageModelSessionRespondWithSchemaFromJSON: lib.func(
    'const void *FMLanguageModelSessionRespondWithSchemaFromJSON(const void *session, const void *prompt, const char *schemaJSON, const char *optionsJSON, intptr_t userInfo, FMStructuredResponseCallback *callback)',
  ),
  LanguageModelSessionStreamResponse: lib.func(
    'const void *FMLanguageModelSessionStreamResponse(const void *session, const void *prompt, const char *optionsJSON)',
  ),
  LanguageModelSessionResponseStreamIterate: lib.func(
    'void FMLanguageModelSessionResponseStreamIterate(const void *stream, intptr_t userInfo, FMResponseCallback *callback)',
  ),
  LanguageModelSessionGetTranscriptJSONString: lib.func(
    'void *FMLanguageModelSessionGetTranscriptJSONString(const void *session, _Out_ int *errorCode, _Out_ void **errorDescription)',
  ),
  TranscriptCreateFromJSONString: lib.func(
    'const void *FMTranscriptCreateFromJSONString(const char *json, _Out_ int *errorCode, _Out_ void **errorDescription)',
  ),

  ComposedPromptInitialize: lib.func('const void *FMComposedPromptInitialize()'),
  ComposedPromptAddText: lib.func('void FMComposedPromptAddText(const void *prompt, const char *text)'),
  ComposedPromptAddAttachment: lib.func(
    'bool FMComposedPromptAddAttachment(const void *prompt, const char *imagePath, const char *label, _Out_ int *error)',
  ),

  GenerationSchemaCreate: lib.func('const void *FMGenerationSchemaCreate(const char *name, const char *description)'),
  GenerationSchemaPropertyCreate: lib.func(
    'const void *FMGenerationSchemaPropertyCreate(const char *name, const char *description, const char *typeName, bool isOptional)',
  ),
  GenerationSchemaPropertyAddAnyOfGuide: lib.func(
    'void FMGenerationSchemaPropertyAddAnyOfGuide(const void *property, const char **anyOf, int choiceCount, bool wrapped)',
  ),
  GenerationSchemaPropertyAddCountGuide: lib.func(
    'void FMGenerationSchemaPropertyAddCountGuide(const void *property, int count, bool wrapped)',
  ),
  GenerationSchemaPropertyAddMaximumGuide: lib.func(
    'void FMGenerationSchemaPropertyAddMaximumGuide(const void *property, double maximum, bool wrapped)',
  ),
  GenerationSchemaPropertyAddMinimumGuide: lib.func(
    'void FMGenerationSchemaPropertyAddMinimumGuide(const void *property, double minimum, bool wrapped)',
  ),
  GenerationSchemaPropertyAddMinItemsGuide: lib.func(
    'void FMGenerationSchemaPropertyAddMinItemsGuide(const void *property, int minItems)',
  ),
  GenerationSchemaPropertyAddMaxItemsGuide: lib.func(
    'void FMGenerationSchemaPropertyAddMaxItemsGuide(const void *property, int maxItems)',
  ),
  GenerationSchemaPropertyAddRangeGuide: lib.func(
    'void FMGenerationSchemaPropertyAddRangeGuide(const void *property, double minValue, double maxValue, bool wrapped)',
  ),
  GenerationSchemaPropertyAddRegex: lib.func(
    'void FMGenerationSchemaPropertyAddRegex(const void *property, const char *pattern, bool wrapped)',
  ),
  GenerationSchemaAddProperty: lib.func('void FMGenerationSchemaAddProperty(const void *schema, const void *property)'),
  GenerationSchemaAddReferenceSchema: lib.func(
    'void FMGenerationSchemaAddReferenceSchema(const void *schema, const void *referenceSchema)',
  ),
  GenerationSchemaGetJSONString: lib.func(
    'void *FMGenerationSchemaGetJSONString(const void *schema, _Out_ int *errorCode, _Out_ void **errorDescription)',
  ),

  GeneratedContentGetJSONString: lib.func('void *FMGeneratedContentGetJSONString(const void *content)'),
  GeneratedContentIsComplete: lib.func('bool FMGeneratedContentIsComplete(const void *content)'),

  BridgedToolCreateWithUserInfo: lib.func(
    'const void *FMBridgedToolCreateWithUserInfo(const char *name, const char *description, const void *parameters, FMBridgedToolCallable *callable, intptr_t userInfo, _Out_ int *errorCode, _Out_ void **errorDescription)',
  ),
  BridgedToolFinishCall: lib.func('void FMBridgedToolFinishCall(const void *tool, unsigned int callId, const char *output)'),

  TaskCancel: lib.func('void FMTaskCancel(const void *task)'),
  Release: lib.func('void FMRelease(const void *object)'),
  FreeString: lib.func('void FMFreeString(void *string)'),
};

/** Decodes and frees a string the bindings allocated. */
export function takeString(pointer: Pointer | null): string | null {
  if (pointer === null) return null;
  try {
    return koffi.decode.string(pointer);
  } finally {
    fm.FreeString(pointer);
  }
}

/** Calls a binding that reports failure through `outErrorCode` / `outErrorDescription`, and throws on failure. */
export function callReportingError<T>(
  context: string,
  call: (errorCode: [number], errorDescription: [Pointer | null]) => T | null,
): T {
  const errorCode: [number] = [0];
  const errorDescription: [Pointer | null] = [null];
  const result = call(errorCode, errorDescription);
  if (result !== null) return result;
  const description = takeString(errorDescription[0]);
  throw errorForStatus(errorCode[0], description ? `${context}: ${description}` : context);
}

// MARK: - Ownership

const releaser = new FinalizationRegistry<Pointer>((pointer) => fm.Release(pointer));

/**
 * Owns one +1 reference from a `passRetained` binding and releases it on dispose, or when collected.
 */
export class NativeObject implements Disposable {
  #pointer: Pointer | null;

  constructor(pointer: Pointer | null, what: string) {
    if (pointer === null) throw new FoundationModelsError(`Failed to create ${what}`);
    this.#pointer = pointer;
    releaser.register(this, pointer, this);
  }

  get isDisposed(): boolean {
    return this.#pointer === null;
  }

  get pointer(): Pointer {
    if (this.#pointer === null) throw new FoundationModelsError('The native object has already been disposed');
    return this.#pointer;
  }

  [Symbol.dispose](): void {
    if (this.#pointer === null) return;
    releaser.unregister(this);
    fm.Release(this.#pointer);
    this.#pointer = null;
  }
}

// MARK: - Event loop

let pendingNativeWork = 0;
let keepAlive: NodeJS.Timeout | undefined;

/**
 * Keeps the process alive while native work is in flight; koffi's callbacks don't hold the event loop open.
 * Returns an idempotent release function.
 */
export function retainEventLoop(): () => void {
  if (pendingNativeWork++ === 0) keepAlive = setInterval(() => {}, 2 ** 31 - 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--pendingNativeWork === 0) clearInterval(keepAlive);
  };
}

// MARK: - Callbacks

// Registered once for the process: native tasks may call back after JS has stopped listening (for
// example "Operation cancelled" after an abort), so these trampolines must never be freed. Handlers
// are looked up by the `userInfo` id; a missing handler means the caller has gone away.

export type ResponseHandler = (status: number, text: string | null) => void;
export type StructuredResponseHandler = (status: number, json: string | null, isComplete: boolean) => void;
export type TokenCountHandler = (status: number, tokenCount: number, errorDescription: string | null) => void;
/** Receives a tool call's arguments as JSON; must eventually finish the call with FMBridgedToolFinishCall. */
export type ToolCallHandler = (argumentsJSON: string, callId: number) => void;

let nextHandlerId = 1;
const responseHandlers = new Map<number, ResponseHandler>();
const structuredResponseHandlers = new Map<number, StructuredResponseHandler>();
const tokenCountHandlers = new Map<number, TokenCountHandler>();
const toolCallHandlers = new Map<number, ToolCallHandler>();

/** koffi swallows exceptions thrown by callbacks; rethrow them outside the callback instead. */
function reportingErrors<A extends unknown[]>(body: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      body(...args);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  };
}

const utf8 = new TextDecoder();

export const responseCallback: Pointer = koffi.register(
  reportingErrors((status: number, content: Pointer | null, length: number | bigint, userInfo: number) => {
    const handler = responseHandlers.get(userInfo);
    if (!handler) return;
    const size = Number(length);
    const text = content === null ? null : size === 0 ? '' : utf8.decode(new Uint8Array(koffi.view(content, size)));
    handler(status, text);
  }),
  koffi.pointer(ResponseCallback),
);

export const structuredResponseCallback: Pointer = koffi.register(
  reportingErrors((status: number, content: Pointer | null, userInfo: number) => {
    // The content reference arrives retained; release it whether or not anyone is listening.
    let json: string | null = null;
    let isComplete = false;
    if (content !== null) {
      try {
        json = takeString(fm.GeneratedContentGetJSONString(content));
        isComplete = fm.GeneratedContentIsComplete(content);
      } finally {
        fm.Release(content);
      }
    }
    structuredResponseHandlers.get(userInfo)?.(status, json, isComplete);
  }),
  koffi.pointer(StructuredResponseCallback),
);

export const tokenCountCallback: Pointer = koffi.register(
  reportingErrors((status: number, tokenCount: number, errorDescription: string | null, userInfo: number) => {
    tokenCountHandlers.get(userInfo)?.(status, tokenCount, errorDescription);
  }),
  koffi.pointer(TokenCountCallback),
);

export const toolCallCallback: Pointer = koffi.register(
  reportingErrors((content: Pointer, callId: number, tool: Pointer, userInfo: number) => {
    let json: string | null;
    try {
      json = takeString(fm.GeneratedContentGetJSONString(content));
    } finally {
      fm.Release(content);
    }
    const handler = toolCallHandlers.get(userInfo);
    // A session can outlive a collected Tool; finish the call so the model isn't left waiting.
    if (!handler) fm.BridgedToolFinishCall(tool, callId, 'Tool error: this tool is no longer available');
    else handler(json ?? 'null', callId);
  }),
  koffi.pointer(BridgedToolCallable),
);

export const handlers: {
  readonly response: Map<number, ResponseHandler>;
  readonly structuredResponse: Map<number, StructuredResponseHandler>;
  readonly tokenCount: Map<number, TokenCountHandler>;
  readonly toolCall: Map<number, ToolCallHandler>;
} = {
  response: responseHandlers,
  structuredResponse: structuredResponseHandlers,
  tokenCount: tokenCountHandlers,
  toolCall: toolCallHandlers,
};

export function allocateHandlerId(): number {
  return nextHandlerId++;
}

// MARK: - Tasks

export type TaskResult<T> = { ok: true; value: T } | { ok: false; error: Error };

export interface TaskOptions<T> {
  /** Installs the handler for `id`; the handler must call `settle` exactly once per outcome it sees. */
  subscribe(id: number, settle: (result: TaskResult<T>) => void): void;
  unsubscribe(id: number): void;
  /** Starts the native work and returns its `FMTaskRef`. */
  launch(id: number): Pointer;
  signal?: AbortSignal | undefined;
  /** Runs after an abort has cancelled the native task, before the returned promise rejects. */
  afterCancel?: () => Promise<void>;
}

/** Runs one callback-reporting native task, handling cancellation, the task reference, and the event loop. */
export function runTask<T>({ subscribe, unsubscribe, launch, signal, afterCancel }: TaskOptions<T>): Promise<T> {
  signal?.throwIfAborted();
  const id = allocateHandlerId();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const releaseEventLoop = retainEventLoop();
  let task: Pointer | null = null;
  let settled = false;

  const finish = () => {
    unsubscribe(id);
    signal?.removeEventListener('abort', onAbort);
    if (task !== null) fm.Release(task);
    releaseEventLoop();
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    unsubscribe(id);
    if (task !== null) fm.TaskCancel(task);
    void (afterCancel?.() ?? Promise.resolve()).finally(() => {
      finish();
      reject(signal?.reason);
    });
  };

  subscribe(id, (result) => {
    if (settled) return;
    settled = true;
    finish();
    if (result.ok) resolve(result.value);
    else reject(result.error);
  });
  try {
    task = launch(id);
  } catch (error) {
    settled = true;
    finish();
    throw error;
  }
  // Callbacks are relayed through the event loop, so this only guards against a synchronous callback.
  if (settled) fm.Release(task);
  else signal?.addEventListener('abort', onAbort, { once: true });
  return promise;
}
