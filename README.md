# Foundation Models SDK for TypeScript

TypeScript bindings for Apple's [Foundation Models framework](https://developer.apple.com/documentation/foundationmodels), providing access to the on-device foundation model at the core of Apple Intelligence on macOS. A port of the [Foundation Models SDK for Python](https://github.com/apple/python-apple-fm-sdk).

You can:

- Run **on-device inference** with the system foundation model
- **Stream** responses as they're generated
- Use **guided generation** to get typed values, with schemas inferred from one definition
- Let the model **call tools** you write in TypeScript
- Count **tokens** against the model's context window
- Process **transcripts exported from Swift apps**, and continue those conversations

Keep in mind that it's your responsibility to design AI experiences with care. To learn about practical strategies you can implement in code, check out [Improving the safety of generative model output](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output) and Apple's [Human Interface Guidelines on Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai).

## Requirements

- macOS 26.0+ on Apple silicon, with Apple Intelligence turned on for [a compatible Mac](https://support.apple.com/en-us/121115)
- Node.js 22.18+
- To build the native bindings: [Xcode 26.0+](https://developer.apple.com/xcode/), opened once to accept the license. Image prompts and `variant` need the bindings built with Xcode 27 and run on macOS 27; token counting needs macOS 26.4.

## Installation

The package isn't published to npm. Build it from a checkout, then install the checkout into your project:

```bash
git clone https://github.com/ronnyf/typescript-apple-fm-sdk.git
cd typescript-apple-fm-sdk
npm install
npm run build:native && npm run build
cd ../your-project && npm install ../typescript-apple-fm-sdk
```

## Basic usage

```ts
import * as fm from 'apple-fm-sdk';

const model = new fm.SystemLanguageModel();
if (model.availability.status === 'available') {
  const session = new fm.LanguageModelSession({ instructions: 'Answer concisely.' });
  console.log(await session.respond('Hello, how are you?'));
} else {
  console.log(`Foundation Models not available: ${model.availability.reason}`);
}
```

### Guided generation

Describe a type with the field builders; `fm.Infer` gives you its TypeScript type, and `respond` returns a value of it.

```ts
const Cat = fm.generable('Cat', {
  name: fm.string(),
  age: fm.integer({ description: 'Age in years', range: [0, 20] }),
  mood: fm.string({ anyOf: ['playful', 'shy', 'lazy'] }),
  toys: fm.array(fm.string(), { maxItems: 3 }),
  note: fm.optional(fm.string()),
}, { description: 'A rescue cat' });
type Cat = fm.Infer<typeof Cat>; // { name: string; age: number; mood: 'playful' | 'shy' | 'lazy'; toys: string[]; note?: string }

const cat = await session.respond('Generate an adorable rescue cat', { generating: Cat });
```

Use another generable type as a field directly, or with `fm.ref()` to add a description. For a type that refers to itself, pass a function and annotate the type:

```ts
interface Folder { name: string; children: Folder[] }
const Folder: fm.GenerableType<Folder> = fm.generable('Folder', {
  name: fm.string(),
  children: fm.array(fm.ref(() => Folder), { maxItems: 3 }),
});
```

To generate against a JSON schema exported from a Swift app, pass `{ jsonSchema }`; you get a `GeneratedContent`.

### Streaming

Each value is the full response so far:

```ts
for await (const snapshot of session.streamResponse('Tell me a story')) {
  render(snapshot);
}
```

Breaking out of the loop cancels generation. Every request also takes an `AbortSignal`:

```ts
await session.respond('Write an essay', { signal: AbortSignal.timeout(5_000) });
```

### Tools

```ts
const weather = new fm.Tool({
  name: 'get_weather',
  description: 'Gets the current weather for a city.',
  arguments: fm.generable('WeatherArguments', { city: fm.string() }),
  async call({ city }) {
    return `Sunny, 22°C in ${city}`;
  },
});
const session = new fm.LanguageModelSession({ tools: [weather] });
```

An error thrown from `call` is reported to the model as `Tool error: <message>`, so it can recover.

### Generation options

```ts
await session.respond('Write a poem', {
  options: {
    sampling: fm.SamplingMode.random({ top: 50, seed: 42 }),
    temperature: 0.7,
    maximumResponseTokens: 500,
  },
});
```

### Transcripts and token counts

```ts
const transcript = fm.Transcript.fromDict(JSON.parse(readFileSync('transcript.json', 'utf8')));
const resumed = fm.LanguageModelSession.fromTranscript(transcript, { tools: [weather] });

const used = await model.tokenCount(session.transcript);
console.log(`${used} of ${model.contextSize} tokens`);
```

`tokenCount` also takes a prompt, `{ instructions }`, a generable type or schema, or a list of tools.

See [examples/](examples) for complete programs.

## Differences from the Python SDK

- Schemas are defined with field builders and `fm.generable(name, shape)` rather than a class decorator; the result is a plain object type.
- Names are camelCase; enums are string unions (`'contentTagging'`, `'appleIntelligenceNotEnabled'`).
- `model.availability` returns `{ status, reason }`, in the shape of Swift's `availability`, rather than a tuple.
- `Transcript.fromDict` and `transcript.toDict()` are synchronous; the native calls are.
- A tool's `call` receives its decoded arguments, and may be synchronous.
- Cancellation uses `AbortSignal`; sessions and models can be released early with `using` or `[Symbol.dispose]()`.
- Random sampling needs `top` or `probabilityThreshold`; the framework has no seed-only random mode.

## Development

```bash
npm install
npm run build:native   # Builds foundation-models-c/ into lib/libFoundationModels.dylib
npm test               # Model-backed tests skip when the model is unavailable
npm run test:unit      # Skips the model-backed tests
npm run typecheck
npm run build          # Emits dist/
```

`foundation-models-c/` is vendored from the Python SDK (at `0249f35`) with three changes, all backward compatible with the C API the Python SDK binds:

- `BridgedTool.call` registers its continuation before calling out, so a tool that finishes before the call returns isn't lost (the call would otherwise hang).
- `FMBridgedToolCreateWithUserInfo` passes the tool and a `userInfo` to the callable, so one native callback serves every tool instead of one per tool, and a call to a collected tool fails instead of jumping to freed memory.
- Arrays of generable types keep their property description.

Set `APPLE_FM_SDK_LIBRARY` to load the bindings from another path.

## License

Apache License 2.0; see [LICENSE](LICENSE).

Copyright (C) 2026 Apple Inc. All Rights Reserved.
