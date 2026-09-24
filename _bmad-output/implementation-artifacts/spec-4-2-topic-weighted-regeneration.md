---
title: 'Story 4.2: Topic-Weighted Regeneration'
type: 'feature'
created: '2026-09-25'
status: 'done'
baseline_revision: '44bd303e8f24aa7e2124827024e080d6c148a2f7'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-practice-test-generation-bounded-priced-async.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A weighted job whose stored Topic has since vanished from the Extraction spends the
      whole AI_MAX_ATTEMPTS budget reaching an unsatisfiable floor.
    evidence: |-
      `planFor` takes `weightedTopic` from the job row by design, and the Design Notes argue
      against re-resolving it against the run's own Extraction read. Neither addresses the
      case where the label is no longer there: the prompt then names a Topic absent from the
      topic list, no payload can meet the floor, and every attempt is a paid provider call
      spent to be refused. A `GenerationTargetMissing`-style early bail would cost one read.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (planFor)
    severity: medium
  - summary: >-
      "A weighted draft still covers the Extraction's other Topics" is instructed in the
      prompt but enforced nowhere and asserted by no test.
    evidence: |-
      `validateGenerationPayload` checks only the floor, so a draft putting every question on
      the weighted Topic passes. `fakePracticeTestPayload` spreads the remainder, so the
      integration tier cannot surface it either. Enforcing it in code needs a rule that does
      not false-reject a single-Topic Extraction, which is a product decision rather than a
      mechanical fix.
    location: >-
      apps/api/src/practicetest/practice-test-payload.ts (validateGenerationPayload)
    severity: low
  - summary: >-
      The parent-facing weighted control shipped on the generate screen, while the UX design
      sites weighted regeneration inside the Epic 7 Topic drill-down with the Topic
      pre-selected.
    evidence: |-
      UX decision Q12c states weighted regenerate lives in the Topic drill-down and that there
      is no duplicate entry point in v0. This story's picker browses all Extraction Topics from
      the generate screen and needs a `GET …/practice-tests/topics` route that the drill-down
      caller will never use, since it already holds the Topic. Epic 7 has to reconcile the two
      surfaces — keep both deliberately, or retire this one when the drill-down ships.
    location: >-
      apps/web/src/app/parent/generate/[sourceTestId]/page.tsx
    severity: medium
  - summary: >-
      The integration tier fails roughly one full run in two, in a different untouched file
      each time, with a parent account vanishing mid-test.
    evidence: |-
      Observed across five full `pnpm --filter api test` runs on this branch, failing in
      extraction, source-test, uncommitted-state and practice-test in turn and passing clean
      once. `practice-test.int-spec.ts` passes 47/47 in isolation on three consecutive runs.
      Same signature already recorded as deferred in Story 4.1; pre-existing cross-file
      harness isolation, not caused by this change.
    location: >-
      apps/api/test/harness.ts
    severity: medium
  - summary: >-
      `pnpm lint` cannot run in this environment, so the lint half of every spec's
      verification section is unverifiable.
    evidence: |-
      `pnpm lint` exits with `Command "eslint" not found`. Pre-existing and already noted in
      Story 4.1's run; formatting is still verified through `prettier --check`.
    location: >-
      package.json (lint script)
    severity: low
  - summary: >-
      The generate screen's tests verify almost entirely by grepping the page's own source text
      rather than rendering it, so a broken wiring that merely contains the right tokens would
      still pass.
    evidence: |-
      `page.spec.tsx` has no React Testing Library usage anywhere in the directory; nearly every
      assertion is `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. This
      predates this story and spans the whole file, including the new Topic-weighting behavior
      added here (e.g. the 409-degrade-to-empty-topics branch), so this story's own new UI logic
      inherits the same untested-at-runtime gap as the rest of the screen.
    location: >-
      apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx
    severity: medium
  - summary: >-
      Nothing bounds how many Topic radio options the generate screen renders.
    evidence: |-
      Topic labels are raw and never canonicalized, merged or deduplicated beyond exact-match
      normalization (AD-11), unlike `count`, which is clamped by `MAX_PER_REQUEST`. An Extraction
      with many distinct raw/OCR-noisy Topic labels could render an unbounded radio group with no
      discussed ceiling or scroll/collapse treatment.
    location: >-
      apps/web/src/app/parent/generate/[sourceTestId]/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent who has watched a child miss everything on one Topic can only generate another evenly-spread Practice Test — nothing lets them aim generation at that Topic, and nothing in the generation request, the job row, the prompt or the post-hoc pass can even carry the idea of a weighted Topic.

**Approach:** Add an optional weighted Topic to the existing generation request: the parent picks one of the Source Test's own Extraction Topics (or none, which is exactly today's behaviour), the server resolves it against the Extraction, persists it on the `GenerationJob`, tells the prompt to concentrate the draft on it, and a new deterministic post-hoc rule rejects a draft that did not. Bounding, server-side clamping, pricing, charging, async progress and retry-without-re-upload are Story 4.1's and are reused untouched.

## Boundaries & Constraints

**Always:**
- Weighted generation runs from the persisted Extraction of the originating Source Test — the same `readForGeneration` read, no new upload, no page image bytes, no storage path.
- The weighted Topic must be one the Extraction actually carries. The server resolves the client's string against the Extraction's own labels (case- and whitespace-insensitive) and persists **the Extraction's spelling**, never the client's.
- Bounded, clamped and priced identically to Story 4.1: the same `clampCount`/`remainingFor`, the same `MAX_PER_REQUEST`, the same charge-on-land with `chargedAt`, the same cost sentence. Weighting changes what is generated, never what it costs.
- "Predominantly" is a figure in `practice-test-policy.ts` and is enforced in code after the payload parses (AD-30): a weighted draft carries at least `weightedTopicFloor(total)` questions labelled with the weighted Topic. A payload below the floor is an **upstream** fault, so `produceDraft` re-issues the call under the existing `AI_MAX_ATTEMPTS` budget.
- A weighted draft still covers the Extraction's other Topics with the questions above the floor, still reproduces the computed format mix, and is still held to every Story 4.1 post-hoc rule (material difference, one correct choice, structured fractions, rich text, ceilings).
- The weighted Topic travels on the job view so a parent returning to the URL reads the request they actually made.
- The fake transport honours the weighting, so the integration tier proves the rule rather than working around it.
- No allowance figure, tier label, model name or fragment of generated content leaves this module in a log line, a failure reason or an error message. A Topic label is parent- and content-adjacent: it is never written into a log line either.

**Block If:**
- The Extraction exposes no Topic labels at all for a Source Test the product otherwise considers generatable (would make the weighted picker unreachable in a way the intent does not describe).

**Never:**
- No Analytics dashboard entry point and no missed-question drill-down entry point — those are Epic 7's (FR-11, FR-29). This story ships only the capability and its one parent-facing control on the generate screen.
- No Topic canonicalization, merging, deduplication or Mastery coupling — Topic labels stay raw (AD-11, Epic 7).
- No second endpoint, job table, worker or charging path. Weighting is a field on the request that already exists.
- No weighting of more than one Topic, no numeric weight or percentage chosen by the parent, and no re-pricing of a weighted request.
- No draft-review, editing, release or timer surface (Stories 4.3–4.6).
- No change to what Story 4.1 already ships for an unweighted request: an unweighted request must produce byte-for-byte the same prompt and pass the same checks it does today.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Weighted request accepted | `POST /parent/source-tests/:id/practice-tests` `{count: 2, weightedTopic: 'fractions'}`, Extraction carries `Fractions` | 202 with the job view; row holds `weightedTopic: 'Fractions'` (the Extraction's spelling) and `requestedCount: 2` | No error expected |
| Unweighted request unchanged | `{count: 2}` | 202, `weightedTopic: null`, prompt and validation identical to Story 4.1 | No error expected |
| Unknown Topic | `{count: 1, weightedTopic: 'Astrophysics'}` on an Extraction without it | Request refused, nothing enqueued, nothing charged | 409 `WEIGHTED_TOPIC_UNKNOWN` |
| Blank/oversized Topic string | `weightedTopic: ''` or >200 chars | Refused before any row is read | 400 from `class-validator` |
| Weighted request over allowance | `{count: 5, weightedTopic: 'Fractions'}`, 2 remaining | Clamped to 2 exactly as unweighted; weighting is irrelevant to the clamp | No error expected |
| Weighted request with no allowance | 0 remaining | Refused, nothing enqueued | 409 `NO_GENERATION_ALLOWANCE` |
| Draft under the floor | Payload where fewer than `weightedTopicFloor(total)` questions carry the weighted Topic | Draft rejected, call re-issued up to `AI_MAX_ATTEMPTS` | `GenerationPayloadInvalid(WEIGHTED_TOPIC_UNDERWEIGHT)`, upstream fault, job retryable |
| Floor exhausted | Every attempt under the floor | Job ends `Failed` (or `PartiallyComplete` if earlier drafts landed), landed drafts stay charged, Source Test intact and retryable without re-upload | Failure reason is the existing `GENERATION_FAILED` constant |
| Topic label case/spacing drift | Generated label `'  fractions '` against weighted `'Fractions'` | Counts toward the floor (normalized comparison) | No error expected |
| Single-Topic Extraction | Extraction carries one Topic, weighted on it | Every question is on it, floor trivially met | No error expected |
| Returning parent | `GET …/practice-tests/job` after a weighted request | Job view carries `weightedTopic`, and the screen names the Topic in progress copy | 404 when nothing was ever requested |
| Topics read | `GET /parent/source-tests/:id/practice-tests/topics` | The Extraction's Topic labels, de-duplicated, in first-appearance order | 404 foreign/unknown id; 409 when the Extraction is not ready or holds nothing usable |

</intent-contract>

## Code Map

**Change these (all of Story 4.1's mechanism is reused; these are the seams weighting threads through):**

- `apps/api/prisma/schema.prisma:787` `GenerationJob` -- add `weightedTopic String?` with a `///` comment stating it holds the Extraction's own spelling and is null for an unweighted request. No new model, no new index (the two existing indexes still serve the claim and the progress read).
- `apps/api/prisma/migrations/` -- one new migration beside `20260924170321_restrict_practice_test_source_test_delete/`; a nullable column, so no backfill.
- `apps/api/src/practicetest/practice-test-policy.ts` -- the four-section layout (constants :17, messages :57, runtime :144, rules :215). Add `WEIGHTED_TOPIC_SHARE` + `weightedTopicFloor(total)` beside `formatTargets` :262, `normalizeTopicLabel(label)` beside `remainingFor` :226, `MAX_TOPIC_LABEL_LENGTH` mirroring `MAX_LABEL_LENGTH` (`practice-test-payload.ts:66`), and the `WEIGHTED_TOPIC_UNKNOWN` refusal in the messages section next to `NO_USABLE_QUESTIONS` :86.
- `apps/api/src/practicetest/practice-test.service.ts` -- `request()` :211 (resolve the weighted Topic against `extraction.questions[].topics` **before** the transaction, refuse an unknown one, write it on the job), `JOB_VIEW_FIELDS` :742 / `JobRow` :753 / `viewOf` :764 / `GenerationJobView` :134 (carry it), `ClaimedGenerationJob` :106 + `claimNext` :342 select (carry it into the run), `planFor` :794 / `GenerationPlan` :787 (carry it into the plan), `produceDraft` :418 (thread it into `buildGenerationPrompt`, `validateGenerationPayload` and `fakePracticeTestPayload`). `land()` :530, `complete()` :628, `fail()` :663 and the fence are untouched.
- `apps/api/src/practicetest/practice-test-prompt.ts:32` `GenerationPromptInput` / `buildGenerationPrompt` :52 -- add an optional `weightedTopic` and, when present, a stated minimum count on that Topic; the rules block :67 and the source listing :74 stay as they are. The `topics` field's comment at :37 already anticipates this.
- `apps/api/src/practicetest/practice-test-payload.ts` -- add `weightedTopic`/`weightedFloor` to `GenerationExpectation` :90, a `WEIGHTED_TOPIC_UNDERWEIGHT` constant beside `TOPIC_REQUIRED` :44, and the count in `validateGenerationPayload` :155 using the already-trimmed `topics` :190 and the policy's normalizer. The format-mix comparison :235 is the precedent for a whole-payload check made after the walk.
- `apps/api/src/practicetest/practice-test-schema.ts:87` `fakePracticeTestPayload` -- accept an optional `weightedTopic` and assign it to the first `weightedTopicFloor(total)` questions, cycling the remaining Topics for the rest, so the fake satisfies the rule it is tested against. The `draftOrdinal` material-difference trick :104 must survive unchanged.
- `apps/api/src/practicetest/dto/practice-test.dto.ts` -- add `weightedTopic?: string` with `@IsOptional() @IsString() @IsNotEmpty() @MaxLength(...)`. Shape only: whether the Topic exists is a row-dependent rule the service decides, exactly as the file's own comment says of `count`.
- `apps/api/src/practicetest/practice-test.controller.ts:63` `request` -- pass the new field through; add `GET source-tests/:id/practice-tests/topics` beside the job route :75, same guard, same 404-not-403 rule (AD-18).
- `apps/api/src/extraction/extraction-reader.ts:44` `ExtractionForGeneration` -- unchanged; `questions[].topics` :36 is already the only Topic source and `readForGeneration` is already the only read.
- `apps/api/src/practicetest/practice-test-policy.spec.ts`, `practice-test-payload.spec.ts` -- the existing unit tiers to extend.
- `apps/api/test/practice-test.int-spec.ts` -- the integration tier; drives `practiceTestRunner.runOnce()` via `createHarness()` (`apps/api/test/harness.ts:78,105`).
- `apps/web/src/lib/parent-api.ts:195` `GenerationJobView` (add `weightedTopic: string | null`), `startGeneration` :695 (optional Topic in the body), and a new `generationTopics` beside `generationJob` :708.
- `apps/web/src/lib/practice-test-count.ts` -- pure, DOM-free rules module; add nothing unless a rule is genuinely needed (the Topic list arrives ready from the API).
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` -- the picker section :391 (add an optional Topic `RadioGroup` below the count group, defaulting to "all topics", following the `COUNT_LEGEND_ID`/`COUNT_REASON_ID` labelling pattern :42-54 and `density.tapTarget` :435), the load effect :137 (fetch Topics alongside the allowance and job), `startGeneration` :277 (send the Topic), and the progress line :366 (name the Topic when the job carries one). The cost sentence :317 must not change.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx` -- the screen's existing test tier.
- `apps/web/src/copy/parent.ts:353` `generate` block -- add the Topic legend, the "all topics" option label, the per-Topic option label and the weighted progress sentence. Every string parameterized; no hardcoded literal in the component.
- `e2e/tests/parent-practice-test.spec.ts` -- the browser pass to extend with a weighted request.

