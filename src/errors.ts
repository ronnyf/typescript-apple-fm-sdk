// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

/** Status codes reported by the native bindings; they mirror `LanguageModelSession.GenerationError`. */
export const GenerationErrorCode = {
  success: 0,
  exceededContextWindowSize: 1,
  assetsUnavailable: 2,
  guardrailViolation: 3,
  unsupportedGuide: 4,
  unsupportedLanguageOrLocale: 5,
  decodingFailure: 6,
  rateLimited: 7,
  concurrentRequests: 8,
  refusal: 9,
  invalidSchema: 10,
  invalidArgument: 11,
  unknownError: 255,
} as const;

export type GenerationErrorCode = (typeof GenerationErrorCode)[keyof typeof GenerationErrorCode];

/** Base class for every error this package throws. */
export class FoundationModelsError extends Error {
  override name = 'FoundationModelsError';
}

export interface GenerationErrorOptions extends ErrorOptions {
  /** The native status code, one of {@link GenerationErrorCode}. */
  statusCode?: number;
  /** The framework's description of the failure, when it provided one. */
  debugDescription?: string;
}

/** Base class for errors the framework raises while generating. */
export class GenerationError extends FoundationModelsError {
  override name = 'GenerationError';
  readonly statusCode: number;
  readonly debugDescription: string | undefined;

  constructor(message: string, options: GenerationErrorOptions = {}) {
    super(message, options);
    this.statusCode = options.statusCode ?? GenerationErrorCode.unknownError;
    this.debugDescription = options.debugDescription;
  }
}

/** The session's transcript, instructions, tools, and response no longer fit in the context window. */
export class ExceededContextWindowSizeError extends GenerationError {
  override name = 'ExceededContextWindowSizeError';
}

/** The model's assets are unavailable, for example while they download. */
export class AssetsUnavailableError extends GenerationError {
  override name = 'AssetsUnavailableError';
}

/** The prompt or the response tripped a safety guardrail. */
export class GuardrailViolationError extends GenerationError {
  override name = 'GuardrailViolationError';
}

/** A schema used a guide the framework doesn't support for that property type. */
export class UnsupportedGuideError extends GenerationError {
  override name = 'UnsupportedGuideError';
}

/** The prompt is in a language or locale the model doesn't support. */
export class UnsupportedLanguageOrLocaleError extends GenerationError {
  override name = 'UnsupportedLanguageOrLocaleError';
}

/** The model's output couldn't be decoded into the requested structure. */
export class DecodingFailureError extends GenerationError {
  override name = 'DecodingFailureError';
}

/** The system rate-limited the request. */
export class RateLimitedError extends GenerationError {
  override name = 'RateLimitedError';
}

/** The session was asked to respond while it was already responding. */
export class ConcurrentRequestsError extends GenerationError {
  override name = 'ConcurrentRequestsError';
}

/** The model refused to produce the requested content. */
export class RefusalError extends GenerationError {
  override name = 'RefusalError';
}

/** A generation schema is malformed or can't be represented natively. */
export class InvalidGenerationSchemaError extends GenerationError {
  override name = 'InvalidGenerationSchemaError';
}

/** A prompt couldn't be built from its components. */
export class PromptError extends FoundationModelsError {
  override name = 'PromptError';
}

/** An image attachment couldn't be added to a prompt. */
export class ImagePromptError extends PromptError {
  override name = 'ImagePromptError';
}

const errorTypes: Record<number, [new (message: string, options?: GenerationErrorOptions) => GenerationError, string]> = {
  [GenerationErrorCode.exceededContextWindowSize]: [ExceededContextWindowSizeError, 'Context window size exceeded'],
  [GenerationErrorCode.assetsUnavailable]: [AssetsUnavailableError, 'Required assets are unavailable'],
  [GenerationErrorCode.guardrailViolation]: [GuardrailViolationError, 'Guardrail violation occurred'],
  [GenerationErrorCode.unsupportedGuide]: [UnsupportedGuideError, 'Unsupported guide used'],
  [GenerationErrorCode.unsupportedLanguageOrLocale]: [UnsupportedLanguageOrLocaleError, 'Unsupported language or locale'],
  [GenerationErrorCode.decodingFailure]: [DecodingFailureError, 'Failed to decode response'],
  [GenerationErrorCode.rateLimited]: [RateLimitedError, 'Request was rate limited'],
  [GenerationErrorCode.concurrentRequests]: [ConcurrentRequestsError, 'Too many concurrent requests'],
  [GenerationErrorCode.refusal]: [RefusalError, 'Model refused to generate content'],
  [GenerationErrorCode.invalidSchema]: [InvalidGenerationSchemaError, 'Invalid generation schema provided'],
};

/** @internal Maps a native status code to the matching error subclass. */
export function errorForStatus(statusCode: number, debugDescription?: string | null): GenerationError {
  const [ErrorType, summary] = errorTypes[statusCode] ?? [GenerationError, `Generation error (status: ${statusCode})`];
  const options: GenerationErrorOptions = { statusCode };
  if (debugDescription) options.debugDescription = debugDescription;
  return new ErrorType(debugDescription ? `${summary}: ${debugDescription}` : summary, options);
}
