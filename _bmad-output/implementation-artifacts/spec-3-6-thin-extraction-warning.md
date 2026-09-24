---
title: 'Story 3.6 — Thin-Extraction Warning'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: '68c702b02093214de64244dade88bce33a0da29f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The web unit tier runs in a node environment with no DOM library, so the
      capture screen's interactive behavior is asserted by grepping its own
      source text rather than by running it.
    evidence: |-
      apps/web/vitest.config.ts sets environment: 'node' and the workspace has
      no jsdom or testing-library dependency, so page.spec.tsx can only render
      presentational components with renderToStaticMarkup and otherwise match
      literals against PAGE_SOURCE. That predates this story — the same idiom
      covers Stories 3.2 and 3.3 — but it now also carries this story's gate,
      poll, retry and dismissal wiring, each of which a behavior-preserving
      refactor breaks and a behavior regression can slip past. Closing it means
      adding a DOM tier to apps/web, which is an architectural change no single
      story should make unannounced.
    location: >-
      apps/web/vitest.config.ts
    severity: medium
  - summary: >-
      The healthy (non-thin) proceed path is never exercised in a browser,
      because Playwright starts the API once with one environment.
    evidence: |-
      The thin verdict is covered end to end, and the healthy one is covered at
      the pure-rule tier (extraction-status.spec.ts) and the API tier
      (extraction.int-spec.ts, via AI_FAKE_QUESTIONS_PER_PAGE). Nothing clicks
      proceed on a succeeded, non-thin Extraction in a real page and asserts no
      dialog opens. Closing it needs a second Playwright project running the API
      under a raised AI_FAKE_QUESTIONS_PER_PAGE, which is a test-infrastructure
      change rather than a fix to this diff.
    location: >-
      playwright.config.ts
    severity: medium
  - summary: >-
      The API integration suite carries a pre-existing intermittent failure
      under full-suite parallelism, unrelated to this story.
    evidence: |-
      One `pnpm --filter api run test:int` run in this session failed a single
      case; the immediately following run passed 343/343, and
      extraction.int-spec.ts passes in isolation on every run. Reproduced on a
      clean tree with every Story 3.6 change stashed, where parent-auth.int-spec.ts
      failed instead — the failing file moves between runs and the message is
      typically "No elevation token in the response body", which is cross-file
      contention on the one shared Postgres. Already logged against Story 3.5.
    location: >-
      apps/api/test/harness.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 3.5 persists an Extraction and reports `usableQuestionCount` and `pageCount`, but nothing decides whether that pair is *thin*, and no parent-facing surface exists between a committed Source Test and generation — so a parent whose three photographed pages yielded two usable questions learns nothing until a Practice Test comes back thin, by which point a Generation Allowance is already spent.

**Approach:** Add the thin verdict as a single deterministic rule in `extraction` (usable questions per submitted page, one env-overridable figure, computed server-side and surfaced as `thin` on the existing status read), and add a Generate step to the parent capture surface that reads that status after submit and, when the parent proceeds toward generation over a thin Extraction, warns with both counts and offers proceed or retake pages — never hard-blocking, and stating that retaking costs no Generation Allowance.

## Boundaries & Constraints

