---
title: 'Story 3.4 — Legibility Check & Upload Commit'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: 'f71e8cd54b47616192e35ad6fd2bc3bd061b5a40'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The legibility check endpoint is free, uncapped and re-runnable, so an add-page /
      check / delete-page loop can bill unbounded provider calls.
    evidence: |-
      `POST /parent/source-tests/:id/legibility` charges no allowance by design (AD-29)
      and becomes runnable again after any page add, retake or delete. There is no
      throttle on the route, no per-draft check counter and no `@Throttle` anywhere in
      the API. Allowance *enforcement* is Epic 9's, but a per-check ceiling is not the
      same thing as an allowance.
    location: >-
      apps/api/src/sourcetest/source-test.controller.ts
    severity: medium
  - summary: >-
      The Legibility call class is pinned to the cheap `luna` model, which ai-config
      itself documents as the non-vision pin, and images are sent at `detail: 'auto'`.
    evidence: |-
      `DEFAULT_MODEL_PINS.Legibility` is `gpt-5.6-luna`, described in the same file as
      "the cheap, fast pin for the two classes that answer a narrow question about
      something already read", while `sol` is documented as "the capable
      vision-and-reasoning pin ... which is what reading a photographed paper test
      needs". Story 3.4 is the first vision use of the class. The pin predates this
      story (shipped with the `ai` module), so either the pin or its rationale comment
      is now wrong.
    location: >-
      apps/api/src/ai/ai-config.ts
    severity: medium
  - summary: >-
      A foreground, in-request call inherits the worker-sized 180s timeout and 3
      attempts, so a worst case holds the parent's HTTP request open for ~9 minutes.
    evidence: |-
      `DEFAULT_AI_TIMEOUT_MS = 180_000` and `DEFAULT_AI_MAX_ATTEMPTS = 3` were sized for
      the asynchronous Extraction/Generation paths. Nothing gives the Legibility class a
      shorter timeout or a single attempt, and the web client sets no abort. Any sane
      proxy or browser timeout fires first, and the parent's retry pays for the tokens
      twice.
    location: >-
      apps/api/src/ai/ai-config.ts
    severity: medium
  - summary: >-
      `allowance` now imports the whole `SourceTestModule` rather than the existing
      narrow `SOURCE_TEST_READER` seam, to run one count.
    evidence: |-
      The spec's wording ("read by `allowance` through `SourceTestService`") is what was
      implemented, and it is followed exactly. But `sourcetest` already publishes a
      narrow reader token for cross-module reads (used by `practicetest`), and importing
      the full module drags the controller, `PageIngestService`, `AiModule` and the
      parent-JWT `JwtModule` registration behind every consumer of `AllowanceModule`,
      including `admin`. `countSubmittedIn` arguably belongs on the reader interface.
    location: >-
      apps/api/src/allowance/allowance.module.ts
    severity: low
  - summary: >-
      The combined `pnpm test` run is flaky: loading all 43 api spec files into one
      process intermittently yields 404s from a partially-booted app.
    evidence: |-
      Four consecutive runs produced four disjoint failure sets, always in specs the
      story does not touch (extraction, parent-pin, rate-limit, practice-test,
      student-profile), with `POST /api/auth/sign-up` answering 404. Reproduced on the
      pre-change tree by stashing the whole diff: 1 failure in `practice-test.int-spec`
      out of 868. The same files are green split as `vitest run src` (439/439) and
      `test:int` (614/614). Pre-existing harness problem, not a regression from this
      story, but it makes the combined run unusable as a gate.
    location: >-
      apps/api/vitest.config.ts
    severity: medium
  - summary: >-
      The capture screen's unit specs assert on component source text read with
      `readFileSync` rather than on rendered markup.
    evidence: |-
      `page.spec.tsx` pins behaviour with `PAGE_SOURCE.toContain("pending === 'check'")`
      and `panel.indexOf('legibility-cost') < panel.indexOf('legibility-continue')`.
      These break on a reformat and pass on a semantically broken refactor. The file used
      this pattern before this story and the same file already has a working
      `renderToStaticMarkup` helper for `PageStrip`, so the rendered half is reachable.
    location: >-
      apps/web/src/app/parent/capture/page.spec.tsx
    severity: low
  - summary: >-
      "No log line ever carries image bytes or page content" is asserted for the cost row
      and the HTTP body, but never for logs.
    evidence: |-
      `source-test.int-spec.ts` pins the exact key set of the `ai_call` row and asserts
      the response body carries no `storagePath`, `.uploads` or base64. Nothing observes
      the log stream, and the test harness records the prompt without asserting on it.
    location: >-
      apps/api/test/source-test.int-spec.ts
    severity: low
  - summary: >-
      The web copy constants `capture.submit` / `capture.submitting` now render the
      "Check pages" / "Checking…" control's label and pending text, while the actual
      commit control uses `capture.legibility.continueWith` / `.committing` — the
      constant names no longer describe what they render.
    evidence: |-
      A prior review pass in this same story already fixed the functional half of this
      (the commit button briefly rendered "Checking…" because it read `capture.submitting`
      directly) by adding `capture.legibility.committing` for the commit control, but left
      `capture.submit` / `capture.submitting` bound to the check button under their
      original, now-misleading names. A future reader editing "submit" copy is likely to
      touch the wrong control.
    location: >-
      apps/web/src/copy/parent.ts, apps/web/src/app/parent/capture/page.tsx
    severity: low
  - summary: >-
      Two genuinely concurrent legibility-check requests for the same page set can each
      dispatch a provider call before either sees the other's compare-and-set write, so a
      real double tap can spend two provider calls (and write two `AiCall` rows) even
      though only one request's verdicts are ever stored.
    evidence: |-
      `checkLegibility` calls `this.ai.run(...)` before the transaction that performs the
      `pageSetStamp` compare-and-set. The loser of the race is answered the winner's
      stored result rather than a duplicate charge, so stored data and the parent-facing
      outcome stay correct, but the provider spend itself is not deduplicated. Closing
      this needs a claim/lock ahead of the provider call (e.g. an in-flight marker), which
      is a design change beyond this pass's patch scope. Sibling concern to the existing
      "free, uncapped, re-runnable" deferred item above, but specific to true request
      concurrency rather than sequential re-runs over time.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts
    severity: medium
  - summary: >-
      The new `source_test` composite index (`parentAccountId, status, submittedAt`) is
      created with a plain `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY`, so replaying
      this migration against a populated table takes an exclusive lock for the build
      duration.
    evidence: |-
      `apps/api/prisma/migrations/20260926090000_add_page_legibility/migration.sql` adds
      the index inside the same transactional migration as the rest of the schema change.
      `CONCURRENTLY` cannot run inside a transaction, so avoiding the lock needs a
      non-transactional migration step, which is an operational/deployment decision, not a
      one-line fix. Low impact at current table size; worth revisiting before a production
      table is large enough for the lock duration to matter.
    location: >-
      apps/api/prisma/migrations/20260926090000_add_page_legibility/migration.sql
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent submits a Source Test blind: nothing tells them a page is too blurry to read while the paper is still in hand, nothing states that committing spends an Upload Allowance, and the Upload counter still reads zero because `ARTIFACT_COUNTERS.upload` is a stub. There is also no `ai` module at all, so no AI call class exists to run the check through.

