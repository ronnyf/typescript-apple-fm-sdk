// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

// Generate typed values, and let the model call a tool.  Run: node examples/guided-generation.ts

import * as fm from '../src/index.ts';

const Cat = fm.generable(
  'Cat',
  {
    name: fm.string(),
    age: fm.integer({ description: 'Age in years', range: [0, 20] }),
    personality: fm.string({ anyOf: ['playful', 'shy', 'lazy', 'curious'] }),
    favoriteToys: fm.array(fm.string(), { maxItems: 3 }),
    adoptionNote: fm.optional(fm.string({ description: 'Anything an adopter should know' })),
  },
  { description: 'A cat waiting for adoption' },
);
type Cat = fm.Infer<typeof Cat>;

const Shelter = fm.generable('Shelter', {
  name: fm.string(),
  cats: fm.array(Cat, { count: 2 }),
});

const session = new fm.LanguageModelSession();
const cat: Cat = await session.respond('Generate an adorable rescue cat.', { generating: Cat });
console.log(`${cat.name} is ${cat.age} and ${cat.personality}; loves ${cat.favoriteToys.join(', ')}.`);

const shelter = await session.respond('Invent a small cat shelter.', { generating: Shelter });
console.log(`${shelter.name}: ${shelter.cats.map((c) => c.name).join(' and ')}`);

const adoptionFee = new fm.Tool({
  name: 'adoption_fee',
  description: 'Returns the adoption fee in US dollars for a cat of the given age.',
  arguments: fm.generable('AdoptionFeeArguments', { age: fm.integer({ minimum: 0 }) }),
  call: ({ age }) => String(age < 2 ? 150 : age < 10 ? 100 : 50),
});
const assistant = new fm.LanguageModelSession({
  instructions: 'You help people adopt cats. Use the adoption_fee tool for fees.',
  tools: [adoptionFee],
});
console.log(await assistant.respond(`How much does it cost to adopt ${cat.name}, who is ${cat.age}?`));