**Always:**
- **The thin rule is stated once, in `extraction-policy.ts`**, as a pure function over the two counts and one figure, read through `extractionRuntime()` like every other figure that module owns. The web app never computes it, never holds the threshold, and never renders a count it was not handed — the same rule `AuthPolicy` and `SourceTestView.maxPages` already follow.
- **The verdict rides the existing status read.** `GET /parent/source-tests/:id/extraction` gains `thin`; no new route, no new module, and still not one word of extracted content in the body (AD-3). `thin` is `null` whenever the counts are `null` — an unfinished job has no verdict, and `false` would assert one.
- **The warning never hard-blocks.** Proceed is always available and always advances. A genuinely short quiz is valid, so an over-eager warning is the accepted trade.
- **The warning states both counts and the no-charge guarantee.** The usable-question count, the page count, and the sentence that retaking pages consumes no Generation Allowance — FR-9a's three load-bearing facts, all three in the warning.
- **Retake is honest about what it does:** a Submitted Source Test is terminal, so retake opens a fresh draft for the same child (`POST /parent/source-tests`, which already opens-or-resumes) and returns the parent to page capture. The copy says a new upload is being started rather than implying the old pages come back.
- Every new user-facing string lives in `apps/web/src/copy/parent.ts` (AD-32). Every state change worth noticing is announced through the one `useAnnounce` region, in the words displayed.
- Parent-tier tap targets, a real focusable control per action, visible focus; the warning is a dialog built on `AppDialog` (UX-DR27), not a bespoke overlay.

**Block If:**
- The thin rule would have to hard-block generation, or the counts would have to be withheld from the parent — both contradict FR-9a and cannot be decided here.

**Never:**
- Do not build Epic 4's Generate screen: no practice-test count selector, no allowance panels, no generation call, no new route. The Generate step here is the gate and its outcome, nothing more — the same stand-in posture Story 3.2 took toward Story 3.1's viewfinder.
- Do not change how `usable` is computed, what the worker stores, or any allowance accounting. Upload Allowance and Generation Allowance enforcement are Epic 9's.
- Do not surface a question, choice, topic or passage anywhere.
- Do not persist the parent's proceed/retake choice; it is a screen state, not a row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thin verdict, below | `usableQuestionCount = 3`, `pageCount = 3`, threshold `2` | `thin: true` — `3 < 6` | No error expected |
| Thin verdict, at or above | `usableQuestionCount = 6`, `pageCount = 3`, threshold `2` | `thin: false` | No error expected |
| Nothing usable | `usableQuestionCount = 0`, any page count | `thin: true` | No error expected |
| No verdict yet | Job `Queued` or `Running`, counts `null` | `thin: null`, counts `null` | No error expected |
| Failed job | Job `Failed` | `thin: null`; screen shows the job's own `failureReason` | Reason is the stored constant, never a provider string |
| Misconfigured threshold | `EXTRACTION_MIN_USABLE_PER_PAGE=0` or `abc` | Boot refuses | `requireIntEnv` throws, stating the variable |
| Proceed over a thin Extraction | Parent presses proceed, `thin: true` | Warning appears with both counts and the no-charge sentence | No error expected |
| Continue anyway | Warning open, parent continues | Warning closes, the generate step is reached; nothing is charged here | No error expected |
| Retake pages | Warning open, parent retakes | A fresh Draft is opened for the same child and the capture strip is back, empty | A failed open shows the screen's error with Retry |
| Proceed over a healthy Extraction | Parent presses proceed, `thin: false` | The generate step is reached with no warning at all | No error expected |
| Status read while polling | Job `Queued`, then `Succeeded` | The screen advances from reading to the outcome without a reload | A failed poll shows the error and stops polling; Retry re-issues |
| Draft Source Test | Status read before submit | 404 | Screen shows no Generate step while the upload is a Draft |

</intent-contract>

## Code Map