**Read-only evidence (do not change):**
- `apps/api/src/practicetest/practice-test.service.ts:530` `land()` and :612 the fence — charging and incremental commit are Story 4.1's and are correct as they stand.
- `apps/api/src/allowance/allowance.service.ts` — usage stays derived from `chargedAt` (AD-14); weighting never touches it.
- `apps/api/src/extraction/*` — `practicetest` reads through `EXTRACTION_READER` only, never a Prisma delegate (AD-17).

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` + a new migration -- add nullable `GenerationJob.weightedTopic` -- the weighted Topic has to outlive the request that enqueued the job, because the run happens later and the progress read happens later still.
- `apps/api/src/practicetest/practice-test-policy.ts` -- add `WEIGHTED_TOPIC_SHARE`, `weightedTopicFloor(total)`, `normalizeTopicLabel(label)`, `MAX_TOPIC_LABEL_LENGTH` and the `WEIGHTED_TOPIC_UNKNOWN` refusal -- "predominantly" is a product figure and must exist in exactly one place, and the request-time resolve and the post-hoc count must agree on what makes two labels the same label.
- `apps/api/src/practicetest/dto/practice-test.dto.ts` -- add an optional, non-empty, length-bounded `weightedTopic` -- shape only; existence against the Extraction is row-dependent and belongs in the service.
- `apps/api/src/practicetest/practice-test.service.ts` -- resolve the weighted Topic against the Extraction in `request()` and refuse an unknown one; persist and surface it; carry it through `ClaimedGenerationJob`, `claimNext`, `GenerationPlan` and `produceDraft` into the prompt, the fake and the validator -- the clamp, the charge and the fence must stay exactly as they are, since the story's own criterion is that a weighted request is priced identically.
- `apps/api/src/practicetest/practice-test-prompt.ts` -- state the weighted Topic and its minimum count when one is present, leaving the unweighted prompt byte-for-byte as it is -- the prompt and the post-hoc rule are two halves of one rule, and an unweighted request must not regress.
- `apps/api/src/practicetest/practice-test-payload.ts` -- add `WEIGHTED_TOPIC_UNDERWEIGHT` and the floor check over the whole payload -- a model told to concentrate on a Topic still sometimes spreads evenly, and only a check in code makes the criterion true.
- `apps/api/src/practicetest/practice-test-schema.ts` -- weight the fake payload's Topic assignment when a weighted Topic is given -- otherwise the integration tier could only prove the rule by disabling it.
- `apps/api/src/practicetest/practice-test.controller.ts` -- thread the field through `request`, and add `GET /parent/source-tests/:id/practice-tests/topics` -- the parent cannot choose a Topic the screen has no way to list, and the list must come from the same Extraction the job will read.
- `apps/api/src/practicetest/practice-test-policy.spec.ts` + `practice-test-payload.spec.ts` -- unit-cover every I/O matrix row that is a pure rule: the floor at several totals, label normalization drift, under-floor rejection, single-Topic and unweighted passthrough.
- `apps/api/test/practice-test.int-spec.ts` -- integration-cover the weighted request end to end: resolution to the Extraction's spelling, the unknown-Topic 409, clamping and charging identical to unweighted, the Topics route, and a weighted job whose drafts satisfy the floor.
- `apps/web/src/lib/parent-api.ts` -- add `weightedTopic` to `GenerationJobView`, accept it in `startGeneration`, add `generationTopics` -- every figure and every label the screen shows arrives from the API.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` + `page.spec.tsx` -- add the optional Topic group (default "all topics"), send the choice, and name the Topic in the progress line when the job carries one -- this is the story's only entry point, and it must not disturb the cost sentence or the count group.
- `apps/web/src/copy/parent.ts` -- add the Topic legend, option labels and weighted progress sentence -- parameterized strings only, third person about the student, no upsell.
- `e2e/tests/parent-practice-test.spec.ts` -- extend with a weighted pass: pick a Topic, read the unchanged cost, confirm, and see the drafts land.

