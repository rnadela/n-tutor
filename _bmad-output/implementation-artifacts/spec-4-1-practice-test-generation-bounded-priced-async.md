---
title: 'Story 4.1: Practice Test Generation (bounded, priced, async)'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: '7af2f63c78d0cd9055d32e35f55ff28ea0493a9e'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Two concurrent generation requests for one account can each clamp against the same
      remaining allowance and overspend the tier limit.
    evidence: |-
      `PracticeTestService.request` counts only `PracticeTest` rows that already carry
      `chargedAt`; a Queued or Running job has none, and nothing counts the outstanding
      `requestedCount` of unsettled jobs. Two tabs or a double-click on an account with 2
      remaining both enqueue 2 and 4 drafts land charged. The intent explicitly defers the
      hard block at cap to Epic 9, so this is out of this story's scope.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (request)
    severity: medium
  - summary: >-
      The Generation Allowance window query exists twice, in two modules, with the
      half-open-window rule restated in prose in three places.
    evidence: |-
      `ARTIFACT_COUNTERS.generation` in `allowance.service.ts` and the in-transaction count in
      `PracticeTestService.request` are the same query written twice; a change to the window
      semantics has to land in both or usage and clamping disagree.
    location: >-
      apps/api/src/allowance/allowance.service.ts
    severity: low
  - summary: >-
      The integration tier fails roughly one run in two with a parent account vanishing
      mid-test, in a different untouched file each time.
    evidence: |-
      Reproduced on a stashed baseline (run 1 failed in parent-pin.int-spec.ts, run 2 passed),
      the same rate and signature as this branch. Pre-existing cross-file isolation or
      truncation race in the integration harness, not caused by this story, but it makes CI
      noisy.
    location: >-
      apps/api/test/harness.ts
    severity: medium
  - summary: >-
      Two parent-auth password-reset E2E tests fail on a strict-mode locator violation.
    evidence: |-
      `getByRole('status')` resolves to both the MUI success alert and the empty live region,
      so `toContainText('password is saved')` fails. Confirmed failing identically on a clean
      stash of this branch, so it predates this story.
    location: >-
      e2e/tests/parent-auth.spec.ts:105
    severity: medium
  - summary: >-
      A parent (or a double-submitted request, e.g. two tabs) can enqueue a second
      GenerationJob for the same Source Test while one is already Queued or Running.
    evidence: |-
      `PracticeTestService.request` never checks for an existing unsettled job before
      inserting a new one. `statusFor` only ever surfaces the newest job by `createdAt`,
      so the older job keeps running and keeps spending the allowance with no UI surface
      showing it. The normal single-page UI flow (picker replaced by progress view once a
      job starts) makes this unreachable through ordinary use; it needs a second tab or a
      direct API call. Out of this story's scope for the same reason concurrent-request
      overspend is: the intent explicitly defers a hard block at cap to Epic 9.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (request, statusFor)
    severity: low
  - summary: >-
      A charge can land in a period window different from the one `request()` clamped
      against, if the period rolls over while a job is mid-run; nothing re-verifies the
      account is still within its limit at land time, only that the charge's instant falls
      inside the freshly re-read window.
    evidence: |-
      `land()` re-reads `allowance.windowFor` per draft and rejects only a clock/zone
      anomaly (the instant falling outside its own just-computed window); it never
      re-clamps against `remainingFor(used, limit)`. A job that spans a period boundary can
      therefore land a draft the new period's limit would have refused. Same category as
      the already-recorded concurrent-request overspend risk, and out of scope for the same
      reason: the intent explicitly defers hard-block-at-cap enforcement to Epic 9.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (land)
    severity: medium
  - summary: >-
      The I/O matrix's "Partial success" and "Total failure" rows are proven at the backend
      (real job, real DB) and the frontend (real component, mocked API) separately, but
      never joined at the browser-integration surface — no e2e test drives an actual AI
      failure through the real worker and observes the parent-facing screen react to it.
    evidence: |-
      `apps/api/test/practice-test.int-spec.ts` covers partial/total failure against the
      real worker; `apps/web/.../generate/[sourceTestId]/page.spec.tsx` covers the same
      copy against a fabricated `GenerationJobView`. `e2e/tests/parent-practice-test.spec.ts`
      covers only the happy path, leave/return-while-succeeding, and the two allowance-
      boundary cases. A defensible simplification (the e2e harness has no seam to force a
      real AI failure through the fake transport at a controlled point), not a regression.
    location: >-
      e2e/tests/parent-practice-test.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent who has committed a Source Test can get as far as "the reading is done" and no further — nothing turns a persisted Extraction into Practice Tests, no Generation Allowance is ever counted, and `AiService` cannot make a text-only call at all.