**Read-only anchors (patterns to follow, do not change):**
- `apps/api/src/extraction/extraction-policy.ts` — the four-section layout (constants, `// --- Messages ---`, `// --- Runtime ---` with the memoised `extractionRuntime()` / `resetExtractionRuntime()` pair, rules). `DEFAULT_CLAIM_TIMEOUT_MS`/`DEFAULT_POLL_MS` show how a default figure is declared; the `claimTimeoutMs` vs `worstCaseRunMs` boot check shows how a figure is validated at boot rather than discovered later. The new threshold and the new pure rule go in this file.
- `apps/api/src/extraction/extraction.service.ts:89-101` — `ExtractionStatusView`, the shape `thin` joins; `:300-363` `statusFor`, whose one transaction already reads `pageCount` and `usableQuestionCount` and is the only place the verdict may be computed.
- `apps/api/src/extraction/extraction.controller.ts` — the single `@Get(':id/extraction')`; unchanged, it just returns the wider view.
- `apps/api/src/extraction/extraction-schema.ts:112-171` — `fakeExtractionPayload`: one usable question per page plus exactly one unusable question on the last page. This is why the fake is thin under the default threshold, and where the density seam goes.
- `apps/api/src/common/env.ts:31-43` — `requireIntEnv` already refuses zero, a negative and a non-number; the threshold is read through it and nowhere else.
- `apps/api/src/ai/ai-config.ts` `fakeFailureFrom` / `AI_FAKE_FAILURE` — the shape a per-call fake knob takes; `AI_FAKE_QUESTIONS_PER_PAGE` mirrors it.
- `apps/api/test/harness.ts:124-141` (TRUNCATE lists), `captureAi`, and the `extractionRunner.runOnce()` handle — the integration seams; no new seam is needed.
- `apps/api/test/extraction.int-spec.ts` — the submit → `runOnce()` → read-back idiom every new integration case reuses.
- `apps/web/src/app/parent/capture/page.tsx:1-120` — the request-id-per-stream guard (`applyIfCurrent`, a counter and a live ref per stream); `:285-310` the `write()` helper that locks the strip, announces from the server's answer and routes `endsParentView` to `leave()`; `:432-470` the error `Alert` with `retry`. The extraction poll gets its own counter and its own live ref, exactly like the other four streams.
- `apps/web/src/app/parent/capture/PageStrip.tsx` — the precedent for splitting a presentational piece out of the screen so it is assertable on rendered markup; `ThinExtractionWarning` follows it.
- `apps/web/src/components/Dialog.tsx:29-38` — `AppDialog`: `open`, `title`, `onClose`, `children`, `actions`. The warning is an `AppDialog` with two plain `Button`s, not a `DestructiveConfirmDialog` (nothing is destroyed and no password is asked for).
- `apps/web/src/lib/page-order.ts` + `page-order.spec.ts`, `apps/web/src/lib/classification.ts` — the pure-helper-plus-spec pattern the new `extraction-status.ts` follows.
- `apps/web/src/lib/parent-api.ts:475-560` — the `parentApi` Source Test block and the `elevated(token)` header helper; `SourceTestView` is the shape `ExtractionStatusView` sits beside.
- `apps/web/src/copy/parent.ts:204-300` — the `capture` copy block, including `classification` as a nested namespace. `generate` is a sibling namespace.
- `apps/web/src/app/parent/capture/page.spec.tsx:1-56` — the SSR `renderToStaticMarkup` idiom plus `PAGE_SOURCE` source-text assertions for rules the screen states rather than renders.
- `e2e/tests/parent-capture.spec.ts:353-500` — the direct-to-API case and `pollExtraction`; the new browser-driven case sits beside it.

**Files to create:**
- `apps/web/src/app/parent/capture/ThinExtractionWarning.tsx`
- `apps/web/src/lib/extraction-status.ts`, `apps/web/src/lib/extraction-status.spec.ts`

**Files to change:**
- `apps/api/src/extraction/extraction-policy.ts`, `extraction-policy.spec.ts`, `extraction.service.ts`, `extraction-schema.ts`
- `apps/api/test/extraction.int-spec.ts`
- `apps/web/src/lib/parent-api.ts`, `apps/web/src/copy/parent.ts`
- `apps/web/src/app/parent/capture/page.tsx`, `page.spec.tsx`
- `e2e/tests/parent-capture.spec.ts`
- `.env.example`

## Tasks & Acceptance