**Acceptance Criteria:**

- Given a submitted Source Test with a completed Extraction, when the parent opens the generate screen, then the Extraction's Topics are offered as an optional weighting alongside an "all topics" default, and choosing one does not change the stated cost.
- Given a weighted request, when the API accepts it, then the persisted `requestedCount` is `clampCount(requested, remaining)` and the charge per landed draft is identical to an unweighted request of the same count.
- Given a weighted request naming a Topic the Extraction does not carry, when the API receives it, then it is refused, no `GenerationJob` row exists, and no Generation Allowance is consumed.
- Given a weighted job, when each draft lands, then at least `weightedTopicFloor(questionCount)` of its questions carry the weighted Topic, and the draft still matches the computed format mix and reproduces no source prompt.
- Given a weighted request, when it is generated, then it reads the originating Source Test's persisted Extraction and no new upload is required at any point.
- Given a parent who leaves and returns to the generate URL during a weighted job, then the progress read names the Topic the job was requested with.
- Given an unweighted request, when it is generated, then its prompt, validation and stored rows are unchanged from Story 4.1.
- Given any log line, failure reason or error message produced by a weighted job, then it carries identifiers and counts only — no Topic label and no fragment of a generated question.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 15: (high 0, medium 5, low 10)
- defer: 5: (high 0, medium 3, low 2)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` The topics read joined the generate screen's load with no 409 tolerance, so an upload whose Extraction is not ready or holds nothing usable collapsed a screen that previously rendered — now caught and degraded to an empty Topic list, with a page-spec case.
  - `[medium]` `[patch]` Two Extraction labels differing only by case were offered as separate options but both resolved to the first spelling, making the second unselectable — the offered list is now de-duplicated by `normalizeTopicLabel`, so the list and the resolver search the same list.
  - `[medium]` `[patch]` The weighted prompt told the model to give the remaining questions to "the other topics below" and then printed the weighted Topic among them — the weighted label is now filtered out, and a single-Topic Extraction gets its own sentence instead of a dangling instruction.
  - `[medium]` `[patch]` `weightedTopic` and `weightedFloor` were independently optional, so a caller passing the Topic without the floor silently disabled the rule with no type error — replaced by one `GenerationWeighting { topic, floor }` built only through `weightingFor`.
  - `[medium]` `[patch]` The whole parent-facing tier was source-grep only: dropping the Topic argument at the `startGeneration` call site, or rewriting `progressWeighted` to omit the Topic, left the suite green — the e2e now reads the stored `weightedTopic` and the landed question Topics back from the server, and `progressSentence` moved into the DOM-free rules module with output-level tests.
  - `[low]` `[patch]` `topicsFor()` was inserted between `request()`'s JSDoc and `request()`, orphaning it — moved back, and `topicsFor()` given its own.
  - `[low]` `[patch]` The refusal-order comment no longer matched the code once the Topic resolve moved ahead of the allowance read — precedence chosen deliberately (unknown Topic wins), documented, and pinned by an int case.
  - `[low]` `[patch]` The fake's `restTopics` filtered with `!==` while both real halves normalized, letting a case-variant of the weighted Topic sit in the "other topics" pool and be counted as on-topic — now folded with the same normalizer.
  - `[low]` `[patch]` `weightedTopic` was length-checked before trimming, so a padded genuine 200-character label 400'd and a whitespace-only value refused as an unknown Topic — a `@Transform` trim now runs first, with int cases for both.
  - `[low]` `[patch]` The e2e interpolated an OCR'd Topic label into a CSS attribute selector — now located by `data-testid` and compared in JS.
  - `[low]` `[patch]` The topics route's `EXTRACTION_NOT_READY` branch was uncovered although the matrix names both 409s — case added.
  - `[low]` `[patch]` `normalizeTopicLabel`'s `NFKC` step was unpinned and could have been deleted silently — case added over full-width, non-breaking-space and ligature input.
  - `[low]` `[patch]` `underweightCalls` and `malformFirst` restored a bound wrapper rather than the original property, accumulating binding layers across uses — both now capture and restore the property.
  - `[low]` `[patch]` `extraction.int-spec.ts`'s captured-call assertion had been weakened to `objectContaining` to admit the new `prompt` field — the full key set is pinned again.
  - `[low]` `[patch]` `topicHint` did not say what was unchanged — it now names the Generation Allowance, consistent with `cost`/`costUnlimited`.

### 2026-09-25 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 3: (high 0, medium 2, low 1)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` The "de-duplicated, in first-appearance order" topics-route test asserted only length and set-uniqueness, never order — now pins the exact array the fake Extraction's usable questions produce.
  - `[low]` `[patch]` `done`/`partial` progress copy named the weighted Topic only while a job was in progress; a parent returning after `Succeeded`/`PartiallyComplete` saw no Topic in the outcome line — both now take an optional Topic and name it, with a page-spec case and an updated announcement-wiring assertion.
  - `[low]` `[patch]` The oversized-Topic-label int case hardcoded `'x'.repeat(201)` instead of deriving it from `MAX_TOPIC_LABEL_LENGTH + 1` — now derived, so it stays a real one-over-the-limit case if the constant changes.
  - `[low]` `[patch]` `malformFirst` and `underweightCalls` in `practice-test.int-spec.ts` each hand-rolled the identical `ai.run` wrap/restore-the-property seam — factored into one shared `wrapAiRunForCalls`, so a future fix to that seam is made once.
  - `[low]` `[patch]` A test titled "...and in no log line" asserted only on the prompt, never on log output — retitled to match what it actually verifies; log-freedom was independently confirmed by reading every `practice-test.service.ts` logger call site, none of which interpolate a Topic label.

