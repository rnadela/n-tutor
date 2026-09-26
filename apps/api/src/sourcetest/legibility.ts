/**
 * The Legibility call class, as `sourcetest` owns it: the question it asks, the
 * shape it accepts back, the deterministic post-hoc check that shape then has
 * to survive, and the deterministic answer the `fake` transport gives.
 *
 * All four live here rather than in `ai` under the AD-17 carve-out: the `ai`
 * module owns clients, pins, timeouts and cost rows, and knows nothing about
 * pages. What a readable page is, and what a payload about one has to say, is
 * this module's knowledge.
 */

import { z } from 'zod';
import { requireIntEnv } from '../common/env.js';
import type { PageLegibility } from '../generated/prisma/enums.js';
import type { PageBytes } from './source-test-reader.js';

/**
 * The legibility prompt (the AD-17 carve-out).
 *
 * It asks for one verdict per page and nothing else. Deliberately no overall
 * pass/fail: a whole-test verdict is precisely what the epic forbids, and a
 * field the model could answer is a field something downstream would eventually
 * read instead of the per-page ones.
 *
 * It states the rules the payload is afterwards checked against in code
 * (AD-30). Stating them is not trusting them — `validateLegibilityPayload` is
 * what actually holds the line; the prompt exists so the common case is right,
 * not so the check can be skipped.
 */
export const LEGIBILITY_PROMPT = [
  'You are looking at the photographed pages of one paper test. The images are the pages of a single document, given in page order: page 1 is the first image, page 2 the second, and so on.',
  '',
  'For each page, judge only one thing: how confidently its printed and handwritten content could be read from this photograph. Blur, glare, a shadow across the text, a page cut off at the edge, or a shot taken too far away all reduce that confidence.',
  '',
  'Rules:',
  '1. Answer with exactly one verdict for every page you were given, and none for any page you were not. Use the page ordinal each image was given under.',
  '2. Give each page a confidence of Low, Medium or High. Low means the page would have to be photographed again to be read reliably; High means it reads cleanly.',
  '3. Judge the photograph, never the test. A page of hard questions photographed well is High. A page of easy questions photographed badly is Low.',
  '4. Never guess at a page you were not given, and never merge two pages into one verdict.',
].join('\n');

/** The name the structured-output format is declared under. */
export const LEGIBILITY_SCHEMA_NAME = 'source_test_legibility';

/** The three verdicts, and the only three. Mirrors the `PageLegibility` enum. */
export const LegibilityConfidence = z.enum(['Low', 'Medium', 'High']);

/** One page's verdict, by the ordinal the caller sent the image under. */
export const LegibilityPageVerdict = z.object({
  ordinal: z.number().int(),
  confidence: LegibilityConfidence,
});

/**
 * The whole payload. One array and nothing else — no overall verdict, no
 * free-text note, nothing that could carry page content back into a log line
 * or a cost row (AD-20).
 *
 * It is a wire contract as much as a type: strict Structured Outputs accepts no
 * `minItems`, no `maxItems` and no `refine`, so every bound this payload has
 * lives in `validateLegibilityPayload` below, where it is actually enforced.
 */
export const LegibilityPayload = z.object({
  pages: z.array(LegibilityPageVerdict),
});

export type LegibilityPayload = z.infer<typeof LegibilityPayload>;

/** One page's verdict as the service stores it. */
export interface LegibilityVerdict {
  ordinal: number;
  legibility: PageLegibility;
}

/**
 * A payload that is the wrong shape, or that is the right shape and still says
 * something about a page set other than the one it was asked about.
 *
 * A plain named error thrown by a pure function and translated to a 503 by the
 * service: a pure module does not import Nest's HTTP exceptions, which is what
 * keeps it unit-testable without a framework. Its message names the class of
 * fault and never a page's content.
 */
export class LegibilityPayloadInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegibilityPayloadInvalid';
  }
}

export const LEGIBILITY_PAYLOAD_SHAPE_INVALID =
  'The legibility payload is not the shape the schema describes.';
export const LEGIBILITY_PAYLOAD_ORDINALS_WRONG =
  'The legibility payload does not carry exactly one verdict per submitted page.';

