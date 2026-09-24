/**
 * Every sentence and every figure the generation mechanism owns, stated once:
 * how many Practice Tests one request may ask for, what a parent is told when
 * the answer is no, how often the worker looks for work, and how the requested
 * count and the per-format mix are actually computed.
 *
 * Same four-section layout as `extraction-policy.ts` — constants, messages,
 * runtime, rules — and for the same reason: a figure that appears twice is a
 * figure that will eventually disagree with itself.
 */

import type { QuestionFormat } from '../generated/prisma/enums.js';
import { resolveAiConfig } from '../ai/ai-config.js';
import { optionalBoolEnv, requireIntEnv } from '../common/env.js';
import { SOURCE_TEST_NOT_FOUND } from '../sourcetest/source-test-policy.js';

// --- Constants -----------------------------------------------------------

/**
 * The per-request ceiling, before the account's remaining Generation Allowance
 * is applied on top of it.
 *
 * Five, and stated here alone: the web app renders the list of counts from what
 * the API tells it, so this figure exists in exactly one place and recalibrating
 * it is one edit.
 */
export const MAX_PER_REQUEST = 5;

/**
 * How many claim passes one job gets before it is given up on.
 *
 * The same reasoning `extraction-policy.ts` gives: a job fatal to its worker is
 * indistinguishable from a worker whose machine went away, and without a
 * ceiling the stale-claim rule pays for the same generation on every pass
 * forever. The difference here is that the ceiling protects *landed* work too —
 * a reclaimed job resumes from `producedCount` rather than starting over, so a
 * bounded number of passes is also a bound on how many drafts one request can
 * produce beyond what it asked for.
 */
export const MAX_JOB_ATTEMPTS = 5;

/**
 * How long a `Running` job's claim is honoured before another pass may take it.
 *
 * Longer than extraction's, and for a reason the boot-time invariant below
 * restates: one generation job makes up to `MAX_PER_REQUEST` AI calls in
 * sequence, and a post-hoc payload rejection re-issues any one of those calls
 * up to `AI_MAX_ATTEMPTS` times over, so the worst case it has to outlast is
 * the whole retry sequence `AI_MAX_ATTEMPTS × MAX_PER_REQUEST` times over, not
 * once.
 */
export const DEFAULT_CLAIM_TIMEOUT_MS = 10_800_000;

/** How often the worker looks for work when it has just found none. */
export const DEFAULT_POLL_MS = 1_000;

// --- Messages ------------------------------------------------------------
//
// Not one of them carries a provider string, a model name, a tier label or a
// fragment of generated content (AD-20). The failure reasons in particular are
// constants written into the job row, never the message an exception happened
// to arrive with.

/**
 * The progress read's one and only rejection, and the refusal a foreign or
 * unknown Source Test id gets. Re-exported rather than restated: the ownership
 * refusal is `sourcetest`'s sentence, and one rule gets one sentence wherever
 * it first got one (AD-18).
 */
export { SOURCE_TEST_NOT_FOUND };

/** No job has been requested for this Source Test yet. */
export const GENERATION_NOT_REQUESTED = 'No practice test has been generated from this upload yet.';

/**
 * Nothing of the Generation Allowance is left this period.
 *
 * It names the allowance and states the fact; it does not name the tier, the
 * limit or a price, and it does not invite an upgrade. Epic 9 owns the hard
 * block; this is the refusal the clamp already implies.
 */
export const NO_GENERATION_ALLOWANCE =
  'No Generation Allowance is left this period. It resets at the start of the next one.';

/** There is nothing to generate from. */
export const NO_USABLE_QUESTIONS =
  'No questions could be used from this upload. Retake the pages and submit again.';

/** The Extraction has not finished, so there is nothing to read yet. */
export const EXTRACTION_NOT_READY = 'This upload has not finished being read yet.';

/** Written into the job row when the provider could not produce an answer. */
export const GENERATION_FAILED = 'The practice test could not be written. Try again.';

/**
 * Written when the provider refused the request outright — a standing fact, not
 * an outage. "Try again" would be false: the same request fails the same way.
 */
export const GENERATION_UPSTREAM_REJECTED =
  'The practice test could not be written, and trying again will not change that.';