### 2026-09-25 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 17: (high 0, medium 0, low 17)
- addressed_findings:
  - `[medium]` `[patch]` `weightedCoverage` told the model to "give the remaining questions to the other topics below" whenever the Extraction carried more than one Topic, even when `weightedTopicFloor(total)` already equals `total` (total 1 or 2) and zero questions remain — the instruction contradicted the floor line above it. Added a `weighting.floor >= total` branch with its own sentence, adjusted the existing "offers the other topics" case to a count where questions genuinely remain (3, not 1), and added a case pinning the new branch on a 2-question, 2-Topic Extraction.
  - `[low]` `[patch]` No test exercised the DTO's documented trim-before-length ordering (`practice-test.dto.ts`'s own comment states a genuine `MAX_TOPIC_LABEL_LENGTH`-character label with incidental whitespace must be accepted, not refused) — added an int case that pads a real Topic label well past the limit and asserts `202` with the trimmed label persisted.

## Design Notes

**Why the weighted Topic is a field on the existing request rather than a second route.** The acceptance criterion is that weighted generation is "bounded, clamped, and priced identically to Story 4.1". A second route would be a second place where the clamp, the cost statement, the charge and the fence are written — and two copies of a charging rule is exactly the failure this epic cannot afford. One request with an optional field means the identity is structural rather than asserted.

