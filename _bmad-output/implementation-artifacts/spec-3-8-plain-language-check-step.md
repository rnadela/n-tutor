---
title: 'Story 3.8 — Plain-Language Check Step & Upload Allowance Left'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_revision: '83e63a6dfc9c3a07d220db1ffc798dc91e035608'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The API's own refusal sentence for an unchecked submission still reads
      "Check the pages before submitting." and reaches the parent on the Check
      step, so one system-vocabulary string survives this story's rule.
    evidence: |-
      The web copy for that same refusal was reworded to "Check the pages
      before you continue.", but the server authors its own 400 body, and
      `writeRefusal` deliberately prefers the API's sentence over the screen's
      fallback. `e2e/tests/parent-capture.spec.ts` asserts the API text
      verbatim at the API-only flow. Closing it means rewording the API's
      allowance/legibility policy strings and their integration-test
      assertions, which this story's intent-contract forbids ("no API, DTO,
      Prisma or route change"). Pre-existing: the sentence predates this story.
    location: >-
      apps/api/src/sourcetest (submit refusal copy) + e2e/tests/parent-capture.spec.ts
    severity: low
  - summary: >-
      None of this screen's six request-counter reads — including the new
      allowance read — has a behavioral test for the endsParentView(cause) →
      leave() branch; only source-text assertions check for the literal
      leave()/setError substrings.
    evidence: |-
      page.spec.tsx slices PAGE_SOURCE and asserts the handler text contains
      'leave();' and not 'setError', which would still pass if the branch's
      condition were inverted or deleted. No e2e test in
      e2e/tests/parent-capture.spec.ts supplies a session-ending cause to any
      of the screen's reads (the only mocked allowance failure is a plain 500,
      which is not session-ending). page.spec.tsx never renders CapturePage
      itself with mocked fetches — it only does static source-text assertions
      and renders small subcomponents via renderToStaticMarkup — so this is a
      pre-existing limitation of the test architecture, not something this
      story introduced or worsened for its one new read.
    location: >-
      apps/web/src/app/parent/capture/page.tsx (all six request-counter
      reads, including the allowance read added by this story)
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Check step of the upload stepper still speaks the system's vocabulary — "Continuing commits this upload", "Committing the upload…", "not a block", "before submitting", "These pages were submitted" — and states the Upload Allowance cost in words with no figure, because Story 9.6's parent-facing Allowances surface did not exist when Story 3.4 wrote that copy. A parent is asked to spend an allowance without being told how much is left.

**Approach:** Reword every parent-facing string the Check step renders into everyday words (keeping the term "Upload Allowance" as Settings spells it), and add one line above the continue control stating what is left and when it resets — read from `GET /parent/allowances` through the existing `parentApi.allowances`, degraded to nothing on failure, and re-read rather than decremented after a successful continue.

## Boundaries & Constraints

**Always:**
- Copy and one read only. No API, DTO, Prisma or route change; `checkSourceTestLegibility`, `submitSourceTest` and every other request on this screen keep their shapes, order and refusal handling.
- Every figure and the reset instant come from the `AccountConsumption` payload. The app computes only `limit - used`, clamped at zero, in one pure helper with a sibling spec — no tier table, no limit, no date and no period of its own.
- The reset date renders through `dateOnly(consumption.resetAt, consumption.timezone)` from `lib/consumption-format.ts` — the account's zone, never the viewer's and never UTC.
- `limit: null` is unlimited, said in words, with no figure and never as "0 left".
- The allowance read is degraded, never fatal: a failure leaves `error` untouched, omits the figure, and leaves the cost sentence and the continue control working. A cause that `endsParentView` still routes to `leave()`.
- The read is guarded by its own request counter + live ref, with `applyIfCurrent`, exactly as the screen's five existing streams are (`page.tsx:156-192`).
- All new strings live in `apps/web/src/copy/parent.ts` (AD-32). No hex outside `theme/tokens.ts`; spacing from `density`.
- Every existing DOM id and `data-testid` on this screen survives; the only additions are the allowance line's own testid.
- `page.spec.tsx` and `e2e/tests/parent-capture.spec.ts` are updated in the same change. An assertion whose quoted string was reworded is re-asserted against the new wording, never deleted.