**Approach:** Ship the `ai` module (AD-17/20/22) with its first call class — Legibility (AD-29) — then add a foreground, once-per-page-set batch check on `sourcetest` that reports per-page confidence, gate submit on the check having run, and wire the derived Upload Allowance count to Submitted Source Tests so committing charges exactly once and abandoning charges nothing.

## Boundaries & Constraints

**Always:**
- **One `ai` module owns every provider call** (AD-17): the client, the pinned model snapshot per call class, timeout and retry policy, and the `AiCall` cost row. It is the only writer of `ai_call`, and it is the only test seam for nondeterminism (AD-22). Domain modules call it with a typed request; **the prompt text lives in `sourcetest`**, which is the AD-17 carve-out.
- Two transports, resolved and validated **once at boot** exactly as `MailService` resolves its own: `fake` (the default; the seam every unit, integration and E2E tier runs on) and `openai` (a `fetch` POST — no provider SDK, no new dependency). `NODE_ENV=production` must state the transport explicitly, and `openai` requires `OPENAI_API_KEY`.
- The fake can fail, not only succeed (AD-22): `AI_FAKE_FAILURE` selects `none` (default), `transport`, or `schema`, read per call so a test can drive it.
- **One `AiCall` row per completed provider call** (AD-20): parent account, call class, pinned model snapshot, input/output token counts, computed cost, latency, correlation id from `currentCorrelationId()`. No row, log line or error ever carries image bytes or page content — identifiers only.
- Every AI payload passes **deterministic post-hoc validation in code** after shape validation (AD-30): one verdict per submitted page, ordinals exactly the stored set, confidence in `low | medium | high`. Anything else is a content fault and the whole payload is rejected — a partial or invented verdict is never stored.
- The check is **one batch over all pages, foreground, in-request** (AD-4, AD-29), and it **runs once**: the verdicts and `legibilityCheckedAt` are stored, and a second call returns the stored result without a provider call. Adding, retaking or deleting a page clears the stored check, because the batch no longer covers the page set; reordering does not, because verdicts hang off the page rows.
- It **charges no allowance** (AD-29): it produces nothing.
- The result is **per-page confidence, never a whole-test pass/fail**, it names each failing page, and it offers a retake scoped to that page alone. It is **advisory**: proceeding over a failing page is always allowed and the control is never disabled for it.
- Before the parent commits, the screen states — beforehand — that continuing commits the Source Test and spends one Upload Allowance, and that abandoning spends nothing.
- **Submission is refused server-side until the check has run**, alongside the existing page-count and classification gates. The disabled control is a courtesy; the refusal is the control.
- Upload usage stays **derived, never decremented** (AD-14): it is the count of Source Tests belonging to the account whose `submittedAt` falls inside the period window, read by `allowance` **through `SourceTestService`** and never through a Prisma delegate of its own (AD-17). No counter column, no charge write, no reset job — a draft that is abandoned or expires was never Submitted, so it was never charged, and a failed submit leaves the row a Draft.
- The account comes from `req.elevated` (AD-18); a foreign or unknown Source Test is 404, never 403. Draft-only and expiry-filtered like every other write on this controller.
- User-facing strings live in `src/copy/parent.ts`; web rules are exported pure functions with colocated specs (the web suite has no DOM). Accessibility: the legibility flag is glyph **and** text, never colour alone; every control names the page ordinal it acts on.

