// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ImagePromptError, PromptError } from './errors.ts';
import { fm, type Pointer } from './native.ts';

// FMComposedPromptAddImageError
const AddImageError = { unsupportedOS: 1, unsupportedSDK: 2 } as const;

/**
 * An image on disk to include in a prompt. Requires macOS 27 at run time, and bindings built
 * against the macOS 27 SDK.
 */
export class ImageAttachment {
  readonly path: string;
  /** A name the model, and the tools it calls, can use to refer to this image. */
  readonly label: string | undefined;

  constructor(path: string | URL, label?: string) {
    const absolutePath = resolve(path instanceof URL ? fileURLToPath(path) : path);
    if (!statSync(absolutePath, { throwIfNoEntry: false })?.isFile()) {
      throw new ImagePromptError(`Failed to add attachment to prompt: file does not exist at ${absolutePath}`);
    }
    this.path = absolutePath;
    this.label = label;
  }
}

/** A non-text prompt component. */
export type Attachment = ImageAttachment;

export type PromptComponent = string | Attachment;

/** A string, an attachment, or a list mixing the two. */
export type Prompt = PromptComponent | readonly PromptComponent[];

/** @internal Builds a native prompt, passes it to `body`, and releases it once `body` returns. */
export function withComposedPrompt<T>(prompt: Prompt, body: (composedPrompt: Pointer) => T): T {
  const composedPrompt: Pointer = fm.ComposedPromptInitialize();
  try {
    for (const component of Array.isArray(prompt) ? (prompt as readonly PromptComponent[]) : [prompt as PromptComponent]) {
      addComponent(composedPrompt, component);
    }
    // The bindings snapshot the prompt synchronously, so it can be released as soon as they return.
    return body(composedPrompt);
  } finally {
    fm.Release(composedPrompt);
  }
}

function addComponent(composedPrompt: Pointer, component: PromptComponent): void {
  if (typeof component === 'string') {
    fm.ComposedPromptAddText(composedPrompt, component);
    return;
  }
  if (!(component instanceof ImageAttachment)) {
    throw new PromptError(`Unsupported prompt component ${String(component)}; use a string or an ImageAttachment`);
  }
  const error: [number] = [0];
  if (fm.ComposedPromptAddAttachment(composedPrompt, component.path, component.label ?? null, error)) return;
  const detail =
    error[0] === AddImageError.unsupportedOS
      ? 'the current OS does not support attachment prompts'
      : error[0] === AddImageError.unsupportedSDK
        ? "the native bindings were built with an SDK older than macOS 27; rebuild them with Xcode 27 or later"
        : 'an unknown error occurred while adding the attachment';
  throw new ImagePromptError(`Failed to add attachment to prompt: ${detail}`);
}