**Execution:**
- `apps/api/src/extraction/extraction-policy.ts` — add `DEFAULT_MIN_USABLE_QUESTIONS_PER_PAGE = 2` with a doc comment saying why two (a school-test page that yielded fewer than two usable questions has more likely been misread than been that short, and the warning never blocks, so erring toward warning is the cheap direction); add `minUsableQuestionsPerPage` to `ExtractionRuntime`, read in `extractionRuntime()` through `requireIntEnv('EXTRACTION_MIN_USABLE_PER_PAGE', …)` so a zero or a typo refuses the boot; and add the pure `isThinExtraction(usableQuestionCount, pageCount, minPerPage)` returning `usableQuestionCount < pageCount * minPerPage`. One rule, one file — the same reason `claimTimeoutMs` lives here.
- `apps/api/src/extraction/extraction-policy.spec.ts` — cover `isThinExtraction` at, below and above the line, at zero usable, and at a one-page upload; cover the runtime read (default, an override, a zero, a non-number) with `resetExtractionRuntime()` between cases as the existing runtime tests do.
- `apps/api/src/extraction/extraction.service.ts` — add `thin: boolean | null` to `ExtractionStatusView` with a doc comment saying `null` means no verdict yet, and compute it in `statusFor` from the counts it already reads, through `isThinExtraction` — never inline arithmetic, so the rule has exactly one definition.
- `apps/api/src/extraction/extraction-schema.ts` — make `fakeExtractionPayload` emit `AI_FAKE_QUESTIONS_PER_PAGE` usable questions per page, read through `requireIntEnv` in this file — not in `ai-config.ts`, because the fake's *payload shape* is the domain module's under the AD-17 carve-out that already keeps the prompt here, while `ai-config.ts` owns only transport-level knobs — with a default of **1** so every existing assertion holds unchanged, and keep the single unusable last-page question exactly as it is. This is the seam that makes both sides of the verdict drivable at the integration and E2E tiers; without it the fake is thin under every threshold and the healthy branch is untestable end to end.
- `apps/api/test/extraction.int-spec.ts` — add: a two-page submit under the default fake reporting `thin: true` with `usableQuestionCount` and `pageCount` stated; the same submit with `AI_FAKE_QUESTIONS_PER_PAGE` raised reporting `thin: false`; and `thin: null` on a `Queued` job and on a `Failed` one. Assert the body still carries no question text.
- `.env.example` — add `EXTRACTION_MIN_USABLE_PER_PAGE` to the existing `# --- Extraction jobs (Epic 3, Story 3.5) ---` group and `AI_FAKE_QUESTIONS_PER_PAGE` to the `# --- AI provider ---` group, each with the prose comment saying what refuses to boot on a bad value, matching the group's existing entries.
- `apps/web/src/lib/parent-api.ts` — add the `ExtractionStatusView` interface mirroring the API's (status, the four counts, `thin`, `completedAt`, `failureKind`, `failureReason`, `retryable`) and `extraction: (token, id) => call<ExtractionStatusView>(…)` in the Source Tests block behind `elevated(token)`, with `parentCopy.capture.generate.readFailed` as its fallback message.
- `apps/web/src/lib/extraction-status.ts` + `extraction-status.spec.ts` — the pure parts: `isSettled(status)` (`Succeeded` or `Failed`), `EXTRACTION_POLL_MS`, and `warningNeeded(view)` returning whether a proceed must be gated (`status === 'Succeeded' && thin === true`). Pure so the gate is assertable without mounting the screen, and so `thin === null` cannot accidentally read as thin.
- `apps/web/src/copy/parent.ts` — add a `capture.generate` namespace: the step heading; `reading` while the job is `Queued`/`Running`; `readFailed`; `proceed`; the warning's `title`, its `counts(usable, pages)` sentence naming both figures in plain words with correct singular/plural, its `noGenerationCharge` sentence, `continueAnyway` and `retakePages`; the `retakeStarted` announcement saying a new upload was started and the pages must be added again; and the reached-generate-step sentence stating this upload is ready and practice-test generation is the next step. Complete sentences, no error codes, no apology, third person about the student.
- `apps/web/src/app/parent/capture/ThinExtractionWarning.tsx` — a presentational `AppDialog` taking `open`, `usableQuestionCount`, `pageCount`, `busy`, `onContinue`, `onRetake`. It renders the counts sentence, the no-Generation-Allowance sentence and the two controls; it holds no state, makes no request, and decides nothing about whether it should be open. Split out for the same reason `PageStrip` is: the copy and the two controls are then assertable on rendered markup.
- `apps/web/src/app/parent/capture/page.tsx` — add the Generate step, rendered only while `sourceTest !== null && !isDraft`: on entering that state, read the extraction status and poll it every `EXTRACTION_POLL_MS` until `isSettled`, guarded by its own request counter and live ref like the other four streams, cleared on unmount and on leaving the state; render the reading state, the failure's own `failureReason`, or the outcome with a proceed control; pressing proceed opens `ThinExtractionWarning` when `warningNeeded`, otherwise reaches the generate step directly; continue-anyway reaches it too; retake calls `openDraft()` to open a fresh draft, resets the step state and announces `retakeStarted`. Route `endsParentView` to `leave()` on the poll exactly as every other call does.
- `apps/web/src/app/parent/capture/page.spec.tsx` — add markup assertions for `ThinExtractionWarning` (both counts present, the no-charge sentence present, both controls focusable and named, the dialog labelled by its title) and source-text assertions for the rules the screen states: the poll is cleared, proceed is never disabled by the verdict, and the warning is gated on `warningNeeded` rather than on `thin` directly.
- `e2e/tests/parent-capture.spec.ts` — add a browser-driven case: elevate, open a draft, add two pages, classify, submit, wait for the Generate step to report the outcome, press proceed, assert the warning names both counts and the no-charge sentence, press retake, and assert the capture strip is back and empty. Then repeat the proceed path with continue-anyway and assert the generate step is reached. The default fake is thin, so this case exercises the warning without any env manipulation.