**Block If:**
- Nothing. The call class, its transport shape, its cost row and the derived-count rule are all settled by the architecture spine and the epic context.

**Never:**
- Do not build the camera viewfinder or library multi-select (Story 3.1), Extraction (Story 3.5), or the thin-Extraction warning (Story 3.6).
- Do not implement allowance **enforcement**: nothing hard-blocks at cap here, and no cap message is written. Epic 9 owns that. Do not build a parent-facing Allowances surface or endpoint — Story 9.6 owns it — so the confirmation states the cost in words and shows no usage counter.
- Do not add a queue, a job, or a background worker: this call class is foreground by decision (AD-4).
- Do not add a provider SDK dependency, and do not let any module other than `ai` call a provider or write `ai_call`.
- Do not re-run the check per page as pages are added, and never re-run it after commit.
- Do not block submission on a *failing* page — only on the check not having run. Do not touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First check | `POST /parent/source-tests/:id/legibility`, draft with 3 `Ready` pages | 200; every page carries `legibility` (`Low`/`Medium`/`High`), `legibilityCheckedAt` set; exactly one `AiCall` row written | No error expected |
| Second check, unchanged pages | The same call again | 200; the stored verdicts returned unchanged, **no** second `AiCall` row | No error expected |
| Check with no pages | Draft with zero `Ready` pages | 400 `NO_PAGES_TO_SUBMIT`; nothing stored, no provider call | Whole request rejected |
| Provider transport fault | `AI_FAKE_FAILURE=transport` | 503 `LEGIBILITY_CHECK_FAILED`; `legibilityCheckedAt` stays null and the call is retryable | Nothing stored |
| Schema-invalid payload | `AI_FAKE_FAILURE=schema` | 503 `LEGIBILITY_CHECK_FAILED`; nothing stored | Content fault, never a partial store |
| Verdict for an unknown ordinal | Payload naming a page the Source Test does not hold | Payload rejected whole; 503 `LEGIBILITY_CHECK_FAILED` | Post-hoc validation (AD-30) |
| Add a page after the check | `POST .../pages` on a checked draft | 200; `legibilityCheckedAt` cleared and every page's verdict cleared | No error expected |
| Retake a flagged page | `PUT .../pages/:pageId` on a checked draft | 200; the check is cleared and may be re-run | No error expected |
| Reorder after the check | `PUT .../pages/order` | 200; verdicts and `legibilityCheckedAt` survive — ordinals moved, bytes did not | No error expected |
| Submit before the check | Draft with pages and classification, `legibilityCheckedAt` null | 400 `LEGIBILITY_CHECK_REQUIRED`; status stays `Draft` | Client shows the stated reason |
| Submit over a flagged page | Checked draft holding a `Low` page | 200; status `Submitted` — the check is advisory | No error expected |
| Upload usage after commit | Account with one Submitted Source Test in the window | `consumptionFor` reads `upload.used === 1` | No error expected |
| Upload usage for an abandoned draft | Draft never submitted | `upload.used === 0` | No error expected |
| Upload usage outside the window | Source Test submitted before the period start | Not counted | No error expected |
| Check a submitted or expired Source Test | Status `Submitted`, or `expiresAt` past | 409 `SOURCE_TEST_NOT_DRAFT`; 404 `SOURCE_TEST_NOT_FOUND` for expired | Client returns to the start of the flow |
| Check another account's Source Test | Valid elevation, foreign id | 404 `SOURCE_TEST_NOT_FOUND` | Never 403 |

</intent-contract>

## Code Map