**Why the Extraction's spelling is persisted, not the client's.** The floor is counted by comparing generated Topic labels against the weighted one, and the prompt asks the model to write Topics "in the same words it is given here" (`practice-test-prompt.ts:64`). Persisting what the client typed would put a third spelling into that loop. Resolution happens once, at request time, against the same `readForGeneration` the job will later read.

**Why "predominantly" is a floor and not a majority.** A floor is a number a post-hoc check can state and a prompt can quote; a majority is a comparison that changes meaning at small totals. `weightedTopicFloor(total)` is `max(1, ceil(total * WEIGHTED_TOPIC_SHARE))` — one question minimum, so a one-question Extraction is weightable at all, and never more than `total`.

```ts
// practice-test-payload.ts, after the per-question walk — the whole-payload
// check, beside the format-mix comparison it mirrors.
if (expectation.weightedTopic !== null) {
  const wanted = normalizeTopicLabel(expectation.weightedTopic);
  const onTopic = questions.filter((question) =>
    question.topics.some((label) => normalizeTopicLabel(label) === wanted),
  ).length;
  if (onTopic < expectation.weightedFloor) refuse(WEIGHTED_TOPIC_UNDERWEIGHT);
}
```

**Why under-floor is upstream and retried.** It is the same class as a MultipleChoice question with two correct options: the model was asked for a shape and answered with another (AD-30, AD-31). `produceDraft` already re-issues on `GenerationPayloadInvalid` under `AI_MAX_ATTEMPTS`, and the claim-timeout invariant in `practice-test-policy.ts:186` is already computed against that budget, so no timing figure moves.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev` -- expected: the new migration applies cleanly and `prisma generate` emits `weightedTopic`.
- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter api test` -- expected: the extended policy and payload specs pass alongside the existing suite.
- `pnpm --filter api test:int` -- expected: `practice-test.int-spec.ts` passes against real Postgres, covering weighted acceptance, the unknown-Topic refusal, identical clamping/charging, and the Topics route.
- `pnpm --filter web test` -- expected: the generate page spec and `parent-api` spec pass with the Topic group and the new method.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the weighted browser pass passes end to end.
- `pnpm lint` and `pnpm prettier --check .` -- expected: clean.

