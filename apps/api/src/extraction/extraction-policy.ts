/**
 * Every sentence and every figure the Extraction mechanism owns, stated once:
 * what a parent is told when there is nothing to report, how often the worker
 * looks for work, and how long a claim may be held before the job is fair game
 * again.
 *
 * Same four-section layout as `source-test-policy.ts` — constants, messages,
 * runtime, rules — and for the same reason: a figure that appears twice is a
 * figure that will eventually disagree with itself.
 */

import { resolveAiConfig } from '../ai/ai-config.js';
import { optionalBoolEnv, requireIntEnv } from '../common/env.js';
import { SOURCE_TEST_NOT_FOUND } from '../sourcetest/source-test-policy.js';

/**
 * How long a `Running` job's claim is honoured before another pass may take it.
 *
 * Comfortably longer than the AI timeout the run is waiting on, because the
 * common reason a claim is old is that the provider is slow, not that the
 * worker died. A timeout shorter than the call it is waiting for would hand the
 * same job to a second worker and pay for the same pages twice.
 */
export const DEFAULT_CLAIM_TIMEOUT_MS = 600_000;

/** How often the worker looks for a job when it has just found none. */
export const DEFAULT_POLL_MS = 1_000;

/**
 * How many claim passes one job gets before it is given up on.
 *
 * A job that kills the worker mid-run is indistinguishable from one whose
 * worker's machine went away, so the stale-claim rule hands it to the next
 * worker — which is right exactly until it is the *job* that is fatal, at which
 * point the same pages are read, and paid for, on every pass forever. The
 * ceiling is what turns that loop into a failure somebody can see.
 */
export const MAX_JOB_ATTEMPTS = 5;

// --- Messages ------------------------------------------------------------
//
// Not one of them carries a provider string, a payload fragment or a page byte
// (AD-20). The failure reasons in particular are constants written into the job
// row, never the message an exception happened to arrive with.

/**
 * The status read's one and only rejection. Every way it can fail — no job has
 * been enqueued because the Source Test is still a draft, the Source Test is
 * another account's, the id names nothing, the draft has expired — answers with
 * this, so nothing about the read confirms a Source Test exists somewhere.
 *
 * `SOURCE_TEST_NOT_FOUND` is re-exported rather than restated: the ownership
 * refusal is `sourcetest`'s sentence, and one rule gets one sentence wherever
 * it first got one.
 */
export const EXTRACTION_NOT_FOUND = 'That upload has not been read yet.';
export { SOURCE_TEST_NOT_FOUND };

/** Written into the job row when the provider could not produce an answer. */
export const EXTRACTION_FAILED = 'The test could not be read. Try again.';

/**
 * Written when the provider refused the request outright (AD-20) — a standing
 * fact, not an outage. "Try again" would be false: the same request fails the
 * same way every time, so the retry the other message invites cannot help.
 */
export const EXTRACTION_UPSTREAM_REJECTED =
  'The test could not be read, and trying again will not change that.';

/**
 * Written into the job row when the pages themselves were the problem. Distinct
 * from the above because only this one asks the parent to do something, and
 * only this one is never retried (AD-31).
 */
export const EXTRACTION_INPUT_UNUSABLE =
  'None of the pages could be read. Retake the photos in better light and submit again.';

/**
 * Written when the pages are no longer there to read — the Source Test was
 * removed, or its stored bytes were.
 *
 * Distinct from the sentence above on purpose: that one asks the parent to
 * retake photographs of something they still have, and saying it about an
 * upload that no longer exists would be an instruction nobody can follow.
 */
export const EXTRACTION_PAGES_GONE = 'That upload is no longer available to read.';

// --- Runtime -------------------------------------------------------------

export interface ExtractionRuntime {
  workerEnabled: boolean;
  pollMs: number;
  claimTimeoutMs: number;
}

let resolved: ExtractionRuntime | null = null;

/**
 * Reads and checks the three overrides once, at boot (`ExtractionModule` asks
 * for it as it is constructed), so a mistyped interval is a process that
 * refuses to start rather than a worker that silently never runs.
 */
export function extractionRuntime(): ExtractionRuntime {
  if (resolved === null) {
    resolved = {
      workerEnabled: optionalBoolEnv('EXTRACTION_WORKER_ENABLED', true),
      pollMs: requireIntEnv('EXTRACTION_POLL_MS', DEFAULT_POLL_MS),
      claimTimeoutMs: requireIntEnv('EXTRACTION_CLAIM_TIMEOUT_MS', DEFAULT_CLAIM_TIMEOUT_MS),
    };
    // The two figures are not independent. A claim held across `ai`'s own
    // retries — every attempt's timeout plus the backoff sleep between them —
    // must outlast the worst case of that whole sequence, not just one call:
    // a claim that expires while a retry is still in flight hands the same
    // pages to a second worker, and the account is billed twice for one
    // upload. Checked at boot rather than discovered on the invoice.
    const { timeoutMs: aiTimeoutMs, maxAttempts, retryBaseMs } = resolveAiConfig();
    const worstCaseRunMs =
      maxAttempts * aiTimeoutMs + retryBaseMs * (2 ** (maxAttempts - 1) - 1);
    if (resolved.claimTimeoutMs <= worstCaseRunMs) {
      const stated = resolved.claimTimeoutMs;
      resolved = null;
      throw new Error(
        `EXTRACTION_CLAIM_TIMEOUT_MS (${stated}) must be greater than the worst case of AI_MAX_ATTEMPTS (${maxAttempts}) retries at AI_TIMEOUT_MS (${aiTimeoutMs}) with AI_RETRY_BASE_MS (${retryBaseMs}) backoff (${worstCaseRunMs}ms): a claim that expires mid-retry is paid for twice.`,
      );
    }
  }
  return resolved;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetExtractionRuntime(): void {
  resolved = null;
}

/**
 * How long a claim is honoured, as one figure.
 *
 * The staleness rule itself is a `WHERE` clause in `claimNext` rather than a
 * predicate here: the decision has to be made by the statement that takes the
 * lock, so stating it twice — once in SQL and once in TypeScript — would be two
 * versions of one rule, which is precisely what this file exists to prevent.
 */
export function claimTimeoutMs(): number {
  return extractionRuntime().claimTimeoutMs;
}