**Patterns to follow (read-only anchors):**
- `apps/api/src/mail/mail.service.ts:38-82` -- `resolveMailConfig`: transports enumerated as a const tuple, validated **once** at construction, `NODE_ENV=production` forced to state itself, `fetch` + `AbortSignal.timeout` as the whole HTTP transport (`:127-148`), and `MailDispatchError` as a transport fault distinct from a programming error. `AiService`'s config, transports and fault type mirror this file shape for shape; `mail.service.spec.ts` is the matching spec shape.
- `apps/api/src/mail/mail.module.ts` -- a module owning no entity and exporting one service. `AiModule` is the same, except that it **does** own `AiCall`.
- `apps/api/src/common/correlation.ts:22` -- `currentCorrelationId()`, the id every `AiCall` row carries (AD-20).
- `apps/api/src/common/env.ts` -- `requireEnv` / `optionalEnv` / `requireIntEnv`; every new env var is read through these and nowhere else.
- `apps/api/src/sourcetest/source-test-policy.ts` -- every message constant and pure rule this module owns, plus the boot-resolved `sourceTestRuntime()` pattern. Add the new sentences and `isPageReadable` here; tests compare against the constant, never a literal.
- `apps/api/src/sourcetest/source-test.service.ts:530-566` -- `submit`: the transaction whose `updateMany` where-clause carries each gate (`status`, `subjectId`, `gradeLevelId`). The legibility gate joins it the same way — as a where-clause condition, not only an in-transaction read.
- `apps/api/src/sourcetest/source-test.service.ts:283-332` -- `addPage` / `retakePage`, and `:341` `deletePage`: the three page-set mutations that must clear the stored check. `:376` `reorderPages` deliberately must not.
- `apps/api/src/sourcetest/source-test.service.ts:~700` -- `viewOf` / `SourceTestView` / `PageImageView` (`:47`, `:58`): the view shape both new fields extend.
- `apps/api/src/sourcetest/source-test.controller.ts:151-175` -- the declaration-order rule (`subjects` before `:id`, `pages/order` before `pages/:pageId`). `POST :id/legibility` carries no such hazard but sits with the other `:id` routes.
- `apps/api/src/sourcetest/page-ingest.service.ts:113-133` -- `write`/`storagePathFor`: bytes are read back for the vision call through `storagePathFor(pageId)` alone, never from a stored path in a response.
- `apps/api/src/allowance/allowance.service.ts:52-56` -- `ARTIFACT_COUNTERS`, the counting seam, and `:105-118` `countArtifactsIn`. The seam is module-level today and must become instance-bound so the injected `SourceTestService` is reachable; the "counted here and nowhere else" rule is the part that must survive.
- `apps/api/src/allowance/period.ts` -- `PeriodWindow` (`{ start, end, timezone }`), the half-open `[start, end)` interval the count filters on.
- `apps/api/src/admin/parent-account-admin.service.ts:42` -- the existing `consumptionFor` consumer; its numbers must not change shape.
- `apps/api/test/harness.ts:66-100` -- `createHarness` and the `captureMail` spy pattern a `captureAi` helper follows; `:126,:139` -- the hand-maintained TRUNCATE lists, which must gain `ai_call`.
- `apps/api/test/source-test.int-spec.ts` -- the int-spec shape and the coverage the new cases extend.
- `apps/web/src/lib/parent-api.ts:105-140` (`PageImageView`, `SourceTestView`), `:473-545` (the Source Test thunks), `:243` (`elevated`).
- `apps/web/src/lib/classification.ts` + `.spec.ts` -- the pure-rule + colocated-spec shape the new legibility rules follow.
- `apps/web/src/app/parent/capture/page.tsx` -- `Pending` (`:44`), the `write()` path (`:~280`), `submittable` / `blockedReasons` (`:~320`), the submit block (`:~560`). `submit`'s copy is already `Check pages` / `Checking…`.
- `apps/web/src/copy/parent.ts:204-268` -- the `capture` namespace, including `submitBlocked(reasons)` which gains a third reason.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/mockups/key-capture.html:601-660` -- STATE 3, the reference mock: flag head, per-page rows with badge, the allowance sentence, `Retake page 2` primary and `Continue with all 3 pages` secondary.
- `e2e/fixtures.ts` (`createGradeLevelFixture`, `createSubjectFixture`) and `e2e/tests/parent-capture.spec.ts:100` (`addPage`), `:265` (the submit flow tests that now pass through the check).

**Files to create:**
- `apps/api/src/ai/ai.module.ts`, `ai.service.ts`, `ai-config.ts`, `ai-config.spec.ts`, `ai.service.spec.ts`
- `apps/api/src/sourcetest/legibility.ts`, `legibility.spec.ts`
- `apps/api/prisma/migrations/<timestamp>_add_ai_call_and_page_legibility/migration.sql`
- `apps/web/src/lib/legibility.ts`, `legibility.spec.ts`

**Files to change:**
- `apps/api/prisma/schema.prisma`
- `apps/api/src/sourcetest/source-test-policy.ts`, `source-test-policy.spec.ts`, `source-test.service.ts`, `source-test.controller.ts`, `source-test.module.ts`
- `apps/api/src/allowance/allowance.service.ts`, `allowance.module.ts`
- `apps/api/src/app.module.ts`, `.env.example`
- `apps/api/test/harness.ts`, `apps/api/test/source-test.int-spec.ts`, `apps/api/test/parent-account.int-spec.ts`
- `apps/web/src/lib/parent-api.ts`, `apps/web/src/copy/parent.ts`, `apps/web/src/app/parent/capture/page.tsx`, `apps/web/src/app/parent/capture/page.spec.tsx`
- `e2e/tests/parent-capture.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `enum PageLegibility { Low Medium High }` (`@@map("page_legibility")`), `PageImage.legibility PageLegibility?`, `SourceTest.legibilityCheckedAt DateTime?`, and an `AiCall` model owned by `ai` (`id`, `parentAccountId` with a `Restrict` relation and a back-relation on `ParentAccount`, `callClass String`, `model String`, `inputTokens Int`, `outputTokens Int`, `costMicros Int`, `latencyMs Int`, `correlationId String?`, `createdAt`, `@@index([parentAccountId, createdAt])`, `@@index([createdAt])`, `@@map("ai_call")`) -- nullable verdicts because "not checked" is precisely the state the submit gate refuses; `costMicros` as an integer because a money column that is a float is a money column that drifts; the account index is what makes per-account cost attribution (AD-20) answerable and the `createdAt` one is what the AD-23 global daily ceiling will read.
- `apps/api/prisma/migrations/<timestamp>_add_ai_call_and_page_legibility/migration.sql` -- generate with `prisma migrate dev --name add_ai_call_and_page_legibility`; no backfill -- an existing draft simply reads as unchecked and the parent checks it.
- `apps/api/src/ai/ai-config.ts` -- the call-class enumeration (`Extraction`, `Generation`, `Grading`, `Explanation`, `Legibility`, `TopicNormalization`), the **pinned model snapshot and per-million input/output micro-price for each**, and `resolveAiConfig(env)` returning transport / apiUrl / apiKey / timeoutMs, validated once and failing the boot on a bad value -- one transcription of every figure, and a mistyped transport must be a process that refuses to start rather than a 500 the first parent to check a page discovers. Mirror `resolveMailConfig` in shape and in its production-must-state-itself rule.
- `apps/api/src/ai/ai-config.spec.ts` -- unit-test the resolver across: default `fake`, production with no transport stated, unknown transport, `openai` without `OPENAI_API_KEY`, a non-numeric and a zero timeout, and the cost arithmetic for a known token count -- the figures are the reason this file exists, so they are what is asserted.
- `apps/api/src/ai/ai.service.ts` -- one public `run(request)` taking `{ callClass, parentAccountId, images: { ordinal, buffer, mimeType }[], prompt, schema }` and answering a parsed payload; it resolves the pin for the call class, dispatches through the `fake` or `openai` transport with `AbortSignal.timeout`, and writes exactly one `AiCall` row per **completed** provider call. A transport fault throws `AiDispatchError` and a shape fault throws `AiPayloadError`, both carrying no content. The `fake` transport answers a deterministic verdict per image — `Low` below `FAKE_UNREADABLE_BYTES`, `High` at or above it — and honours `AI_FAKE_FAILURE` (`transport` / `schema`) read per call, so the seam can fail as AD-22 requires.
- `apps/api/src/ai/ai.service.spec.ts` -- unit-test: the fake's deterministic verdict either side of the threshold, both injected failures, that an `AiCall` row is written on success and **not** on a transport fault, and that no row, message or log line carries image bytes.
- `apps/api/src/ai/ai.module.ts` -- exports `AiService`, imports `PrismaModule`; registered in `app.module.ts`. It owns `ai_call` and nothing else writes it (AD-17, AD-20).
- `apps/api/src/sourcetest/legibility.ts` + `.spec.ts` -- the **prompt text** (the AD-17 carve-out: it stays in the domain module), the expected payload shape, and `validateLegibilityPayload(payload, ordinals)` doing the deterministic post-hoc validation of AD-30: one verdict per stored ordinal, no extra and no missing ordinal, confidence within the enum, rejecting the payload **whole** rather than storing a partial one. The spec drives every rejection branch.
- `apps/api/src/sourcetest/source-test-policy.ts` -- add `LEGIBILITY_CHECK_REQUIRED` and `LEGIBILITY_CHECK_FAILED` message constants (no allowance sentence: the cost copy is the web app's, in `parent.ts`), plus pure `isPageReadable(legibility)` (`Low` is the only failing verdict) and `isChecked({ legibilityCheckedAt })` -- one sentence per rule and one place the threshold between "readable" and "blurry" is stated.
- `apps/api/src/sourcetest/source-test-policy.spec.ts` -- unit-test `isPageReadable` across all three verdicts and null, and `isChecked` both ways.
- `apps/api/src/sourcetest/source-test.service.ts` -- inject `AiService`; add `checkLegibility(parentAccountId, sourceTestId)` that requires a draft, refuses a zero-`Ready`-page check with `NO_PAGES_TO_SUBMIT`, returns the stored view untouched when `legibilityCheckedAt` is already set, otherwise reads each page's bytes through `storagePathFor`, calls `ai.run` once for the whole batch, validates the payload, and writes every verdict plus `legibilityCheckedAt` in **one transaction** scoped by account and `status: 'Draft'` (a draft that moved under it stores nothing); translate `AiDispatchError` / `AiPayloadError` to a `ServiceUnavailableException(LEGIBILITY_CHECK_FAILED)` and let nothing else be reported as a bad check; clear `legibilityCheckedAt` and every page verdict inside the existing `addPage` / `retakePage` / `deletePage` writes (and **not** in `reorderPages`); extend `submit`'s `updateMany` where-clause with `legibilityCheckedAt: { not: null }` and throw `LEGIBILITY_CHECK_REQUIRED` when the in-transaction read shows it unset; add `countSubmittedIn(parentAccountId, window)` counting `status: 'Submitted'` rows with `submittedAt` in `[start, end)`; extend `viewOf` with the page verdict and `legibilityCheckedAt`.
- `apps/api/src/sourcetest/source-test.controller.ts` -- add `@Post(':id/legibility')` `@HttpCode(HttpStatus.OK)`, behind the same elevation guard, taking no body -- the page set is the request.
- `apps/api/src/sourcetest/source-test.module.ts` -- import `AiModule`. No other module may reach the provider.
- `apps/api/src/allowance/allowance.service.ts` + `allowance.module.ts` -- inject `SourceTestService` (importing `SourceTestModule`, which already exports it) and make the Upload counter `(accountId, window) => this.sourceTests.countSubmittedIn(accountId, window)`, leaving Generation and Explanation at zero; the seam stays the one place any of the three is computed, and no counter column, period column or reset job appears anywhere (AD-14).
- `apps/api/test/harness.ts` -- add `ai_call` to both TRUNCATE lists, a `captureAi(...)` spy mirroring `captureMail` for the upstream-fault case, and a `submitSourceTest`-style fixture helper if the int-spec needs one for the allowance cases.
- `apps/api/test/source-test.int-spec.ts` -- cover every new matrix row end to end: the first check and its single `AiCall` row, the second check writing none, the zero-page refusal, both injected faults leaving nothing stored, the unknown-ordinal payload rejection, the clearing on add/retake/delete and the survival across reorder, the submit refusal before the check, the submit success over a flagged page, the submitted/expired/foreign refusals, and that no `AiCall` row or response body carries bytes.
- `apps/api/test/parent-account.int-spec.ts` -- extend the consumption coverage: `upload.used` reads 1 after a commit, 0 for an abandoned draft, and ignores a Source Test submitted outside the window -- the charge is derived, so this is where "charged once, on success only" is actually proved.
- `apps/web/src/lib/parent-api.ts` -- extend `PageImageView` with `legibility: 'Low' | 'Medium' | 'High' | null`, `SourceTestView` with `legibilityCheckedAt: string | null`, and add `checkSourceTestLegibility(token, id)` through the existing `elevated(token)` builder.
- `apps/web/src/lib/legibility.ts` + `.spec.ts` -- pure `isPageReadable(view)`, `unreadablePages(pages)` returning the flagged ordinals, and `submitBlockedReasons`' third reason `'legibility'` folded in (extend `classification.ts`'s function or re-export through it -- one function decides why submit is refused, never two) -- the web suite has no DOM, so the rules have to be reachable without one.
- `apps/web/src/copy/parent.ts` -- add a `legibility` block to the `capture` namespace: the heading, the per-page `Readable` / `Blurry` badge text, the flag sentence naming the page, the "this is a warning, not a block" sentence, the `Retake page N` and `Continue with all N pages` controls, the cost sentence ("Continuing commits this upload and uses one upload allowance." plus "Nothing is used if you leave without continuing."), the in-flight and failure states, and the third `submitBlocked` reason -- no user-facing string is a hardcoded literal and no figure is stated by the web app.
- `apps/web/src/app/parent/capture/page.tsx` -- add `'check'` to `Pending`; `Check pages` now runs `checkSourceTestLegibility` on the shared `write()` path (strip locked, answer announced from the returned view); once `legibilityCheckedAt` is set, render the result panel above the submit control — every page with its ordinal and its badge as **glyph and text**, each flagged page's `Retake page N` reusing the existing per-page retake input, the advisory sentence, then the cost sentence and a `Continue with all N pages` control that calls `submitSourceTest` and is **never disabled for a flagged page**; a failed check surfaces the stated error with the existing Retry.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- cover the new copy functions and the new pure rules; keep the existing `PageStrip` and classification coverage intact.
- `e2e/tests/parent-capture.spec.ts` -- add a case driving the whole flow in the browser with a deliberately tiny page and a normal one: check runs once and names the blurry page, the retake control is scoped to it, the cost sentence is on screen before the commit control, continuing commits, and the submitted view stands. Update the existing tests that click `Check pages` and expect an immediate commit to pass through the check step, and extend the direct-to-API test with the pre-check submit refusal -- the outermost surface the intent references is the parent's screen, and the API refusal has to hold for a caller that never saw it.