**Acceptance Criteria:**
- Given an Extraction whose usable-question count is low for the pages submitted, when the parent proceeds toward generation, then they are shown the usable-question count and the page count together with a choice to proceed or to retake pages.
- Given that warning, when the parent reads it, then it states that retaking pages consumes no Generation Allowance, and the proceed choice is available and never refused — the warning informs, it does not block.
- Given a parent who chooses to retake, when the choice is made, then no generation has been started and nothing has been charged, and the parent is returned to page capture on a fresh upload for the same child.
- Given an Extraction with enough usable questions for the pages submitted, when the parent proceeds toward generation, then no warning appears at all.
- Given the thin rule, when it is evaluated anywhere, then it is the same single server-side rule and one configured figure — the web app holds no threshold and renders no count it was not handed.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 21: (high 0, medium 0, low 21)
- addressed_findings:
  - none

Notes: four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) ran against the full diff since baseline. Every finding rejected on verification: an apparent object-literal truncation in `parent-api.ts` was a diff-hunk misread (file reads and typechecks correctly, `reorderSourceTestPages` and siblings all present); a claimed regression in the fake's prompt text for `perPage === 1` was checked against the whole repo and no test asserts the old literal; the `warningCounts === null` branch `proceedToGenerate` was flagged over is unreachable because `thin` is only ever non-null when both counts are (`extraction.service.ts`); several findings (default dev config always thin, large-threshold footgun, a warning re-open after dismissal) are the intentional tradeoffs the spec's own Design Notes and `.env.example` comments already call out; a few (no poll timeout, no busy-state spinner, focus-trap behavior, prod-gating of `AI_FAKE_QUESTIONS_PER_PAGE`) reuse a pre-existing pattern already present for the screen's other four polls/dialogs and are not something this story introduced; and the remaining verification-gap findings (Retry not re-issuing the Extraction poll, the healthy non-thin path, and Escape/scrim dismissal all being verified only by source-text assertions rather than a running interaction) restate, at finer grain, the same gap the spec's frontmatter `deferred` list already carries under the first and second entries — closing it is the DOM-tier / second-Playwright-project infrastructure change already deferred there, not new work for this pass.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 4, low 6)
- defer: 3: (high 0, medium 3, low 0)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` The failed-Extraction state rendered as a bare paragraph, so a screen reader was never told the reading had failed and the one sentence a parent gets in that state went unannounced. It is now an `Alert severity="error" role="alert"`, still carrying the job's own stored reason rather than a generic one.
  - `[medium]` `[patch]` `onClose={onContinue}` made an accidental Escape or scrim tap advance the flow and announce "This upload is ready" — dismissal silently becoming consent, where every other dialog in the app treats it as cancel. A separate `onDismiss` now just closes the warning and leaves the parent on the proceed control.
  - `[medium]` `[patch]` `retakePages()` announced "A new upload was started" before `openDraft()` had resolved, so a failed open left the live region asserting a retake that had not happened beside an error saying it had not. `openDraft` gained an `onOpened` callback and the announcement fires only from the success branch.
  - `[medium]` `[patch]` Nothing proved the endpoint threads the configured threshold rather than the default constant: substituting `DEFAULT_MIN_USABLE_QUESTIONS_PER_PAGE` for `minUsableQuestionsPerPage()` in `statusFor` kept every test green, which would have made the documented operator knob silently inert. An integration case now reads the same succeeded Extraction under a stubbed `EXTRACTION_MIN_USABLE_PER_PAGE` and asserts the opposite verdict for identical counts.
  - `[low]` `[patch]` `isThinExtraction` returned `false` for a zero page count (`0 < 0`), declaring the emptiest possible read healthy. A non-positive page count is now thin, with covering cases.
  - `[low]` `[patch]` `usableQuestionCount={extraction?.usableQuestionCount ?? 0}` laundered a `null` into a displayed figure, so the warning could in principle have stated "0 usable questions were found across 0 pages." The counts are narrowed once and the dialog mounts only when both are present; the defaults are gone.
  - `[low]` `[patch]` The hand-maintained `parent-api.spec.ts` assertion that the elevation bearer is attached to the parent-scoped calls and to those only had not been extended with `parentApi.extraction`.
  - `[low]` `[patch]` The new integration cases asserted `usableQuestionCount` without the matching `questionCount`, leaving the usable-versus-total distinction the whole rule rests on unchecked exactly where the new per-page loop meets the fake's single dependent question. Both counts are asserted in both cases.
  - `[low]` `[patch]` A hand-rolled `process.env` save/restore around `AI_FAKE_QUESTIONS_PER_PAGE` leaked on a throw and invited copy-paste; replaced with `vi.stubEnv` plus `vi.unstubAllEnvs()` and `resetExtractionRuntime()` in an `afterEach`.
  - `[low]` `[patch]` `.env.example` stated that a zero or non-numeric `AI_FAKE_QUESTIONS_PER_PAGE` refuses the call and nothing tested either refusal; four cases now cover the default, a stated density, and both refusals.

## Design Notes

**Why the verdict is server-side.** The two counts already cross the wire, so a client-side comparison would work — and would put the product's definition of "thin" in a browser bundle, where Epic 4's generate step and any later surface would each need their own copy of it. The codebase's standing rule is that no figure is a literal in the web app (`AuthPolicy`, `SourceTestView.maxPages`); the threshold is a figure, so it stays where the rule is.

**Why `thin` is nullable.** `false` on a `Queued` job would be a verdict about an Extraction that does not exist yet, and a screen reading it would show "no warning needed" before anything had been read. `null` says there is nothing to say, which is the truth and which `warningNeeded` refuses to treat as healthy.

**Why the Generate step is a stand-in.** Epic 4 owns the Generate screen — the count selector, the allowance panels, the generation call. This story owns the gate that fires on the way into it. Building the gate needs somewhere for it to fire, so the step exists and its content is the Extraction's outcome plus a sentence saying generation is next. Story 3.2 took the same posture toward the camera it did not own, and the file-input stand-in it shipped is still the reason everything below it is exercisable.

**Why retake opens a new draft rather than reopening the old one.** Submit is terminal by design (AD-16): every write against a Submitted Source Test answers 409, and the Extraction is deliberately built to outlive it. "Retake pages" therefore cannot mean "edit that upload" — it means photograph the test again, which is a new Source Test. The copy says so rather than implying the previous pages return.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors in either workspace.
- `pnpm --filter api run test` -- expected: the extended `extraction-policy.spec.ts` passes with the rest.
- `pnpm --filter web run test` -- expected: `extraction-status.spec.ts` and the extended `page.spec.tsx` pass.
- `pnpm --filter api run test:int` -- expected: `extraction.int-spec.ts` passes against real Postgres, including both sides of the verdict and both no-verdict states, with every pre-existing case unchanged.
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- expected: passes, including the new browser-driven warning case.
- `pnpm exec eslint` on every touched file -- expected: clean. (The `pnpm --filter api run lint` wrapper reports a pre-existing workspace-wide parsing error unrelated to this story; invoke `eslint` directly on the touched files.)

## Auto Run Result

**Summary:** Follow-up review pass only — no code changes. The story's implementation (thin-verdict rule in `extraction-policy.ts`, `thin` on the Extraction status read, the Generate step and `ThinExtractionWarning` dialog on the parent capture screen, retake-opens-fresh-draft) was already complete and committed (`29c3442`) from the prior pass. This pass re-reviewed the full diff since baseline (`68c702b`) with four fresh review layers and found nothing warranting a change.

**Files changed:** none this pass. (Prior pass touched `.env.example`, `apps/api/src/extraction/{extraction-policy,extraction-schema,extraction.service}.ts` + specs, `apps/api/test/extraction.int-spec.ts`, `apps/web/src/app/parent/capture/{ThinExtractionWarning.tsx,page.tsx,page.spec.tsx}`, `apps/web/src/copy/parent.ts`, `apps/web/src/lib/{extraction-status.ts,extraction-status.spec.ts,parent-api.ts,parent-api.spec.ts}`, `e2e/tests/parent-capture.spec.ts`.)

**Review findings breakdown:** 21 findings across blind-hunter, edge-case-hunter, verification-gap, and intent-alignment layers — 0 patch, 0 deferred (new), 21 rejected. Rejections broke down as: 3 false positives verified and disproven (a diff-hunk misread of `parent-api.ts` that isn't a real truncation; an unreachable `warningCounts === null` branch; a claimed prompt-text regression with no test asserting the old literal anywhere in the repo); several intentional, spec-documented tradeoffs (default dev config reads as thin by design, the large-threshold "always warns" direction, `false` never displacing `null`); several pre-existing patterns this story only extended rather than introduced (no poll timeout, `busy` scoped to the whole pending-write flag rather than just retake, focus-trap behavior inherited from `AppDialog`, `AI_FAKE_QUESTIONS_PER_PAGE` not prod-gated the same as `AI_FAKE_FAILURE` already isn't); and three verification-gap findings (Retry not re-issuing the Extraction poll, the healthy/non-thin path, and Escape/scrim dismissal all verified only by source-text assertions, not a running interaction) that restate — at finer grain — the DOM-tier gap already recorded as this spec's first deferred item, and the second deferred item already covers the healthy-path case specifically.

**Follow-up review recommendation:** `false` — 0 patched findings this pass (score 0).

**Verification performed:** `pnpm typecheck` re-run clean (cache hit, both workspaces). No source changed this pass, so the full test/lint/e2e suite from the prior pass's `## Verification` section was not re-run; its results stand as recorded there.

**Residual risks:** none newly identified. The three items already in this spec's `deferred` frontmatter (DOM-tier gap for the capture screen's interactive behavior, the healthy-path e2e gap, the intermittent API-integration flake under parallelism) remain open and are unchanged by this pass.