/**
 * Written when the Extraction this job was to generate from is no longer there.
 * Terminal: a retry reads the same nothing, and it is not a thing to ask the
 * parent to try again.
 */
export const GENERATION_SOURCE_GONE = 'That upload is no longer available to generate from.';

/**
 * Written when the input itself was the problem — the Extraction held nothing
 * usable by the time the job ran. Distinct from the two above because only this
 * one asks the parent to do something, and it is never retried (AD-31).
 */
export const GENERATION_INPUT_UNUSABLE = NO_USABLE_QUESTIONS;

/**
 * Written when this service asked for a call it cannot make — a request whose
 * own two halves disagree, which `AiService` refuses before reaching a
 * provider.
 *
 * It has a sentence of its own precisely so it is **not** the one above. That
 * one tells a parent to photograph the test again, and a mistake on this side
 * of the wire is not made better by a better photograph: the pages were fine,
 * and asking for new ones would send them to do work that cannot help. Terminal
 * and never retried, because the same request is identically impossible.
 */
export const GENERATION_REQUEST_REJECTED =
  'The practice test could not be written. Nothing about the upload needs changing.';

/**
 * Written when the instant a draft landed on falls outside the period window
 * computed for that same instant.
 *
 * That is arithmetically impossible without a clock or timezone anomaly on this
 * machine, and it matters because the Generation Allowance is *derived* by
 * counting charges inside a window: a charge written outside every window is
 * money spent that no period will ever count. Terminal and never retried — the
 * retry would be run against the same broken clock, and each attempt would
 * spend another provider call to reach the same impossible arithmetic.
 */
export const GENERATION_CLOCK_ANOMALY =
  'The practice test could not be written, and trying again will not change that yet.';

// --- Runtime -------------------------------------------------------------

export interface PracticeTestRuntime {
  workerEnabled: boolean;
  pollMs: number;
  claimTimeoutMs: number;
}

let resolved: PracticeTestRuntime | null = null;

/**
 * The worst case one job has to outlast: `produceDraft` re-issues a whole `ai`
 * call up to `maxAttempts` times on a post-hoc payload rejection (each such
 * call carrying its own full transport-retry budget), once per `MAX_PER_REQUEST`
 * draft. Exported so the boot-time invariant below and its test derive the
 * figure from one formula rather than two that can drift.
 */
export function worstCaseRunMs(): number {
  const { timeoutMs, maxAttempts, retryBaseMs } = resolveAiConfig();
  const worstCaseCallMs = maxAttempts * timeoutMs + retryBaseMs * (2 ** (maxAttempts - 1) - 1);
  return worstCaseCallMs * maxAttempts * MAX_PER_REQUEST;
}

/**
 * Reads and checks the three overrides once, at boot (`PracticeTestModule` asks
 * for it as it is constructed), so a mistyped interval is a process that
 * refuses to start rather than a worker that silently never runs.
 */