**Acceptance Criteria:**
- Given a draft whose capture has finished, when the parent runs the page check, then every page reports its own readability verdict rather than a single pass/fail for the test, exactly one provider call is made for the whole batch, and running the check again reports the same verdicts without a second provider call.
- Given a page the check flagged, when the parent looks at the result, then that page is named, a retake offered for that page alone, and the screen says plainly that continuing anyway is allowed — and continuing is accepted by the server.
- Given a checked draft, when the parent is asked to continue, then the screen states beforehand that continuing commits the Source Test and uses one Upload Allowance, and that leaving without continuing uses nothing.
- Given the same account, when a Source Test is committed, then its Upload usage reads one for the period; when a draft is abandoned instead, or a commit is refused, then Upload usage reads zero and no counter column or charge row exists anywhere to be reconciled.
- Given a submission attempted straight against the API before the check has run, then it is refused with the reason stated and the Source Test stays a draft.

## Spec Change Log

- 2026-09-26 (`/bmad-loop-resolve`, human-decided): this spec is committed but **its implementation is not on disk**. Verified: no `apps/api/src/sourcetest/legibility.ts`, and no `_add_ai_call_and_page_legibility` migration — the only `AiCall` migration is `20260924111509_add_ai_call_and_extraction`, written later by Story 3.5. The spec rode into 3.5's commit (`68c702b`) without its code, so a present spec is not evidence of a done story. `sprint-status.yaml` correctly lists this story as `backlog`.

  The dev session's tree was preserved at `refs/attempt-preserve-dirty/20260923-210321-45b5-9ce972f1-2` (`ef7d6f2`, 33 files, +3317/-90) — but it is parented on this spec's `baseline_revision` (`9ce972f`, Story 3.3), which is now **11 commits behind** HEAD. Do **not** restore it with `git checkout <ref> -- .`: that would clobber Stories 3.5, 3.6 and all of Epics 4-5. Apply it as a diff and expect conflicts, because Story 3.5 rewrote files this snapshot also edits (`apps/api/prisma/schema.prisma`, `apps/api/src/ai/ai.service.ts`, `apps/api/src/sourcetest/page-ingest.service.ts`):

  ```
  git diff 9ce972f refs/attempt-preserve-dirty/20260923-210321-45b5-9ce972f1-2 | git apply -3
  ```

  The snapshot is **unverified** — the session timed out mid-dev, no Verification command was confirmed green and no review pass ran. Treat it as an in-progress tree and as evidence of intent where it conflicts; this spec's own contract stays authoritative. Queue order for the three stories in this state: this story and 3.1 first, then 5.3, then 5.4.

