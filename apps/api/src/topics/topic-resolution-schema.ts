import { z } from 'zod';
import type { AiFakeFailure } from '../ai/ai-config.js';
import { topicTokens } from './topic-match-key.js';

/**
 * Stage 3's wire contract: the shape a Topic resolution must come back in, and
 * the deterministic answer the `fake` transport gives.
 *
 * Both live here under the AD-17 carve-out, beside the prompt, for the reason
 * `explanation-schema.ts` gives: `ai` owns clients, pins, timeouts and cost
 * rows, and knows nothing about what a Topic is. What a valid resolution looks
 * like is this module's knowledge.
 */

/**
 * The answer that means "none of these candidates is this label".
 *
 * A reserved string in the same field rather than a second boolean, because the
 * two answers are one decision and a boolean beside an id is a payload that can
 * contradict itself — `{ fits: false, topicId: 'abc' }` is a shape somebody then
 * has to decide the meaning of. One field, one answer.
 *
 * It cannot collide with a real candidate: every candidate id is a uuid.
 */
export const TOPIC_NONE_FIT = 'none';

/**
 * The whole payload: one field, and only one.
 *
 * **A plain string and not an enum of the candidate ids**, although strict
 * Structured Outputs would express that. Two reasons, and the first is the
 * decisive one: a per-call enum makes the schema a function of the candidate
 * list, so the schema this file exports would no longer be the contract — it
 * would be a template, and the `fake` transport and the real one would be held
 * to different ones. The second is that the cascade already has to handle an id
 * that is not on the list (it treats it as no match and mints), because a model
 * that hallucinates an id and a model that answers `none` are the same fact
 * about this call; a schema that made the first case impossible would delete a
 * branch the matrix requires rather than the failure it stands for.
 *
 * It is a wire contract as much as a type: nothing optional, no bounds. Strict
 * Structured Outputs expresses no `minLength` and no `refine`, so a limit
 * written here would be one the API silently drops. What the string is allowed
 * to be is checked in `topic.service.ts`, against the candidate list it was
 * built from.
 *
 * There is exactly one field. No confidence, no suggested name, no "how sure are
 * you": a confidence the model reported would immediately become a second
 * threshold beside `TOPIC_SIMILARITY_THRESHOLD`, and a name it suggested would
 * be a rename — which AD-11 gives this module no licence to perform and Story
 * 7.6 gives a human.
 */
export const TopicResolutionPayload = z.object({
  /** A candidate id copied verbatim, or `TOPIC_NONE_FIT`. */
  topicId: z.string(),
});

export type TopicResolutionPayload = z.infer<typeof TopicResolutionPayload>;

/** The name the structured-output format is declared under. */
export const TOPIC_RESOLUTION_SCHEMA_NAME = 'topic_resolution';

/** One candidate as stage 3 is shown it. */
export interface TopicCandidate {
  id: string;
  name: string;
}

/**
 * What the `fake` transport answers with (AD-22).
 *
 * **It answers from the domain, not from a fixture.** The fake names the first
 * candidate that shares a meaningful token with the label, and `none` when no
 * candidate does. That makes both stage-3 branches reachable from a test that
 * only chooses its labels — `Fraction Estimation` against a set holding
 * `Fraction Word Problems` is a match, `Photosynthesis` against a set holding
 * `Long Division` is a mint — rather than from a latch a spec has to remember to
 * set. Token overlap is a coarser rule than the real model's and that is the
 * point: it is well below the stage-2 threshold those same pairs score at, so a
 * fake stage-3 match is genuinely a case stage 2 declined.
 *
 * The first matching candidate rather than the best one, because the candidates
 * arrive oldest-first and "the model picked one" is all the cascade may assume.
 *
 * The `unusable` latch — which has no natural meaning for a text call, there
 * being no photograph to be unreadable — is spent here on the one provider
 * misbehaviour the matrix names: an id that is **not** on the candidate list.
 * `transport` and `schema` are `ai`'s to raise before this builder's output is
 * ever parsed.
 */
export function fakeTopicResolutionPayload(
  label: string,
  candidates: readonly TopicCandidate[],
): (context: { imageCount: number; failure: AiFakeFailure }) => TopicResolutionPayload {
  return (context) => {
    if (context.failure === 'unusable') {
      // Shaped like an id and belonging to nothing: the cascade must treat it as
      // no match and mint, not trust it and return a Topic that is not there.
      return { topicId: 'fake-candidate-that-is-not-on-the-list' };
    }
    const wanted = new Set(topicTokens(label));
    const named = candidates.find((candidate) =>
      topicTokens(candidate.name).some((token) => wanted.has(token)),
    );
    return { topicId: named?.id ?? TOPIC_NONE_FIT };
  };
}