export function practiceTestRuntime(): PracticeTestRuntime {
  if (resolved === null) {
    resolved = {
      workerEnabled: optionalBoolEnv('GENERATION_WORKER_ENABLED', true),
      pollMs: requireIntEnv('GENERATION_POLL_MS', DEFAULT_POLL_MS),
      claimTimeoutMs: requireIntEnv('GENERATION_CLAIM_TIMEOUT_MS', DEFAULT_CLAIM_TIMEOUT_MS),
    };
    // The same invariant `extraction-policy.ts` checks, multiplied by the one
    // thing that differs: a generation job makes up to `MAX_PER_REQUEST` calls
    // in sequence, each with its own full retry budget. A claim that expires
    // while the fourth call is in flight hands the job to a second worker,
    // which resumes from `producedCount` and generates — and charges for —
    // drafts the first worker is still producing. Checked at boot rather than
    // discovered on the invoice.
    const runMs = worstCaseRunMs();
    if (resolved.claimTimeoutMs <= runMs) {
      const stated = resolved.claimTimeoutMs;
      const { timeoutMs: aiTimeoutMs, maxAttempts, retryBaseMs } = resolveAiConfig();
      resolved = null;
      throw new Error(
        `GENERATION_CLAIM_TIMEOUT_MS (${stated}) must be greater than the worst case of ${MAX_PER_REQUEST} sequential AI calls, each of AI_MAX_ATTEMPTS (${maxAttempts}) attempts at AI_TIMEOUT_MS (${aiTimeoutMs}) with AI_RETRY_BASE_MS (${retryBaseMs}) backoff (${runMs}ms): a claim that expires mid-run is charged for twice.`,
      );
    }
  }
  return resolved;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetPracticeTestRuntime(): void {
  resolved = null;
}

/**
 * How long a claim is honoured, as one figure.
 *
 * The staleness rule itself is a `WHERE` clause in `claimNext` rather than a
 * predicate here, for the reason `extraction-policy.ts` gives: the decision has
 * to be made by the statement that takes the lock.
 */
export function claimTimeoutMs(): number {
  return practiceTestRuntime().claimTimeoutMs;
}

// --- Rules ---------------------------------------------------------------

/**
 * What is left of the Generation Allowance this period.
 *
 * `null` is unlimited and is never a sentinel number — it resolves to the
 * per-request ceiling, because that is genuinely what remains *for one request*
 * on an unlimited tier. Usage above the limit (a tier downgraded mid-period)
 * floors at zero rather than going negative, so a downgrade refuses rather than
 * producing a nonsense count.
 */
export function remainingFor(used: number, limit: number | null): number {
  if (limit === null) return MAX_PER_REQUEST;
  return Math.max(0, limit - used);
}

/**
 * The server's own count, computed independently of whatever the client sent.
 *
 * The UI disabling a radio button is a courtesy; this is the control. A request
 * for nine on an account with two left is a request for two, silently, and the
 * response states the clamped figure so nothing about it is a surprise. A
 * non-positive or non-integer ask clamps to zero, which the caller refuses.
 */
export function clampCount(requested: number, remaining: number): number {
  if (!Number.isFinite(requested)) return 0;
  const asked = Math.floor(requested);
  if (asked <= 0) return 0;
  return Math.min(asked, MAX_PER_REQUEST, Math.max(0, remaining));
}

/**
 * How many generated Questions each Format gets, so the mix reproduces the
 * source's proportionally.
 *
 * Largest-remainder apportionment, and it has to be: rounding each format's
 * share independently gives a set of counts that does not add up to `total`,
 * and a Practice Test with one question too many or too few is not what was
 * asked for. Every format present in the source appears in the result, even
 * when its share rounds to zero — a rule that can silently drop a format is a
 * rule the post-hoc check could never state.
 *
 * Ties in the remainder are broken by the format's own order in the source,
 * which is what makes the whole function deterministic: the same Extraction
 * apportions the same way on every call, so a test asserts on figures rather
 * than on whichever key the runtime happened to iterate first.
 */
export function formatTargets(
  sourceFormats: readonly QuestionFormat[],
  total: number,
): Map<QuestionFormat, number> {
  const targets = new Map<QuestionFormat, number>();
  if (total <= 0 || sourceFormats.length === 0) return targets;

  // Order of first appearance, which is the tie-break below.
  const order: QuestionFormat[] = [];
  const counts = new Map<QuestionFormat, number>();
  for (const format of sourceFormats) {
    if (!counts.has(format)) order.push(format);
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }

  const shares = order.map((format) => {
    const exact = ((counts.get(format) ?? 0) * total) / sourceFormats.length;
    const floor = Math.floor(exact);
    return { format, floor, remainder: exact - floor };
  });

  let assigned = shares.reduce((sum, share) => sum + share.floor, 0);
  // The seats the floors left over, handed out by largest remainder, ties
  // broken by first appearance. `assigned` can never exceed `total`, because a
  // sum of floors of shares that sum to `total` cannot.
  const byRemainder = shares
    .map((share, index) => ({ ...share, index }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  const extra = new Map<QuestionFormat, number>();
  for (const share of byRemainder) {
    if (assigned >= total) break;
    extra.set(share.format, (extra.get(share.format) ?? 0) + 1);
    assigned += 1;
  }

  for (const share of shares) {
    targets.set(share.format, share.floor + (extra.get(share.format) ?? 0));
  }
  return targets;
}
