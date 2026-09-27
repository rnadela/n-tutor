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

/**
 * What "predominantly on the chosen Topic" actually means, as a share.
 *
 * A figure rather than a phrase, and a figure in exactly one place: the prompt
 * quotes the count it produces and the post-hoc pass counts against the same
 * count, so the instruction and the check cannot drift apart. Three fifths is
 * the product's answer to "predominantly" — comfortably a majority, and still
 * leaving room for the Extraction's other Topics, which a weighted draft is
 * still required to cover.
 */
export const WEIGHTED_TOPIC_SHARE = 0.6;

/**
 * The longest a weighted Topic label may be on the way in.
 *
 * Mirrors `MAX_LABEL_LENGTH` in `practice-test-payload.ts`, because the two
 * bound the same thing from opposite directions: that one is the ceiling on a
 * label coming back from a provider, this one the ceiling on a label arriving
 * from a browser. A request carrying a label longer than any label the
 * Extraction could hold is malformed rather than merely unknown, so the DTO
 * refuses it on shape before a row is read.
 */
export const MAX_TOPIC_LABEL_LENGTH = 200;

/**
 * The shortest countdown a parent may configure, in minutes.
 *
 * One, not zero: zero minutes is not a short test, it is a test that has already
 * expired, and "no timer" already has a value of its own — `null`. A figure
 * below this is a malformed request rather than a figure to clamp, which is why
 * the DTO refuses it with a 400 while `RequestPracticeTestsDto`'s `count`
 * deliberately has no ceiling at all.
 */
export const MIN_TIMER_MINUTES = 1;

/**
 * The longest countdown a parent may configure, in minutes.
 *
 * Three hours, which is longer than any homework practice test and short enough
 * that a mistyped figure is caught rather than stored. Stated here alone so the
 * DTO, the suggestion below and the screen cannot each hold their own ceiling.
 */
export const MAX_TIMER_MINUTES = 180;

/** A minute per Question, in the suggestion below. */
export const TIMER_MINUTES_PER_QUESTION = 1;

/** Plus five, to read the paper and check the answers. */
export const TIMER_MINUTES_OVERHEAD = 5;

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

/**
 * The draft reads' one and only refusal.
 *
 * One sentence for three different facts — an id that never existed, an id
 * belonging to another account, and an owned id whose Practice Test is no
 * longer a draft — and that is the point (AD-18): an id a parent may not read
 * is an id that does not exist, and three sentences would let the outside tell
 * the three apart. It names no Practice Test, no Topic and no count.
 */
export const PRACTICE_TEST_NOT_FOUND = 'That practice test could not be found.';

/**
 * The weighted Topic asked for is not one this upload carries.
 *
 * It names no Topic — not the one asked for and not the ones available — for
 * the same reason nothing else here does: a Topic label is content read off a
 * parent's own page, and a refusal sentence is a place it has no business
 * being. The screen offers the Extraction's own labels, so a parent reaching
 * this sentence asked for something the screen never showed them.
 */
export const WEIGHTED_TOPIC_UNKNOWN =
  'That topic is not one this upload covers. Choose one of the topics offered, or all topics.';

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
 * The duration the screen pre-fills, derived from the stored question count.
 *
 * `questionCount + 5`, clamped to the bounds — a minute a Question plus five to
 * read and check — chosen because it reproduces the PRD's own worked example
 * (15 questions, 20 minutes, §UJ-2) rather than inventing a second figure beside
 * it. Computed here and carried on the draft view so the screen, Epic 5's own
 * surfaces and every test read one definition of "suggested".
 *
 * It is a **suggestion only**: nothing stores it. A parent who opens a draft,
 * reads it and releases it without touching the timer has released an untimed
 * test, and the stored `null` says so.
 */
export function suggestedTimerMinutes(questionCount: number): number {
  if (!Number.isFinite(questionCount)) return MIN_TIMER_MINUTES;
  const questions = Math.max(0, Math.floor(questionCount));
  const suggested = questions * TIMER_MINUTES_PER_QUESTION + TIMER_MINUTES_OVERHEAD;
  return Math.min(MAX_TIMER_MINUTES, Math.max(MIN_TIMER_MINUTES, suggested));
}

/**
 * When two Topic labels are the same Topic, for the two places that have to
 * agree: the request-time resolve of what the parent asked for against what the
 * Extraction carries, and the post-hoc count of how many generated questions
 * landed on it.
 *
 * Case and whitespace only. This is **not** canonicalization and never becomes
 * it (AD-11, Epic 7): "Fractions" and "fraction" stay two different Topics
 * here, because deciding they are one is Mastery's job and doing it in two
 * places would split one concept into two Mastery values. All this says is that
 * `'  fractions '` and `'Fractions'` are the same label typed twice, which is
 * the only drift the request and the model actually produce.
 */