**Approach:** Add a `practicetest` module owning Practice Test / Question / Choice / Topic rows and its own DB-backed `GenerationJob` queue, mirroring the extraction job pattern (claim with `FOR UPDATE SKIP LOCKED`, fence every terminal write, self-rescheduling runner). A parent picks 1–5 (clamped server-side against remaining Generation Allowance), sees the cost in Practice Tests before confirming, and the job produces one draft per AI call, committing and charging each as it lands. Extend `AiService` with a text modality, wire the real `ARTIFACT_COUNTERS.generation`, and add a parent-side generate + progress route that survives leaving and returning.

## Boundaries & Constraints

**Always:**
- Generate from the persisted Extraction only — read `ExtractedQuestion` rows where `usable = true`, never page image bytes, never a storage path.
- Server clamps the requested count to `min(5, remaining)` independently of what the client sent; `remaining = limit === null ? 5 : max(0, limit - used)`.
- Cost is stated before confirmation, denominated in Practice Tests, naming both what the action spends and what remains.
- Every generated text field (question prompt, choice body, free-text answer) is `RichText` (`extraction/rich-text.ts`) — a fraction is a `FractionSegment`, never a glyph in a string.
- Each draft lands in its own `withTransaction`: fence the job row (`status: 'Running'`, same `attempts`), re-read the allowance window, insert the Practice Test with `chargedAt` set, assert `count === 1`.
- A landed draft is never rolled back by a later failure of the same job.
- Failure classification follows `extraction.service.ts` `fail()`: `AiInputError`/target-missing → `ClientFault`, not retryable; `AiRejectedError` → `UpstreamFault`, not retryable; everything else → `UpstreamFault`, retryable. `failureReason` is always a policy-file constant, never `cause.message`.
- Logs, errors and cost rows carry identifiers, counts and money only — never a fragment of generated content.
- Every user-facing string comes from `copy/parent.ts`; every figure arrives as a parameter from the API.
- A foreign or unknown id answers 404, never 403.

**Block If:**
- The pinned `Generation` model cannot produce the required shape at all (the fake transport passes but a real call is structurally impossible), since that is a provider/config decision, not an implementation one.
- Landing a draft cannot be made atomic with its charge — if the fence and the derived count cannot both hold in one transaction, stop rather than ship a billing path that can double-charge or charge for nothing.

**Never:**
- No draft review, edit, delete, release, discard or timer UI/endpoints (Stories 4.3–4.6).
- No Attempt/Answer/grading tables (Epic 5). No Topic canonicalization (Epic 7). No hard block at cap (Epic 9) beyond the clamp this story's AC requires.
- No Topic weighting (Story 4.2) — the prompt covers the Extraction's Topics evenly.
- No allowance counter, cost figure, tier label or model name on any student-scoped surface or endpoint.
- Never decrement a counter column; usage stays derived by counting.
- Never widen `AiService` by giving `images` a default — the modality is explicit at both call sites.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bounded pick | Free tier, limit 2, used 0 | Counts 1–2 enabled, 3–5 rendered disabled with the reason stated | No error expected |
| Client overreach | Client POSTs `count: 9`, remaining 2 | Job enqueued with `requestedCount: 2` | Clamped silently server-side; response states the clamped count |
| Unlimited tier | `Internal`, limit `null` | Counts 1–5 all enabled; cost copy says Unlimited remains | No error expected |
| Nothing remaining | limit 2, used 2 | Request refused, reason stated | 409 with policy constant |
| No usable questions | Extraction has 0 `usable` questions | Request refused, Source Test untouched | 409 with policy constant |
| Partial success | 5 requested, AI fails on the 4th after 3 landed | Job `PartiallyComplete`, `producedCount: 3`, 3 charged, 3 drafts persist | Failure reason + `retryable` recorded on the job |
| Total failure | AI fails on the 1st | Job `Failed`, `producedCount: 0`, nothing charged, Source Test still submitted and retryable without re-upload | Reason is a policy constant |
| Malformed payload | MC question whose correct answer is not among its own options | That call is an upstream fault; retried, then the job fails per policy | Caught post-hoc in code, not trusted because it parsed |
| Verbatim copy | Generated prompt equals a source prompt after normalization | Same: upstream fault, retried | Post-hoc reject |
| Leave and return | Parent navigates away mid-job, returns to `/parent/generate/<id>` | Progress read from the server shows current status and counts | Poll stops on error with Retry |

</intent-contract>

## Code Map

