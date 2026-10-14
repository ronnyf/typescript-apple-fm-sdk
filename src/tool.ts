// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

import { allocateHandlerId, callReportingError, fm, handlers, toolCallCallback, type Pointer } from './native.ts';
import { GenerableType } from './schema.ts';

export interface ToolDefinition<T> {
  /** How the model refers to the tool, for example `get_weather`. */
  readonly name: string;
  /** What the tool does and when to use it; the model reads this to decide whether to call it. */
  readonly description: string;
  /** The arguments the model generates for each call. */
  readonly arguments: GenerableType<T>;
  /**
   * Performs the call. The returned string goes back to the model; a thrown error is reported to the
   * model as `Tool error: <message>` so it can recover.
   */
  call(args: T): string | Promise<string>;
}

interface ToolResources {
  pointer: Pointer;
  handlerId: number;
}

const toolReleaser = new FinalizationRegistry<ToolResources>(({ pointer, handlerId }) => {
  handlers.toolCall.delete(handlerId);
  fm.Release(pointer);
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A function the model can call while it generates a response. */
export class Tool<T = unknown> {
  readonly name: string;
  readonly description: string;
  readonly arguments: GenerableType<T>;
  readonly #pointer: Pointer;

  constructor(definition: ToolDefinition<T>) {
    const { name, description, arguments: argumentsType } = definition;
    if (typeof name !== 'string' || name.length === 0) throw new TypeError('Tool name must be a non-empty string');
    if (typeof description !== 'string') throw new TypeError('Tool description must be a string');
    if (!(argumentsType instanceof GenerableType)) {
      throw new TypeError('Tool arguments must be a generable type created with fm.generable()');
    }
    if (typeof definition.call !== 'function') throw new TypeError('Tool definition must implement call()');

    const handlerId = allocateHandlerId();
    const pointer = callReportingError(`Failed to create tool '${name}'`, (errorCode, errorDescription) =>
      fm.BridgedToolCreateWithUserInfo(
        name,
        description,
        argumentsType.generationSchema().pointer,
        toolCallCallback,
        handlerId,
        errorCode,
        errorDescription,
      ),
    );
    // The handler must not capture `this`, or the handler map would keep the tool alive forever.
    handlers.toolCall.set(handlerId, (argumentsJSON, callId) => {
      void (async () => {
        let output: string;
        try {
          const result: unknown = await definition.call(argumentsType.decode(JSON.parse(argumentsJSON)));
          output = typeof result === 'string' ? result : String(result);
        } catch (error) {
          output = `Tool error: ${describeError(error)}`;
        }
        fm.BridgedToolFinishCall(pointer, callId, output);
      })();
    });
    this.name = name;
    this.description = description;
    this.arguments = argumentsType;
    this.#pointer = pointer;
    toolReleaser.register(this, { pointer, handlerId });
  }

  /** @internal */
  get pointer(): Pointer {
    return this.#pointer;
  }
}

/** @internal A `const void **` argument for a list of tools, or `null` for none. */
export function toolPointers(tools: readonly Tool<unknown>[]): Pointer[] | null {
  for (const tool of tools) {
    if (!(tool instanceof Tool)) throw new TypeError(`Expected a Tool, got ${String(tool)}`);
  }
  return tools.length > 0 ? tools.map((tool) => tool.pointer) : null;
}
