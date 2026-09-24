/**
 * The extraction prompt.
 *
 * This is the AD-17 carve-out: every provider call goes through `ai`, but the
 * *question* belongs to the module that owns the answer. `ai` knows about
 * clients, pins, timeouts and cost; it does not know what a Source Test is, and
 * a prompt about passages and Question Formats living there would be the first
 * step towards it knowing.
 *
 * It states the four rules the payload is afterwards checked against in code
 * (AD-30). Stating them is not trusting them: a model told to emit exactly one
 * format per question still sometimes emits two, and the deterministic pass in
 * `extraction-payload.ts` is what actually holds the line. The prompt exists so
 * the common case is right, not so the check can be skipped.
 */
export const EXTRACTION_PROMPT = [
  'You are reading the photographed pages of one paper test. The images are the pages of a single document, given in page order: page 1 is the first image, page 2 the second, and so on.',
  '',
  'Read all of the pages together as one document, and answer with the structured payload the schema describes.',
  '',
  'Rules:',
  '1. A passage, reading text or data table that more than one question depends on is a shared context. Emit it exactly once, in `contexts`, with the range of pages it occupies, and point every question that depends on it at it by `contextId` — including questions printed on a later page than the context itself.',
  '2. Emit every number that is written as a fraction as a structured fraction segment, with its numerator and denominator as separate integers and its whole part separate again for a mixed number. Never write a fraction as text such as "1/2" or "one half". This applies to question prompts, answer choices and context bodies alike.',
  '3. Give every question exactly one format — MultipleChoice, FillInTheBlank or ShortAnswer — and at least one topic describing what it tests. Give a MultipleChoice question every option printed for it, in the printed order; give every other format no options at all. Write topics in the words the page itself uses; do not translate them into a standard vocabulary.',
  '4. Never guess. If part of a page cannot be read — an un-photographed diagram, a handwriting-only region, content cropped off the edge — record it in `uninterpretable` with the page it is on and what kind of content it is, and set `dependsOnUninterpretable` on any question that needs it. If a whole page cannot be read at all, mark that page `interpretable: false`.',
  '',
  'Give every question and every topic an honest self-assessed confidence of Low, Medium or High. Low is the right answer for something you read but are unsure of; it is not a failure, and it is better than a confident guess.',
].join('\n');