**Mirror these (the closest working analogs):**
- `apps/api/src/extraction/extraction.service.ts` -- the job lifecycle to copy: `enqueue(tx, …)` :159, `claimNext()` :208 (raw `FOR UPDATE SKIP LOCKED` + stale reap :214, :237-247), `runJob` :267, `statusFor` :312, `store` :396 (ids minted with `randomUUID()` then one `createMany`; `STORE_TIMEOUT_MS = 30_000` :73 because the AI call is already paid for), `fail` :513, fencing via `updateMany({ where: { id, status: 'Running', attempts } })` + `written.count === 1` (:483-494, :555-575), `ExtractionFenced` :61.
- `apps/api/src/extraction/extraction.runner.ts:24` -- `OnModuleInit`/`OnModuleDestroy` self-rescheduling `setTimeout` poll, `timer.unref()`, non-overlapping passes, `runOnce()` :53 as the test seam, env-gated.
- `apps/api/src/extraction/extraction-policy.ts` -- the four-section policy layout (constants → messages → runtime → rules), `extractionRuntime()` :118 resolved once from the module constructor, `resetExtractionRuntime()` :152 test seam, boot-time claim-timeout invariant :138-146.
- `apps/api/src/extraction/extraction-prompt.ts` / `extraction-schema.ts` / `extraction-payload.ts` -- the three-file split: prompt text in the domain module; Zod wire contract (strict Structured Outputs forbids `optional`/`minItems`/`maxItems`/`refine` — absent is `.nullable()`, see :20-26) exporting a schema name + `fake…Payload` builder; deterministic post-hoc validation with its own ceilings.
- `apps/api/src/extraction/rich-text.ts` -- `RichText`, `RichTextSegment`, `parseRichText` :68, `isRichText` :85, `plainTextOf` :101. Reuse as-is; do not fork.
- `apps/api/src/sourcetest/source-test-reader.ts` -- token + type-only interface pattern (`SOURCE_TEST_READER` :77, `SourceTestReader` :55) bound with `useExisting` (`source-test.module.ts:62`); the file header explains why a two-class cycle is a boot crash under ESM. `SourceTestService.requireReadable` (`source-test.service.ts:775`) is the read to use — it ignores `expiresAt`, which `requireLive` does not.
- `apps/api/src/sourcetest/source-test.service.ts:540` `submit()` -- the "one transaction: guarded state write + enqueue" template.
- `apps/api/src/sourcetest/source-test.controller.ts:149-153` -- `@Controller('parent/…')` + `@SkipThrottle({ login: true })` + `@UseGuards(ParentElevationGuard)`, account from `req.elevated!.parentAccountId`.