**Block If:**
- Stating what is left would require a new API field or endpoint (`AccountConsumption.allowances.upload` plus `resetAt`/`timezone` already carry everything).

**Never:**
- Do not gate, disable or hide the continue control on a spent allowance, and do not pre-check the figure before submitting. Zero left stays exactly Story 9.3's behaviour: the server answers 409 with its own sentence and `writeRefusal` shows it.
- Do not decrement, cache or carry any allowance figure across a write.
- Do not touch Settings' Allowances panel, `consumption-format.ts`'s functions, the Admin console, or the `generate` screen's own allowance copy.
- Do not reword strings that no Check-step render path reaches (the camera, classification, page-strip, extraction and thin-warning namespaces).
- Do not add a second `role="status"`, a stepper change, or a spinner (Story 4.7's).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Limited plan, Check step opens | `allowances.upload = { used: 1, limit: 5 }`, `resetAt`, `timezone` | One line states 4 of 5 left and the reset date, above the cost sentence and the continue control | No error expected |
| Unlimited plan | `allowances.upload.limit === null` | The line says the Upload Allowance is unlimited; no figure, no "0 left" | No error expected |
| Allowance read fails | `parentApi.allowances` rejects (non-elevation cause) | No allowance line; cost sentence, no-cost sentence and continue control all render and work; no error `Alert` | Swallowed — figure omitted |
| Allowance read fails with an expired elevation | `endsParentView(cause)` | `leave()`, as every other read on this screen does | Existing path |
| Successful continue | commit resolves, status Draft → Submitted | The figure the parent next sees on the Check step is a fresh read reflecting the upload just used | No error expected |
| Zero left, parent continues | `used === limit`, server answers 409 | The control was never disabled; the API's own sentence (tier, usage, reset) is shown through `writeRefusal` | Existing 9.3 path, unchanged |
| Check step before the check has run | `legibilityCheckedAt === null` | The allowance line renders with the check control (the cost is what continuing will spend); no system vocabulary in the refusal sentence | No error expected |
| Committed upload, Back to Check | `status: 'Submitted'` | Read-only panel keeps the verdict, states the pages are saved in everyday words, and shows the re-read figure | Read failure omits the figure |

</intent-contract>

## Code Map

**Read-only anchors (patterns to follow, do not change):**
- `apps/web/src/app/parent/capture/page.tsx:156-192` — the five request-counter streams (`useRef(0)` + live ref, `applyIfCurrent`). The allowance read adds a sixth of exactly this shape and disturbs none of them.
- `page.tsx:414-435` — `write(kind, run, said)`, the single mutation path. `submit()` (`:847-855`) goes through it; the re-read must not be bolted into it.
- `page.tsx:1163-1322` — the draft Check step: `check-pages`, `checking`, `submit-blocked` (`:1197`, reasons filtered of `'legibility'`), the `legibility-result` section, `legibility-advisory` (`:1298`), `legibility-cost` (`:1305`), `legibility-no-cost` (`:1308`), `legibility-continue` (`:1316`). The allowance line goes inside this card, above `legibility-cost`.
- `page.tsx:1331-1370` — the committed Check step (`legibility-committed`, `submitted-note`). Gets the same allowance line, no controls.
- `page.tsx:1097` — `submittedNote` also renders on the Pages step. One string, reworded once, serves both.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx:205-317` — the precedent to copy: an allowance read on mount, a degraded optional read via `.catch`, and the **re-read once the job settles** with its own `refreshingAllowance` flag and the comment explaining why a locally-decremented figure would be a lie.
- `apps/web/src/lib/consumption-format.ts:36-48` — `AllowanceReading` / `AccountConsumption`; `:70` `dateOnly`; `:84` `limitLabel`. This is the shared vocabulary; nothing new is defined for it.
- `apps/web/src/lib/parent-api.ts:1942-1947` — `parentApi.allowances(token)`, elevated, charges nothing, answered at cap; its fallback sentence is `parentCopy.settings.allowancesFailed`.
- `apps/api/src/allowance/parent-allowance.controller.ts:45` — `GET parent/allowances`. Server side is Story 9.6's and is untouched.
- `apps/web/src/lib/practice-test-count.ts:85` — `remainingAfter(count, limit, used)`: the existing clamp-at-zero, `null`-is-unlimited idiom the new helper mirrors (it is denominated in practice tests, so it is a pattern, not a reuse).
- `apps/web/src/lib/legibility.ts`, `lib/capture-step.ts` — the pure-helper-plus-sibling-spec convention the new lib follows.
- `apps/web/src/copy/parent.ts:32-55` — the module-level shared-constant idiom (`GRADE_LABELS`, `MASTERY_FIGURE`) for a term two groups must spell identically.
- `apps/web/src/copy/parent.ts:425-441` — Settings' `uploadAllowance` label, `allowanceResets`, `allowancesFailed`. `:748-809` — the `capture.legibility` block. `:660-686` — `capture.submit`/`submitting`/`submitBlocked`. `:694-699` — `capture.submitted`, `submittedNote`. `:889-891` — `capture.failed`, `submitFailed`.
- `apps/web/src/app/parent/capture/page.spec.tsx:22-27` — the `PAGE_SOURCE` source-text idiom; `:1388-1472` — the legibility copy assertions, including **`'states no figure and shows no usage counter — Story 9.6 owns that surface'`**, which this story supersedes and must replace (not delete silently).
- `e2e/tests/parent-capture.spec.ts:365`, `:439-448`, `:511-514`, `:543`, `:665` — the browser assertions quoting the reworded sentences.

**Files to create:**
- `apps/web/src/lib/upload-allowance.ts`, `apps/web/src/lib/upload-allowance.spec.ts`

**Files to change:**
- `apps/web/src/copy/parent.ts`
- `apps/web/src/app/parent/capture/page.tsx`, `page.spec.tsx`
- `e2e/tests/parent-capture.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/upload-allowance.ts` — one pure function, `uploadAllowanceLeft(reading: AllowanceReading): number | null`, returning `null` on `limit === null` and `Math.max(0, limit - used)` otherwise. Pure and separate so the only arithmetic this story performs on an API figure is assertable without a DOM tier, and so "unlimited has no remainder" is one decision in one place.
- `apps/web/src/lib/upload-allowance.spec.ts` — `limit: null` → `null`; mid-period (`used: 1, limit: 5`) → `4`; exactly spent (`used: 5, limit: 5`) → `0`; over-spent (`used: 7, limit: 5`) → `0`, never negative; `used: 0, limit: 1` → `1`.
- `apps/web/src/copy/parent.ts` — add a module-level `UPLOAD_ALLOWANCE_TERM = 'Upload Allowance'` beside `GRADE_LABELS`, and spell both `settings.uploadAllowance` and the new capture strings from it, so Settings and the Check step cannot drift. In `capture.legibility`, add `allowanceLeft(left: number, limit: number, date: string)` ("Upload Allowance: 4 of 5 left this month. Resets <date>.") and `allowanceUnlimited` ("Your Upload Allowance is unlimited."). Reword, with the reason in the doc comment: `legibility.advisory` (no "block"), `legibility.cost` (no "commits" — it must still state both halves of FR-31: this upload is saved, one upload of the Upload Allowance is used), `legibility.committing` (no "Committing"), `capture.submitBlocked`'s three singular and one list form (no "submitting"), `capture.submitted`, `capture.submittedNote`, `capture.submitFailed`. Keep `legibility.noCost`, `legibility.checking`, `legibility.checked`, `legibility.failed`, `capture.submit`, `capture.submitting`, `legibility.continueWith` and every `steps.*` label as they are — they are already everyday words.
- `apps/web/src/app/parent/capture/page.tsx` — add `const [uploadAllowance, setUploadAllowance] = useState<AccountConsumption | null>(null)` with its own `allowanceRequestId`/`allowanceCurrent` pair, and one `useEffect` that reads `parentApi.allowances(token)` whenever the Check step is shown, keyed on `[token, step, sourceTest?.id, sourceTest?.status, leave]` so the Draft → Submitted transition re-reads instead of the screen decrementing anything. Resolve sets the payload; reject routes `endsParentView` to `leave()` and otherwise `setUploadAllowance(null)` and nothing else — no `setError`. Render one `Typography` with `data-testid="legibility-allowance"` in both Check-step cards: above `legibility-cost` in the draft card and beside the verdict in the committed card, stating `allowanceUnlimited` when `uploadAllowanceLeft(...) === null` and otherwise `allowanceLeft(left, limit, dateOnly(resetAt, timezone))`, and rendering nothing at all when `uploadAllowance === null`.
- `apps/web/src/app/parent/capture/page.spec.tsx` — replace the superseded `'states no figure…'` test with its opposite: the figure is stated, it comes from the payload (`PAGE_SOURCE` contains `parentApi.allowances(`, `uploadAllowanceLeft(`, `dateOnly(`), and the screen holds no limit, tier or date literal. Add: the read is guarded by `applyIfCurrent` and its own counter; its rejection path contains `leave()` but not `setError`; the line renders only when the payload is non-null; the re-read is keyed on the upload's status rather than computed from a previous figure (`PAGE_SOURCE` contains no `- 1` against an allowance); the allowance line precedes `legibility-cost` and `legibility-continue` in source order; the continue control's `disabled` expression still mentions neither the allowance nor `flagged`. Re-assert every reworded string against its new text, and add one test asserting that the JSON of `capture.legibility`, plus `capture.submitBlocked`'s four forms, `capture.submitted`, `capture.submittedNote` and `capture.submitFailed`, match none of `/commit/i`, `/\bblock/i`, `/submitt?/i`.
- `e2e/tests/parent-capture.spec.ts` — update the quoted sentences at `:365`, `:439-448`, `:511-514`, `:543` to the new wording, and add a flow asserting `legibility-allowance` is visible on the Check step with the account's figure before the continue, and visible again (re-read) with the used figure after Back to Check following a commit.

**Acceptance Criteria:**
- Given the Check step on a limited plan, when the step renders, then one line states how much Upload Allowance is left and when it resets, every figure in it originates in `GET /parent/allowances`, and it is read before the cost sentence and the continue control.
- Given any parent-facing string a Check-step render path reaches, when it is read, then it contains no form of "commit", "block" or "submit", and each sentence says what happens to the parent.
- Given an account with nothing left, when the parent continues anyway, then the control was never disabled by this screen and the refusal shown is the API's own sentence.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 1: (high 0, medium 0, low 1)
- reject: 11: (high 0, medium 2, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The e2e allowance-line regex required a 3-letter month, which `Intl` en-GB renders as `Sept` for September — the helper now matches the two figures alone and restates no date shape.
  - `[medium]` `[patch]` The three-state allowance-sentence derivation lived in the component, where a DOM-less unit suite could only grep its source; moved to `uploadAllowanceLine` in `lib/upload-allowance.ts` and unit-tested on real outputs, including the unlimited arm and the account-zone date.
  - `[medium]` `[patch]` No test ever failed the allowances read; added an e2e case routing it to a 500 and asserting the line is absent while the cost sentences, the continue control and the commit all still work, with no error alert.
  - `[low]` `[patch]` Collapsed the derivation's duplicate null guards (the payload check and the limit check each said the same thing twice).
  - `[low]` `[patch]` The allowance `Typography` and its testid were duplicated in both Check-step cards; one `allowanceNote` node is now rendered in both.
  - `[low]` `[patch]` The e2e asserted a pristine fixture (`left === limit`) and read the post-commit figure with one `textContent()`; now asserts `left > 0` and waits on the decremented figure.
  - `[low]` `[patch]` The new copy said "carry on", a verb on no control; reworded to continue/continuing, matching the step's own buttons.
  - `[low]` `[patch]` Two brittle source-text assertions (a slice that ran past the derivation to the next blank line, and an exact dependency-array string) replaced with scoped rules and order-independent dependency membership.

### 2026-10-12 — Review pass (2)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1: (high 0, medium 0, low 1)
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - none

## Design Notes

The re-read is keyed on the Source Test's `status` rather than hung off `submit()`'s success handler on purpose: `write()` is the one mutation path and five other callers share it, so a special case inside it for one write's side effect is the kind of coupling the generate screen avoided by keying its re-read on `jobSettled`. Keying on status also fixes the resumed-session case for free — a parent who returns to a committed upload and presses Back to Check gets a figure read now, not one carried from before.

Expected shape of the new copy (wording is the implementer's, the constraints are not):

```ts
allowanceLeft: (left: number, limit: number, date: string) =>
  `${UPLOAD_ALLOWANCE_TERM}: ${left} of ${limit} left this month. Resets ${date}.`,
allowanceUnlimited: `Your ${UPLOAD_ALLOWANCE_TERM} is unlimited.`,
```

## Verification

**Commands:**
- `pnpm --filter web run test` -- expected: the new `upload-allowance.spec.ts` passes and `page.spec.tsx` passes with every reworded string re-asserted, not dropped.
- `pnpm typecheck` -- expected: clean in both workspaces.
- `pnpm exec eslint` on each touched file -- expected: clean. (The `pnpm --filter web run lint` wrapper reports a pre-existing workspace-wide parsing error unrelated to this story.)
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- expected: every pre-existing flow passes against the new wording, plus the new allowance-line case.
- `grep -nEi '(commit|block|submitt?)' ` over the `capture.legibility` block and the Check-step strings in `apps/web/src/copy/parent.ts` -- expected: no parent-facing hit (doc comments may still name the mechanism).

## Auto Run Result

Summary: reworded every parent-facing string the Check step renders into plain language (submit/commit/block vocabulary removed) and added one allowance-left line, read from `GET /parent/allowances`, above the continue control — degraded to nothing on failure, re-read (never decremented) after a commit. Implemented and reviewed across two review passes.

Files changed:
- `apps/web/src/lib/upload-allowance.ts` (new) — `uploadAllowanceLeft`/`uploadAllowanceLine` pure helpers.
- `apps/web/src/lib/upload-allowance.spec.ts` (new) — unit coverage for both helpers.
- `apps/web/src/copy/parent.ts` — reworded Check-step strings, added `UPLOAD_ALLOWANCE_TERM`, `allowanceLeft`, `allowanceUnlimited`.
- `apps/web/src/app/parent/capture/page.tsx` — sixth guarded read (allowance), shared `allowanceNote` rendered in both Check-step cards.
- `apps/web/src/app/parent/capture/page.spec.tsx` — re-asserted every reworded string; added coverage for the new read's guard, render order, and no-gating behavior.
- `e2e/tests/parent-capture.spec.ts` — reworded quoted sentences; added the allowance-line flow and a degraded-read (500) case.

Review findings breakdown:
- Pass 1 (2026-10-12): patch 8 (medium 3, low 5) — all applied; defer 1 (low); reject 11.
- Pass 2 (2026-10-12): patch 0; defer 1 (low) — pre-existing, screen-wide gap where none of this screen's six request-counter reads has a behavioral test for the `endsParentView → leave()` branch, only source-text assertions; not caused by this story. reject 15 — stale-figure-on-dependency-change and unmount-cleanup findings checked against the actual effect dependencies/architecture and found unreachable or consistent with the four other non-polling streams' existing pattern; remaining findings were style nitpicks, out-of-scope asks (cross-screen copy audits, a second `role="status"`-adjacent announcement) or already covered by this story's own deliberate design choices.

Verification: no code changed in pass 2, so pass 1's verification stands (`pnpm --filter web run test`, `pnpm typecheck`, `pnpm exec eslint`, `pnpm exec playwright test e2e/tests/parent-capture.spec.ts`, and the plain-language `grep` all passing per the pass 1 implementation). No re-run was necessary.

Residual risks: the deferred verification gap above (screen-wide, pre-existing); the pre-existing deferred item from pass 1 (the API's own refusal sentence for an unchecked submission still reads "Check the pages before submitting.").