export function normalizeTopicLabel(label: string): string {
  return label.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
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
 * How many of a weighted draft's Questions must carry the weighted Topic.
 *
 * A floor rather than a majority, and deliberately: a floor is a number the
 * prompt can quote and the post-hoc pass can state, while "most of them" is a
 * comparison whose meaning wobbles at small totals. One question minimum, so a
 * one-question Extraction is weightable at all; never more than `total`, so the
 * rule is always satisfiable by a draft that puts every question on the Topic.
 */
export function weightedTopicFloor(total: number): number {
  if (!Number.isFinite(total)) return 0;
  const questions = Math.floor(total);
  if (questions <= 0) return 0;
  return Math.min(questions, Math.max(1, Math.ceil(questions * WEIGHTED_TOPIC_SHARE)));
}

/**
 * A weighting, as one indivisible thing.
 *
 * The Topic and the floor travel together and are built together, because the
 * two are one rule stated twice — once to the model in the prompt, once to the
 * post-hoc pass in code. Held as two independently-optional fields, a caller
 * could pass the Topic and forget the floor, and the check would silently
 * accept every draft with no type error to say so.
 */
export interface GenerationWeighting {
  /** The Topic to concentrate on, in the Extraction's own spelling. */
  topic: string;
  /** How many of the draft's Questions must carry it. */
  floor: number;
}

/**
 * Builds the weighting for a draft of `total` Questions, or nothing at all.
 *
 * The one place a `GenerationWeighting` is made, so the floor is always
 * `weightedTopicFloor(total)` for the Topic it sits beside and never a figure
 * somebody computed separately.
 */
export function weightingFor(topic: string | null, total: number): GenerationWeighting | null {
  if (topic === null) return null;
  return { topic, floor: weightedTopicFloor(total) };
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

// --- The student's list ----------------------------------------------------

/** The three conditions a released Practice Test can be in, for a child. */
export type StudentListState = 'NotStarted' | 'InProgress' | 'Completed';

/** The one thing the list needs off an Attempt: whether, and when, it was handed in. */
export interface AttemptSubmission {
  submittedAt: Date | null;
}

/**
 * Which of the three conditions a released Practice Test is in.
 *
 * Derived from Attempts and from nothing stored: there is no `Completed`
 * member on `PracticeTestStatus` and there is deliberately never going to be
 * one, because a status written here would record what is really an Attempt
 * fact, and Story 5.7's retake would then have to walk it backwards.
 *
 * **An open Attempt outranks a submitted one.** The band exists to surface what
 * there is to do, so a retake left open reads as in progress even though the
 * test has been completed before — which is the reading Story 5.7 needs too.
 */
export function studentListState(attempts: readonly AttemptSubmission[]): StudentListState {
  if (attempts.length === 0) return 'NotStarted';
  if (attempts.some((attempt) => attempt.submittedAt === null)) return 'InProgress';
  return 'Completed';
}

/**
 * The most recent submission across a test's Attempts, or null if none was
 * ever handed in. What band 2 is ordered by.
 */
export function lastSubmission(attempts: readonly AttemptSubmission[]): Date | null {
  let latest: Date | null = null;
  for (const attempt of attempts) {
    if (attempt.submittedAt === null) continue;
    if (latest === null || attempt.submittedAt.getTime() > latest.getTime()) {
      latest = attempt.submittedAt;
    }
  }
  return latest;
}

/** One row as the comparator reads it. */
export interface StudentListRow {
  id: string;
  createdAt: Date;
  state: StudentListState;
  /** The most recent submission, for a completed row. Null in band 1. */
  lastSubmittedAt: Date | null;
}

/**
 * The order the child sees: everything there is still to do, then everything
 * finished.
 *
 * Two bands. Band 1 is every non-completed row — not started and in progress
 * side by side, because both are work waiting — newest **made** first, since
 * there is no `releasedAt` column to sort on. Band 2 is the completed rows,
 * most recently **submitted** first, which is the instant that actually
 * distinguishes them. `id` descending breaks a tie in both, exactly as
 * `releasedFor` already tiebreaks, so two rows sharing an instant are never
 * left in whatever order the planner returned.
 *
 * A total order, and deliberately so: the sort it drives must be stable
 * whatever the input order, or the list would shuffle between reads.
 */
export function compareStudentListRows(a: StudentListRow, b: StudentListRow): number {
  const bandOf = (row: StudentListRow) => (row.state === 'Completed' ? 1 : 0);
  const band = bandOf(a) - bandOf(b);
  if (band !== 0) return band;

  if (bandOf(a) === 1) {
    // A completed row always has a submission — `studentListState` only says
    // `Completed` when every Attempt carries one — so the `?? 0` is reached by
    // no caller and exists only so the comparison is total on the type.
    const bySubmission = (b.lastSubmittedAt?.getTime() ?? 0) - (a.lastSubmittedAt?.getTime() ?? 0);
    if (bySubmission !== 0) return bySubmission;
  } else {
    const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
  }

  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