## Review Triage Log

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 6, low 4)
- defer: 7: (high 0, medium 4, low 3)
- reject: 11: (high 0, medium 3, low 8)
- addressed_findings:
  - `[medium]` `[patch]` `checkLegibility`'s two in-transaction abort branches fell through to a 200 carrying an unchecked view, so the screen announced "the pages were checked" when nothing was stored. The transaction now reports whether it wrote, and a non-write answers the same retryable 503 `LEGIBILITY_CHECK_FAILED` as every other nothing-was-stored path. Two int-spec cases added.
  - `[medium]` `[patch]` The in-transaction re-assert compared ordinals alone, so a retake while the provider call was in flight kept the ordinal set identical and filed verdicts about bytes nobody judged. Replaced with a `pageSetStamp` over `{id, ordinal, updatedAt}` of the `Ready` rows, captured before the call and re-read inside the write. Int-spec drives a real mid-flight retake.
  - `[medium]` `[patch]` `addPage` and `retakePage` cleared the check in a transaction separate from the one that flipped the page to `Ready`; a concurrent `submit` in that window passed both submit gates and committed an unchecked page set. `storeBytes` now takes `clearCheckFor` and does both in one transaction, as `deletePage` already did.
  - `[medium]` `[patch]` The commit control rendered `capture.submitting`, which now reads "Checking…", so the button said "Checking…" while it committed. Added `capture.legibility.committing` and used it.
  - `[medium]` `[patch]` `countSubmittedIn` filters `parentAccountId + status + submittedAt` on every `consumptionFor` with no supporting index. Added `@@index([parentAccountId, status, submittedAt])` on `SourceTest` and the `CREATE INDEX` to the migration; replayed the chain into a fresh database.
  - `[medium]` `[patch]` The Upload charge was evidenced only at the row surface — the new cases seeded `Submitted` rows with Prisma. Added a case driving the real routes (draft, classify, add page, check, submit) that asserts `upload.used` is 0 after the check alone and 1 after the commit, and still 1 after a refused second submit.
  - `[low]` `[patch]` `fakeLegibilityPayload` read `AI_FAKE_UNREADABLE_BYTES` eagerly at factory time on every call, including under `AI_TRANSPORT=openai`, so a malformed override surfaced as a 500 rather than the documented per-call read. Moved the read inside the returned builder.
  - `[low]` `[patch]` `clearCheck` was the only write in the module scoped by neither `parentAccountId` nor `status: 'Draft'`. Threaded the account id through all three callers and scoped both statements.
  - `[low]` `[patch]` `.env.example` documented no `AI_MODEL_LEGIBILITY` / `AI_PRICE_LEGIBILITY_IN` / `_OUT` override, unlike every other wired call class, although this story is what puts `Legibility` into use. Added all three.
  - `[low]` `[patch]` Removed the dead `SubmitGateView` export and the leftover `void first;` in the reorder int-spec case.

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 1: (high 0, medium 0, low 1)
- reject: 10: (high 0, medium 1, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `checkLegibility` never asserted classification, so a direct call could spend a real provider call checking an unclassified draft's pages — unlike `submit`, which re-asserts every gate server-side. Added the same classification gate (`CLASSIFICATION_REQUIRED_FOR_CHECK`) right before the batch is priced, after the existing page-count gate so the "no pages" refusal keeps its own message. 15 existing int-spec cases updated to classify first; one new case added for the direct-call refusal.
  - `[medium]` `[patch]` The in-transaction compare-and-set's mismatch branch always answered the generic retryable 503, even when the mismatch was itself caused by a concurrent request for the same page set winning the race and storing first — the loser was told the check failed when in fact a check (its own verdicts, since the page set never moved) had just been stored. On a mismatch, the row is now re-read; an already-checked result is answered as success, and only a genuinely nothing-stored state still throws. One int-spec case added driving the concurrent-winner path.

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 2: (high 0, medium 1, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` The controller doc comment on `POST :id/legibility` overclaimed "a double tap is not a double charge" — true only for sequential re-runs, not for two genuinely concurrent requests, which can each dispatch a provider call before either sees the other's write. Reworded to state the sequential guarantee precisely and note the concurrent case as a deferred cost-control gap.
  - `[low]` `[patch]` `capture.legibility.flagged(ordinals)` in `apps/web/src/copy/parent.ts` rendered `"Pages  and undefined may be too blurry to read."` if ever called with an empty array; the only call site guards against it today, but the helper itself did not. Added an explicit empty-array branch.


## Design Notes

**Why the charge needs no charge.** FR-31 charges on successful production, and AD-14 makes usage derived. A Source Test reaches `Submitted` in exactly one transaction, so counting Submitted rows in the window *is* the charge: it cannot double-charge a retry, cannot charge an abandoned draft, and cannot leave "job succeeded, debit did not" reachable, because there is no debit. That is why this story adds no `charged` column and no allowance write.

**Why the check is cleared by a page-set change but not by a reorder.** The verdicts hang off `PageImage` rows, so moving ordinals moves the verdicts with them and the batch still covers exactly the pages it ran over. Adding or deleting a page changes the set, and a retake changes the bytes under a verdict — in all three cases the stored result no longer describes what would be committed, so it is cleared and the check is re-run. This is what lets the result's own "Retake page 2" action be honest without ever re-running the check per page.

**Why submit gates on the check having run, not on its verdict.** The epic requires the check to happen before the commit and requires proceeding over a failure to be allowed. Gating on `legibilityCheckedAt` being non-null delivers both: the client cannot skip the step, and no verdict ever blocks. `Low` is a warning; it is never a refusal.

**Why the fake decides by byte size.** AD-22 makes the `ai` boundary the only nondeterminism seam, and every tier below the live suite runs on the fake — so the fake needs a rule a test can arrange for without reaching into it. A stored page under a stated byte threshold reads as `Low`: the int-spec and the E2E suite both arrange a flagged page by uploading a tiny image, and neither needs an env toggle or a per-test script to do it.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev --name add_ai_call_and_page_legibility` -- expected: a new checked-in migration directory; `prisma migrate deploy` replays it clean.
- `pnpm typecheck` -- expected: no errors in either workspace.
- `pnpm --filter api run lint` and `pnpm --filter web run lint` -- expected: clean, `jsx-a11y` included.
- `pnpm test` -- expected: the new `ai-config.spec.ts`, `ai.service.spec.ts`, `legibility.spec.ts` (both workspaces) and the extended policy spec pass with the rest.
- `pnpm --filter api run test:int` -- expected: `source-test.int-spec.ts` and `parent-account.int-spec.ts` pass against real Postgres, every new matrix row covered.
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- expected: passes against the full stack with the default `fake` transport.
- `pnpm exec prettier --write .` -- expected: clean tree before commit.

## Auto Run Result

**Summary:** Follow-up review pass (already `status: done` from a prior session; re-reviewed per `bmad-build-auto`'s `done` re-entry rule). Diff since `baseline_revision` reviewed by four parallel layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Two low-severity findings patched; two residual risks added to `deferred`; nine findings rejected as non-issues, spec-conformant by design, or unfounded on inspection.

**Files changed this pass:**
- `apps/api/src/sourcetest/source-test.controller.ts` -- corrected a doc-comment overclaim about the legibility endpoint's concurrent-request cost guarantee.
- `apps/web/src/copy/parent.ts` -- `capture.legibility.flagged` now guards the empty-ordinals case instead of relying solely on its one call site.

**Review findings breakdown:** patch 2 (low 2), defer 2 (medium 1, low 1), reject 9 (retryable-503 fault conflation, `isPageReadable` duplication across API/web, a `viewOf(row)` call shape concern disproven by reading `checkLegibility`'s neighbors, an already-covered throttle/rate-limit concern, a cross-module import-cycle concern disproven by reading `extraction.module.ts`, a missing MAX_PAGES-boundary test, an accessibility live-region concern, a gate-ordering question the author already reasoned about, and a `pageSetStamp` timestamp-precision edge case with no realistic trigger).

**Follow-up review recommendation:** `false`. This pass's own patched findings: 0 high, 0 medium, 2 low → score `3*0 + 1*2 = 2` (< 5), no high-severity patch.

**Verification performed:**
- `pnpm typecheck` -- clean, both workspaces.
- `pnpm --filter api run lint` / `pnpm --filter web run lint` -- clean.
- `pnpm test` (unit) -- clean via split runs: `apps/api` `vitest run src` 439/439, `apps/web` 633/633. The combined `pnpm test` (which also runs `apps/api`'s int-specs in the same process as unit specs) hit the pre-existing flaky-harness failures already recorded in this spec's `deferred` list (item: "combined `pnpm test` run is flaky") -- reproduced again this pass in specs the diff does not touch (`practice-test.int-spec.ts`), confirming it as the same known issue, not a regression.
- `pnpm --filter api run test:int` -- `source-test.int-spec.ts` (88/88) and `parent-account.int-spec.ts` (33/33) pass clean when each is run alone under a single worker (`--pool=forks --poolOptions.forks.singleFork=true`), avoiding the same harness contention. Every new I/O-matrix row is covered.
- `pnpm --filter api exec prisma migrate deploy` -- all 15 migrations, including this story's, replay clean against a fresh database.
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- **could not run to completion in this environment.** Port 3001 (this suite's fixed `API_PORT`) was already bound by an unrelated project's server (`n-electric`'s `apps/api/dist/main`) on this machine, so Playwright's `reuseExistingServer` attached to the wrong process and every test timed out waiting on the sign-up form. Retried with `API_PORT=3011`, but `apps/web`'s `NEXT_PUBLIC_API_URL` is inlined at Next.js build time and defaults to `localhost:3001`, so the web app kept calling the wrong server under the new port too, and every test failed identically at the same first step (`Create account` never leaves disabled) -- an environment port collision unrelated to this repo or this diff, not a code defect. Did not kill the unrelated process, since it belongs to a different project's session. Not re-verified against port 3001 since that port remained occupied by the other project for the duration of this pass.
- `pnpm exec prettier --write .` -- clean tree, no changes needed beyond this pass's own two edits.

**Residual risks:**
- E2E could not be exercised this pass for the reason above; the two lower tiers (unit, integration) plus a clean migration replay are the verification evidence for this pass. Re-run `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` once port 3001 is free, or export a matching `NEXT_PUBLIC_API_URL` and rebuild `apps/web` before overriding `API_PORT`.
- The concurrent double-provider-call and non-`CONCURRENTLY` migration index risks are recorded in `deferred` for future attention; neither blocks this story.