## Auto Run Result

**Summary of implemented change:** Follow-up review pass on the already-`done` Story 4.2 (topic-weighted Practice Test regeneration). No new feature work; two correctness patches applied from this pass's review findings.

**Files changed with one-line descriptions:**
- `apps/api/src/practicetest/practice-test-prompt.ts` — `weightedCoverage` no longer tells the model to spread questions across other Topics when the floor already consumes the whole count (total ≤ 2).
- `apps/api/test/practice-test.int-spec.ts` — added a case pinning the new floor-consumes-total branch; adjusted the existing "offers the other topics" case to a count where questions genuinely remain; added a case pinning DTO trim-before-`MaxLength` ordering on a heavily padded real Topic label.

**Review findings breakdown:** 2 patches applied (1 medium, 1 low), 0 deferred (2 candidate findings were duplicates of already-tracked deferred entries), 17 rejected (11 blind-hunter claims not reachable or not caused by this change — one, "readiness checks diverge between `topicsFor()` and `request()`", was verified factually false, both use identical checks; 2 edge-case-hunter claims verified either already-tracked or already-handled; 4 intent-alignment divergences that are defensible implementation choices, not defects).

**Follow-up review recommendation:** `false`. This pass's patched findings: 0 high, 1 medium, 1 low. Score = 3×1 (medium) + 1×1 (low) = 4, below the threshold of 5, and no high-severity patch.

**Verification performed:** `pnpm exec vitest run test/practice-test.int-spec.ts src/practicetest` (129 passed, 0 failed) from `apps/api`, both before and after `prettier --write` on the two changed files. `pnpm --filter api typecheck` clean. `pnpm exec eslint` on the two changed files: no issues. `pnpm exec prettier --check` on the two changed files: clean after `--write`. Migration, web, and e2e verification commands were not re-run — no web or migration files changed this pass.

**Residual risks:** None identified beyond what is already carried in the `deferred` list (topic-vanished-from-extraction retry budget, weighted-coverage-at-Epic-7-drill-down entry-point duplication, integration-tier flake, `pnpm lint` unusable in this environment, generate-screen tests being mostly source-grep, unbounded Topic radio count).