/**
 * The deterministic post-hoc pass of AD-30, run **after** the schema has had
 * its say and before a single verdict is stored.
 *
 * Three assertions, and the payload is rejected **whole** if any of them fails:
 * one verdict per stored ordinal, no ordinal the Source Test does not hold, and
 * no ordinal named twice. The confidence enum is the schema's own job, so it is
 * not restated here.
 *
 * Rejected whole rather than partially applied, because a half-stored check is
 * worse than no check: `legibilityCheckedAt` would then be set over a page set
 * the model never actually judged, and the submit gate would let it through.
 *
 * Returns the verdicts in stored-ordinal order, so the caller writes them in a
 * stable sequence rather than in whatever order the model happened to answer.
 */
export function validateLegibilityPayload(
  payload: unknown,
  ordinals: readonly number[],
): LegibilityVerdict[] {
  const parsed = LegibilityPayload.safeParse(payload);
  if (!parsed.success) throw new LegibilityPayloadInvalid(LEGIBILITY_PAYLOAD_SHAPE_INVALID);

  const byOrdinal = new Map<number, PageLegibility>();
  for (const verdict of parsed.data.pages) {
    // A repeat is a fault rather than a last-one-wins: two verdicts for one
    // page means the model did not understand the page set, and quietly taking
    // either would store a judgement nobody can account for.
    if (byOrdinal.has(verdict.ordinal)) {
      throw new LegibilityPayloadInvalid(LEGIBILITY_PAYLOAD_ORDINALS_WRONG);
    }
    byOrdinal.set(verdict.ordinal, verdict.confidence);
  }

  // Count first, so an extra verdict for an ordinal the Source Test does not
  // hold is caught even when every stored ordinal was also answered.
  if (byOrdinal.size !== ordinals.length) {
    throw new LegibilityPayloadInvalid(LEGIBILITY_PAYLOAD_ORDINALS_WRONG);
  }

  return ordinals.map((ordinal) => {
    const legibility = byOrdinal.get(ordinal);
    if (legibility === undefined) {
      throw new LegibilityPayloadInvalid(LEGIBILITY_PAYLOAD_ORDINALS_WRONG);
    }
    return { ordinal, legibility };
  });
}

/**
 * The stored byte size at or above which the `fake` transport calls a page
 * readable. Below it, the page comes back `Low`.
 *
 * AD-22 makes the `ai` boundary the only nondeterminism seam, and every tier
 * below the live suite runs on the fake — so the fake needs a rule a test can
 * arrange for without reaching into it. A deliberately tiny image is a flagged
 * page; a normal photograph is not. The int-spec and the E2E suite both arrange
 * a flagged page that way, and neither needs an env toggle or a per-test script
 * to do it.
 *
 * Read per call like `AI_FAKE_FAILURE`, through the one integer reader, so a
 * typo or a zero refuses rather than silently flagging everything.
 */
const DEFAULT_FAKE_UNREADABLE_BYTES = 2048;

export function fakeUnreadableBytes(): number {
  return requireIntEnv('AI_FAKE_UNREADABLE_BYTES', DEFAULT_FAKE_UNREADABLE_BYTES);
}

/**
 * What the `fake` transport answers, built from the bytes actually sent.
 *
 * A factory rather than a bare builder: `ai` hands its builder the image count
 * alone, and the verdict here is a function of each image's size, so the pages
 * are closed over at the call site. That keeps `ai` ignorant of what a page is,
 * which is the whole point of the carve-out.
 *
 * The threshold is read **inside** the builder, not here. The factory is
 * constructed on every check, including under `AI_TRANSPORT=openai` where this
 * builder is never invoked — so reading it eagerly would let a malformed
 * `AI_FAKE_UNREADABLE_BYTES` throw on a live provider call, outside the four
 * faults the service recognises, and surface to a parent as a 500.
 */
export function fakeLegibilityPayload(
  pages: readonly PageBytes[],
): (context: { imageCount: number }) => LegibilityPayload {
  return () => {
    const threshold = fakeUnreadableBytes();
    return {
      pages: pages.map((page) => ({
        ordinal: page.ordinal,
        confidence: page.buffer.length < threshold ? ('Low' as const) : ('High' as const),
      })),
    };
  };
}
