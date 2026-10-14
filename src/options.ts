// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

/**
 * How the model picks each token from its probability distribution.
 *
 * Random sampling takes either a fixed `top` count or a cumulative `probabilityThreshold`; the
 * framework has no unconstrained random mode.
 */
export type SamplingMode =
  | { readonly mode: 'greedy' }
  | { readonly mode: 'random'; readonly top: number; readonly seed?: number }
  | { readonly mode: 'random'; readonly probabilityThreshold: number; readonly seed?: number };

export type RandomSamplingOptions =
  | { top: number; probabilityThreshold?: never; seed?: number }
  | { probabilityThreshold: number; top?: never; seed?: number };

export const SamplingMode = {
  /** Always choose the most likely token. */
  greedy(): SamplingMode {
    return { mode: 'greedy' };
  },

  /**
   * Sample from the `top` most likely tokens, or from the smallest set whose cumulative probability
   * reaches `probabilityThreshold`. The same `seed` with the same input reproduces the output.
   */
  random(options: RandomSamplingOptions): SamplingMode {
    const mode = { mode: 'random', ...options } as SamplingMode;
    validateSampling(mode);
    return mode;
  },
} as const;

/** Options that control how the model generates its response to a prompt. */
export interface GenerationOptions {
  sampling?: SamplingMode;
  /** Higher values make output more varied; must be non-negative. */
  temperature?: number;
  /**
   * The most tokens the response may contain. A tight limit can cut the response off mid-structure,
   * so use it only to guard against runaway output.
   */
  maximumResponseTokens?: number;
}

function validateSampling(sampling: SamplingMode): void {
  if (sampling.mode === 'greedy') return;
  if (sampling.mode !== 'random') throw new TypeError(`Unknown sampling mode '${(sampling as { mode: unknown }).mode}'`);
  const hasTop = 'top' in sampling && sampling.top !== undefined;
  const hasThreshold = 'probabilityThreshold' in sampling && sampling.probabilityThreshold !== undefined;
  if (hasTop === hasThreshold) {
    throw new RangeError("Random sampling needs exactly one of 'top' or 'probabilityThreshold'");
  }
  if (hasTop && !(Number.isSafeInteger(sampling.top) && sampling.top > 0)) {
    throw new RangeError("'top' must be a positive integer");
  }
  if (hasThreshold && !(sampling.probabilityThreshold >= 0 && sampling.probabilityThreshold <= 1)) {
    throw new RangeError("'probabilityThreshold' must be between 0 and 1");
  }
  if (sampling.seed !== undefined && !(Number.isSafeInteger(sampling.seed) && sampling.seed >= 0)) {
    throw new RangeError("'seed' must be a non-negative integer");
  }
}

/** @internal Validates options and encodes them as the JSON the bindings parse, or `null` for defaults. */
export function encodeGenerationOptions(options: GenerationOptions | undefined): string | null {
  if (options === undefined) return null;
  const { sampling, temperature, maximumResponseTokens } = options;
  const encoded: Record<string, unknown> = {};

  if (sampling !== undefined) {
    validateSampling(sampling);
    encoded['sampling'] =
      sampling.mode === 'greedy'
        ? { mode: 'greedy' }
        : {
            mode: 'random',
            ...('top' in sampling && sampling.top !== undefined
              ? { top_k: sampling.top }
              : { top_p: (sampling as { probabilityThreshold: number }).probabilityThreshold }),
            ...(sampling.seed !== undefined && { seed: sampling.seed }),
          };
  }
  if (temperature !== undefined) {
    if (!(Number.isFinite(temperature) && temperature >= 0)) throw new RangeError("'temperature' must be non-negative");
    // Swift reads this with `as? Double`; JSON integers still bridge to Double.
    encoded['temperature'] = temperature;
  }
  if (maximumResponseTokens !== undefined) {
    if (!(Number.isSafeInteger(maximumResponseTokens) && maximumResponseTokens > 0)) {
      throw new RangeError("'maximumResponseTokens' must be a positive integer");
    }
    encoded['maximum_response_tokens'] = maximumResponseTokens;
  }
  return JSON.stringify(encoded);
}