**Change these:**
- `apps/api/src/ai/ai.service.ts` -- `run()` :177 throws `AiInputError(AI_NO_IMAGES)` on zero images and `callOpenAi` :273-292 always builds an image array; `callFake` :356 derives token figures from `imageCount` alone. Generation is text-in/text-out and needs a modality.
- `apps/api/src/allowance/allowance.service.ts:52-56` -- `ARTIFACT_COUNTERS`, all three `async () => 0` stubs; its own comment names generation as "charged on first reaching draft". `consumptionFor` :82, `windowFor` :77, `resolveWindow` (`period.ts:128`), `limitsFor`/`TIER_LIMITS` (`tiers.ts:20-33`, `null` = unlimited).
- `apps/api/src/app.module.ts:19-63` -- module list with a one-line ownership comment each; `AllowanceModule` is only pulled in transitively today.
- `apps/api/prisma/schema.prisma` -- no Practice Test / Question / Attempt model exists. `ExtractedQuestion` :647 (`usable` :657-659 is explicitly "Epic 4 generates from them and from nothing else"), `ExtractedChoice` :680, `ExtractedTopicLabel` :696, `ExtractionJob` :571 (the queue shape to mirror), `AiCallClass` :452 already reserves `Generation`. Conventions: `String @id @default(uuid())`, `@@map("snake_case")` on tables only, PascalCase enums with `@@map`, `Restrict` for records / `Cascade` for owned rows.
- `apps/api/src/ai/ai-config.ts:23-30,61-65` -- `Generation` call class and its pin already exist; `AI_MODEL_GENERATION` / `AI_PRICE_GENERATION_IN` / `_OUT` come free from `envSuffixFor` :113.
- `apps/api/test/harness.ts:46-76` -- `createHarness()` exposes services (`allowance`, `extractionRunner`); `captureAi` wraps `ai.run` over the fake transport; `EXTRACTION_TABLES` truncate list. `apps/api/test/setup.ts` sets `EXTRACTION_WORKER_ENABLED='false'`, `AI_MAX_ATTEMPTS='1'`.
- `apps/web/src/app/parent/capture/page.tsx:547` `proceedToGenerate` (currently only sets `generateReached`), the generate section :831-880, and the extraction poll :324-359 (the request-id + `setTimeout` pattern to copy). `apps/web/src/lib/extraction-status.ts` (`EXTRACTION_POLL_MS`, `isSettled`).
- `apps/web/src/lib/parent-api.ts` -- `parentApi` singleton, `API_BASE` :166, `credentials: 'include'` :283, every parent method takes `token` first and sends `Bearer` :625. `ParentApiError`, `messageFor`.
- `apps/web/src/lib/parent-view.ts` -- `endsParentView`, `applyIfCurrent`, `Announcement`.
- `apps/web/src/copy/parent.ts:331-336` -- `capture.generate` block, including the `reached` stub this story replaces and `noGenerationCharge`; `submitBlocked(reasons)` :247-254 is the disabled-with-reason precedent.
- `apps/web/src/copy/admin.ts:41-59` -- `usageOfLimit(used, limit)`, `unlimited`, the `Generation Allowance` label; `apps/web/src/lib/consumption-format.ts` `limitLabel(null) === 'Unlimited'`.
- `apps/web/src/components/` -- `PrimaryButton` (`Button.tsx:16`), `Screen` (`Screen.tsx:14`, `measured` caps at 34rem), `AppDialog` (`Dialog.tsx:30`), `useAnnounce` (`LiveRegion.tsx:116`). No radio/segmented primitive exists: the bounded-choice precedent is raw MUI `RadioGroup` in `app/parent/_components/BackToStudentMode.tsx:230-249` with `sx={{ minHeight: density.tapTarget }}`. No progress component exists: progress is a `<Typography role="status">` sentence.
- `apps/web/src/theme/tokens.ts` -- `density` (compact for parent, `tapTarget: 44`), `typeRoles.questionBody` (serif, generated content only), `rounded.paper` vs `rounded.control`.
- `e2e/tests/parent-capture.spec.ts:24-68` -- in-file `signUp`/`openCapture` helpers, `PASSWORD`/`PIN` constants; `e2e/fixtures.ts` seeds Postgres directly (no tier/allowance fixture exists yet); `playwright.config.ts` replaces env wholesale.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/ai/ai.service.ts` -- add a required `modality: 'vision' | 'text'` to `AiRunRequest`; gate the zero-image guard on `modality === 'vision'`, reject a `text` call carrying images with a new `AI_TEXT_CALL_HAS_IMAGES` constant, and give `callFake` deterministic token figures for a text call derived from prompt length rather than image count -- a Generation call reads a persisted Extraction, not photographs, and a 0-image fake would otherwise report a free call.
- `apps/api/src/extraction/extraction.service.ts` + new `apps/api/src/extraction/extraction-reader.ts` -- add an `EXTRACTION_READER` token and type-only `ExtractionReader` interface exposing `readForGeneration(sourceTestId)` (usable questions with ordinals, formats, prompts, choices, topic labels, plus `pageCount`), implemented on `ExtractionService` and bound `useExisting` in `extraction.module.ts` -- cross-module reads go through a leaf token, never the class (ESM cycle).
- `apps/api/prisma/schema.prisma` + a new migration -- add `PracticeTest` (`parentAccountId`/`sourceTestId`/`studentProfileId`, `status PracticeTestStatus @default(Draft)`, `generationJobId`, `ordinal`, `questionCount`, `chargedAt DateTime?`, timestamps), `PracticeTestQuestion` (`ordinal`, `format QuestionFormat`, `prompt Json`, `answer Json?`), `PracticeTestChoice` (`ordinal`, `body Json`, `isCorrect Boolean`), `PracticeTestQuestionTopic` (`label String`, raw and uncanonicalized), `GenerationJob` (`parentAccountId`, `sourceTestId`, `studentProfileId`, `requestedCount`, `producedCount`, `status GenerationJobStatus`, `attempts`, `lockedAt`, `failureKind AiFailureKind?`, `failureReason`, `retryable`, `completedAt`), and enums `PracticeTestStatus (Draft|Released|Discarded)` / `GenerationJobStatus (Queued|Running|Succeeded|PartiallyComplete|Failed)` -- with `@@index([parentAccountId, chargedAt])` for the allowance count and `@@index([status, createdAt])` for the claim.
- `apps/api/src/practicetest/practice-test-policy.ts` -- four sections: constants (`MAX_PER_REQUEST = 5`, `MAX_JOB_ATTEMPTS`, defaults for claim timeout and poll), refusal messages, `practiceTestRuntime()` resolved once from the module constructor with a `reset…` test seam and the boot-time claim-timeout invariant restated for N sequential AI calls, and pure rules (`clampCount(requested, remaining)`, `remainingFor(used, limit)`, `formatTargets(sourceFormats, total)` by largest-remainder apportionment).
- `apps/api/src/practicetest/practice-test-prompt.ts` -- the generation prompt: the source Extraction's usable questions, the per-format target counts, the Topics to cover, and an explicit "must not reproduce any source question verbatim, and must differ from these already-generated prompts" list carried forward within the job.
- `apps/api/src/practicetest/practice-test-schema.ts` -- the Zod wire contract (all fields required, absent is `.nullable()`, `RichText` for every text field), `PRACTICE_TEST_SCHEMA_NAME`, and `fakePracticeTestPayload` for the fake transport.
- `apps/api/src/practicetest/practice-test-payload.ts` -- deterministic post-hoc validation: exactly one `isCorrect` choice and a null `answer` for MultipleChoice with at least three choices; a non-null `answer` and no choices otherwise; at least one topic label per question; the produced format mix equals the computed targets; no prompt whose normalized `plainTextOf` equals a source prompt's.
- `apps/api/src/practicetest/practice-test.service.ts` -- `request(parentAccountId, sourceTestId, count)` (one transaction: `requireReadable`, usable-question check, allowance read + clamp, `GenerationJob` insert), `claimNext()`, `runJob(job)` (one AI call per remaining draft, each landing in its own fenced transaction that re-reads the window and sets `chargedAt`), `statusFor(parentAccountId, sourceTestId)`, and a `fail()` mapping faults exactly as extraction does.
- `apps/api/src/practicetest/practice-test.runner.ts` -- the poll loop mirroring `ExtractionRunner`, env-gated, with `runOnce()` exposed.
- `apps/api/src/practicetest/dto/practice-test.dto.ts` + `practice-test.controller.ts` -- `POST /parent/source-tests/:id/practice-tests`, `GET /parent/source-tests/:id/practice-tests/job`, `GET /parent/allowance/generation`; shape-only `class-validator` on the count, row-dependent rules in the service.
- `apps/api/src/practicetest/practice-test.module.ts` + `apps/api/src/app.module.ts` -- register the module (importing `AllowanceModule`, `SourceTestModule`, `ExtractionModule`, `AiModule`, and its own `JwtModule` for the elevation guard) and add it to the app module list with its ownership comment.
- `apps/api/src/allowance/allowance.service.ts` -- replace the `generation` stub with a count of `PracticeTest` rows for the account whose `chargedAt` falls in `[window.start, window.end)` -- usage stays derived, never decremented.
- `apps/api/src/practicetest/*.spec.ts` -- unit tests for the policy rules and every post-hoc validation branch in the I/O matrix; `apps/api/test/practice-test.int-spec.ts` -- integration coverage of clamping, pricing, partial success, total failure, and the derived allowance count, driving `runOnce()` directly.
- `apps/api/test/harness.ts` + `apps/api/test/setup.ts` -- expose `practiceTestRunner`, add the new tables to the truncate list, and disable the new worker by default.
- `.env.example` -- document the new `GENERATION_WORKER_ENABLED`, claim-timeout and poll variables in the existing AI/extraction block's prose style; the E2E config spreads `process.env`, so no Playwright change is needed unless a value must differ under E2E.
- `apps/web/src/lib/parent-api.ts` -- add `generationAllowance(token)`, `startGeneration(token, sourceTestId, count)`, `generationJob(token, sourceTestId)` in the existing token-first shape.
- `apps/web/src/lib/practice-test-count.ts` + spec -- pure `countOptions(remaining)` and `generationPollMs`/`isSettled` for the job, DOM-free so the rules are unit-testable.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` + spec -- the count picker (raw `RadioGroup`, unavailable counts rendered disabled with the reason stated beside them), the stated cost, a confirm dialog, then the progress view polling the job with the request-id guard, announced through `useAnnounce` in the same words it displays.
- `apps/web/src/app/parent/capture/page.tsx` -- `proceedToGenerate` navigates to the new route instead of setting `generateReached` -- the flow must survive leaving the screen, and only a URL-addressable route does.
- `apps/web/src/copy/parent.ts` -- replace the `capture.generate.reached` stub and add the generate/progress block: cost stated in Practice Tests naming spend and remainder, the disabled-count reason, and progress copy that never claims work will be lost.
- `e2e/tests/parent-practice-test.spec.ts` + `e2e/fixtures.ts` -- a tier/consumption fixture so the disabled-count branch is reachable, and a browser pass over pick → cost → confirm → progress → drafts landed.

**Acceptance Criteria:**
- Given a submitted Source Test with a completed Extraction, when the parent opens the generate step, then counts above `min(5, remaining Generation Allowance)` are rendered disabled with the reason stated and are never removed from the list.
- Given any requested count, when the API receives it, then the persisted `requestedCount` equals `clampCount(requested, remaining)` regardless of what the client sent.
- Given a chosen count, when the parent is asked to confirm, then the cost is stated in Practice Tests before the confirm control is actionable, naming both what it spends and what remains.
- Given a job that produced at least one draft, when it later fails, then the landed drafts persist, each carries a `chargedAt`, the job reports `PartiallyComplete` with a matching `producedCount`, and the Generation Allowance count equals the number of landed drafts.
- Given a job that produced nothing, when it fails, then no `PracticeTest` row exists, the Generation Allowance count is unchanged, and the Source Test is still `Submitted` and retryable without a new upload.
- Given a generated Practice Test, when its rows are read, then its question count matches the Source Test's usable question count, its format mix matches the computed per-format targets, every question carries at least one topic label, every MultipleChoice question has exactly one correct choice among at least three, and every text field is a `RichText` segment array.
- Given the parent leaves the generate screen and returns to its URL while the job runs, then the progress shown is read from the server and reflects the job's current status and counts.
- Given any generation log line, cost row or error message, then it carries identifiers, counts and money only — no fragment of a generated question.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 2, medium 6, low 6)
- defer: 4: (high 0, medium 3, low 1)
- reject: 9: (high 0, medium 3, low 6)
- addressed_findings:
  - `[high]` `[patch]` A post-hoc `GenerationPayloadInvalid` was thrown outside `AiService`'s attempt loop, so the "Malformed payload" and "Verbatim copy" matrix rows never retried. `produceDraft()` now re-issues the generation call under `AI_MAX_ATTEMPTS`; two integration tests cover recovery and exhaustion.
  - `[high]` `[patch]` The claim/fence machinery had no test at all. Added stale-reclaim, attempt-exhaustion, land-fence (mutation-checked), resume-from-`producedCount`, a `practice-test.runner.spec.ts` with fake timers, and runtime/claim-timeout-invariant cases.
  - `[medium]` `[patch]` `normalizePrompt` folded every `\p{P}`/`\p{S}`, so "5 + 3" and "5 - 3" collided and a genuinely new arithmetic question was rejected. Operators are now significant.
  - `[medium]` `[patch]` 409 refusal reasons authored in `practice-test-policy.ts` never reached the screen; `ParentApiError` now carries the server's stated reason for a 409 and the generate screen prefers it.
  - `[medium]` `[patch]` The generate screen never refetched the allowance, so after a settled job it offered counts the account had just spent. It now re-reads on settle.
  - `[medium]` `[patch]` Every failure of the job read was swallowed as "nothing requested yet"; only a 404 is now treated that way.
  - `[medium]` `[patch]` The disabled-count reason was repeated as an unassociated sibling per radio; it is now one node under the group, wired with `aria-describedby`.
  - `[medium]` `[patch]` The fence was only discovered inside `land()`, after a paid AI call; `requireFence()` now re-asserts it before every call.
  - `[low]` `[patch]` `AiInputError` was reported to the parent as "retake the pages"; it has its own terminal `GENERATION_REQUEST_REJECTED`.
  - `[low]` `[patch]` `landedPromptsFor` cast past `JsonValue` with `as never`; it now guards with `isRichText` and drops an unreadable row instead of throwing after drafts are charged.
  - `[low]` `[patch]` The e2e thin-extraction gate used non-waiting `isVisible()`; it now waits explicitly.
  - `[low]` `[patch]` The payload ceilings (`MAX_SEGMENTS`, `MAX_TEXT_LENGTH`, `MAX_CHOICES`, `MAX_TOPICS`, `MAX_LABEL_LENGTH`) had no coverage; each has an at-limit and over-limit case.
  - `[low]` `[patch]` Two stale doc comments (the payload header's retry claim, `generate.intro`'s "names the child") now match the code and copy.
  - `[low]` `[patch]` The clock-anomaly guard threw `AiUpstreamError` and was written retryable; it is now its own terminal `GenerationClockAnomaly`.

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 3: (high 0, medium 1, low 2)
- reject: 7: (high 2, medium 2, low 3)
- addressed_findings:
  - `[medium]` `[patch]` A generation-outcome test gap: no test drove the `AiRejectedError` (provider-refusal) branch of `fail()`. Added an integration test asserting `Failed` / `UpstreamFault` / `retryable: false` / `GENERATION_UPSTREAM_REJECTED` and that a further pass does not retry it.
  - `[medium]` `[patch]` Another outcome gap: no test drove the `GenerationClockAnomaly` terminal branch. Added an integration test that fakes `AllowanceService.windowFor` to a window excluding "now" and asserts the same terminal, non-retryable shape.
  - `[medium]` `[patch]` A third outcome gap: `runJob`'s own re-read of the Extraction (the race distinct from the pre-enqueue check in `request()`) had no test for either the "Extraction gone" or "no usable questions left" branch. Added both as integration tests.
  - `[low]` `[patch]` `practice-test-payload.ts` reused one refusal message across two distinct failures three times over: `TOPIC_REQUIRED` also covered an over-length label, `PROMPT_NOT_NEW` also covered a prompt that normalizes to nothing, and `CHOICES_NOT_DISTINCT` also covered a choice body that normalizes to nothing. Split into `TOPIC_LABEL_TOO_LONG`, `PROMPT_EMPTY` and `CHOICE_BODY_EMPTY`; existing and new unit tests cover each branch by its own message.
  - `[low]` `[patch]` `practice-test-policy.spec.ts` re-implemented the boot-time claim-timeout invariant's worst-case formula locally rather than importing it, so the test and the production check could silently drift. Exported `worstCaseRunMs()` from `practice-test-policy.ts` and pointed the test at it.
  - `[low]` `[patch]` The generate screen's post-settle allowance re-read left a window where the picker still reflected the pre-charge allowance and nothing was disabled. Added a `refreshingAllowance` state that locks the picker and the Generate button for that window, with source-level test coverage.
  - `[low]` `[patch]` `statusFor()`'s `findFirst` ordered only by `createdAt`, an unreliable tie-break for two jobs enqueued in the same millisecond. Added `id: 'desc'` as a secondary sort key.

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 2, low 2)
- defer: 0
- reject: 9: (high 0, medium 2, low 7)
- addressed_findings:
  - `[high]` `[patch]` The boot-time claim-timeout invariant (`worstCaseRunMs()`) multiplied one AI call's worst case only by `MAX_PER_REQUEST`, missing that `produceDraft` re-issues a full `ai.run()` call up to `AI_MAX_ATTEMPTS` times on a post-hoc payload rejection. `GENERATION_CLAIM_TIMEOUT_MS` could pass the boot check while still short enough for a claim to expire mid-run and charge twice — the exact hazard the invariant exists to catch. The formula now also multiplies by `AI_MAX_ATTEMPTS`; `DEFAULT_CLAIM_TIMEOUT_MS` and `.env.example` raised from 3,600,000ms to 10,800,000ms to clear the new figure with the shipped AI defaults.
  - `[medium]` `[patch]` `PracticeTest.sourceTest` and `GenerationJob.sourceTest` were `onDelete: Cascade`, so deleting a Source Test would silently delete already-charged `PracticeTest` rows and decrement the derived Generation Allowance count — contradicting the model's own comment that no such refund path exists. No Source Test delete endpoint exists yet, so this was unreachable, but the FK is now `Restrict` on both relations, added via a new migration (`20260924170321_restrict_practice_test_source_test_delete`).
  - `[medium]` `[patch]` `ai.service.openai.spec.ts` — the only test file exercising the real/OpenAI request-shape builder — only ever built a `modality: 'vision'` request, even though `modality: 'text', images: []` is the only shape Generation's `produceDraft` ever sends in production. Added a test asserting the real transport sends only an `input_text` part and no image parts for a text call.
  - `[low]` `[patch]` `land()`'s clock-anomaly guard read `window` and `chargedAt` from two separate clock instants across an await, so a period boundary landing between them could terminally fail an otherwise-normal job. Both are now derived from one captured `now`.
  - `[low]` `[patch]` The comment above `request()`'s allowance count claimed a concurrent request "cannot read a stale usage and both be accepted," which does not hold under Postgres's default Read Committed isolation and contradicts this spec's own already-recorded concurrent-request-overspend deferral. Corrected to state the actual guarantee and point at the existing deferred entry instead of denying it.

## Design Notes

**Why a second job table rather than a generalized one.** `ExtractionJob` is one job per Source Test (`sourceTestId @unique`, re-run resets to `Queued`). A generation job is one per *request* — a parent generates, and in Story 4.2 generates again — so the uniqueness, the payload (`requestedCount`/`producedCount`) and the terminal states differ. Mirroring the claim/fence mechanics while keeping the row shapes separate is the honest split; a shared polymorphic job table would have to carry both uniqueness rules and neither would be a constraint.

**Incremental charging is the reason the fence matters.** N drafts means N transactions, and the job may be reclaimed after a stale lock while an old pass is still running. Each landing therefore re-asserts `{ id, status: 'Running', attempts: job.attempts }` and re-reads the allowance window, because a period rollover or a tier change mid-job is possible:

```ts
const landed = await tx.practiceTest.createMany({ data: [row] });      // row.chargedAt = now
const fenced = await tx.generationJob.updateMany({
  where: { id: job.id, status: 'Running', attempts: job.attempts },
  data: { producedCount: { increment: 1 } },
});
if (fenced.count !== 1) throw new GenerationFenced();                   // rolls the draft back with it
```

**Material difference is enforced, not hoped for.** The prompt carries the plain text of every prompt already landed in this job plus the source prompts; `practice-test-payload.ts` then rejects any generated prompt whose normalized `plainTextOf` collides with one of them. A collision is an upstream fault (the model was asked for a shape and answered with another), so it retries under the existing policy rather than failing the parent immediately.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev` -- expected: the new migration applies cleanly and `prisma generate` emits the new models.
- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter api test` -- expected: the new policy, payload and runner specs pass alongside the existing suite.
- `pnpm --filter api test:int` -- expected: `practice-test.int-spec.ts` passes against real Postgres, covering clamping, pricing, partial success and total failure.
- `pnpm --filter web test` -- expected: `practice-test-count.spec.ts` and the generate page spec pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the parent flow passes end to end.
- `pnpm lint` and `pnpm prettier --check .` -- expected: clean.

## Auto Run Result

**Summary:** Fresh review pass (this run's third) over the already-`done` Story 4.1 implementation, on the caller's fresh-review-recommended signal. No new implementation change: five patch findings fixed, nine findings rejected (mostly duplicates of already-recorded deferred items or out-of-scope per the intent's own Never/Block-If clauses), no intent gaps or bad-spec findings.

**Files changed with one-line descriptions:**
- `apps/api/src/practicetest/practice-test-policy.ts` -- `worstCaseRunMs()` now also multiplies by `AI_MAX_ATTEMPTS` (produceDraft's post-hoc-rejection retry loop was previously uncounted); `DEFAULT_CLAIM_TIMEOUT_MS` raised 3,600,000ms -> 10,800,000ms to clear the corrected figure.
- `.env.example` -- `GENERATION_CLAIM_TIMEOUT_MS` default and its explanatory comment updated to match.
- `apps/api/prisma/schema.prisma` -- `PracticeTest.sourceTest` and `GenerationJob.sourceTest` changed `onDelete: Cascade` -> `Restrict`, so a Source Test delete can no longer silently uncharge already-billed Practice Tests.
- `apps/api/prisma/migrations/20260924170321_restrict_practice_test_source_test_delete/` -- new migration for the FK change above.
- `apps/api/src/practicetest/practice-test.service.ts` -- `land()` now derives `window` and `chargedAt` from one captured `now` instead of two separate clock reads; the misleading concurrency claim in `request()`'s comment corrected to point at the already-recorded deferred limitation instead of denying it.
- `apps/api/src/ai/ai.service.openai.spec.ts` -- added a real-transport test asserting a `modality: 'text', images: []` call sends only an `input_text` part.

**Review findings breakdown:** patch 5 (high 1, medium 2, low 2) — all applied; deferred 0; rejected 9 (medium 2, low 7) — duplicates of already-recorded deferred items (concurrent-request allowance race, duplicated allowance-window query, the browser-integration partial/total-failure coverage gap), out-of-scope per the intent's explicit Epic 7/Epic 9 exclusions (topic-label dedup/ordering, hard-cap enforcement), already-mitigated (prompt/draft size bounded upstream by `MAX_PAGES`), already-required-by-spec (`pageCount` threaded for forward use), or design preferences the intent does not require (retry backoff, an additional unit-test file the existing integration suite already covers).

**Follow-up review recommendation:** `true` (one `high`-severity patch this pass; score = 3x2 medium + 1x2 low = 8, also above the 5 threshold on its own).

**Verification performed:**
- `pnpm --filter api typecheck` -- clean.
- `pnpm --filter web typecheck` -- clean.
- `pnpm --filter api test` -- 723 tests, 1 pre-existing failure in `test/extraction.int-spec.ts` (re-run in isolation reproduced the same signature in a different file, `test/uncommitted-state.int-spec.ts` -- matches the already-recorded deferred item on cross-file integration-harness flakiness; not caused by this pass's changes).
- `pnpm --filter web test` -- 362 tests, all passing.
- `pnpm exec prisma migrate dev` (twice) -- migration applied cleanly, schema and migrations back in sync with no pending diff.
- `pnpm exec prettier --check` on every changed file -- clean.
- `pnpm lint` -- could not run: `eslint` binary not found in this environment; confirmed via `git stash` that the same failure occurs on the pre-existing baseline, so it is an environment gap, not a regression from this pass.

**Residual risks:** the `eslint` binary issue above was not resolved (environment-level, out of this pass's scope). The nine already-known items above remain open in `deferred`, unchanged by this pass.

