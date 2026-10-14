// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

/**
 * TypeScript bindings for Apple's Foundation Models framework: on-device inference with the
 * model at the core of Apple Intelligence on macOS.
 *
 * ```ts
 * import * as fm from 'apple-fm-sdk';
 *
 * const session = new fm.LanguageModelSession();
 * console.log(await session.respond('Hello, how are you?'));
 * ```
 */

export { GeneratedContent } from './content.ts';
export {
  AssetsUnavailableError,
  ConcurrentRequestsError,
  DecodingFailureError,
  ExceededContextWindowSizeError,
  FoundationModelsError,
  GenerationError,
  GenerationErrorCode,
  GuardrailViolationError,
  ImagePromptError,
  InvalidGenerationSchemaError,
  PromptError,
  RateLimitedError,
  RefusalError,
  UnsupportedGuideError,
  UnsupportedLanguageOrLocaleError,
  type GenerationErrorOptions,
} from './errors.ts';
export {
  SystemLanguageModel,
  type SystemLanguageModelAvailability,
  type SystemLanguageModelGuardrails,
  type SystemLanguageModelOptions,
  type SystemLanguageModelUnavailableReason,
  type SystemLanguageModelUseCase,
  type SystemLanguageModelVariant,
  type TokenCountInput,
} from './model.ts';
export { SamplingMode, type GenerationOptions, type RandomSamplingOptions } from './options.ts';
export { ImageAttachment, type Attachment, type Prompt, type PromptComponent } from './prompt.ts';
export {
  Field,
  GenerableType,
  GenerationSchema,
  array,
  boolean,
  generable,
  integer,
  number,
  optional,
  ref,
  string,
  type ArrayFieldOptions,
  type GenerableOptions,
  type Infer,
  type InferShape,
  type NumericFieldOptions,
  type Shape,
  type StringFieldOptions,
} from './schema.ts';
export {
  LanguageModelSession,
  type LanguageModelSessionOptions,
  type RequestOptions,
} from './session.ts';
export { Tool, type ToolDefinition } from './tool.ts';
export { Transcript, type TranscriptContent, type TranscriptData, type TranscriptEntry } from './transcript.ts';
