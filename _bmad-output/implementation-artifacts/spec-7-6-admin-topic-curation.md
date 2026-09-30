---
title: 'Story 7.6: Admin Topic Curation'
type: 'feature'
created: '2026-09-29'
baseline_revision: '04897d838ccad50d320091dccadd57b524e9f770'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The web workspace has no DOM test environment, so no test renders an Admin screen or
      exercises it against a mocked client; screen specs assert over source text instead.
    evidence: |-
      apps/web/vitest.config.ts sets environment: 'node' and the workspace ships no
      testing-library/jsdom dependency. apps/web/src/app/admin/topics/page.spec.tsx therefore
      readFileSync's page.tsx and TopicCurationList.tsx and matches strings/regexes, exactly as
      the pre-existing flagged-explanations/page.spec.tsx beside it does. Such assertions pass
      for a component that renders nothing and break on a format-preserving refactor. The sibling
      justifies its form by naming an e2e spec; there is no e2e spec for /admin/topics.
    location: >-
      apps/web/vitest.config.ts
    severity: medium
  - summary: >-
      A merge builds one `id: { in: [...] }` list per touched QuestionTopic row and recomputes
      Mastery one profile per round trip, all inside a single transaction with no cap or batching.
    evidence: |-
      grading.service.ts repointTopicTags selects every tag id then issues deleteMany/updateMany
      over those id lists; topic-curation.service.ts merge loops recomputeMastery per affected
      profile in the same withTransaction. At a term's worth of tags this can approach the
      Postgres bind-parameter limit and hold locks long enough to hit a statement timeout, which
      rolls the whole merge back. The bounded form (delete by `topicId` + `questionId in
      alreadyTagged`, then updateMany by `topicId`) removes the id lists entirely.
    location: >-
      apps/api/src/grading/grading.service.ts
    severity: low
  - summary: >-
      The DOM-less test environment cannot observe conditional rendering, so a regression
      that silently hid the merge's "cannot be undone" warning would not fail any test.
    evidence: |-
      TopicCurationList.tsx renders the topic-merge-confirmation block only when
      targetId !== ''. page.spec.tsx asserts only that the copy call and the testid
      substring exist in the raw file, and that the testid's text precedes
      props.onMerge(topic, target)'s text by character offset -- it never asserts what
      the guard expression is. Flipping the guard to render only while no target is
      chosen (i.e. while Merge is disabled) leaves every checked substring and their
      relative order unchanged, so the suite stays green while an operator could fire an
      irreversible merge never having seen the warning. Same root cause as the existing
      "no DOM test environment" item above; this is the concrete instance found this pass.
    location: >-
      apps/web/src/app/admin/_components/TopicCurationList.tsx:310
    severity: medium
  - summary: >-
      confirm/rename/merge read a Topic row then write to it later in the same
      transaction with no handling for the row vanishing in between.
    evidence: |-
      TopicCurationService.confirm/.rename/.merge and TopicService.confirm/rename/
      removeMerged never catch Prisma's P2025 (record not found). A concurrent merge
      folding away the same Topic between the read and the write throws unhandled,
      surfacing as a 500 instead of the 404 every other unknown-Topic path returns. No
      row-level lock is taken either, so two simultaneous merges can both pass the
      initial checks before either commits. The transaction still rolls back cleanly on
      the fault -- no data is at risk, only the returned status code is wrong -- and admin
      curation is single-operator, low-traffic, so the window is narrow.
    location: >-
      apps/api/src/admin/topic-curation.service.ts
    severity: low
  - summary: >-
      A rename to a name that trims/bounds to the same value still writes an UPDATE and
      clears the cached embedding, forcing an unnecessary re-embed on the next cascade run.
    evidence: |-
      TopicService.rename re-derives the match key and clears embedding/embeddingModel
      unconditionally, with no short-circuit for "nothing actually changed" the way
      confirm's already-confirmed case is short-circuited and tested. No test covers a
      rename to the current name. Costs one wasted stage-3 embed call; no incorrect data.
    location: >-
      apps/api/src/topics/topic.service.ts
    severity: low
  - summary: >-
      listProvisional and listForSubject are unbounded reads with no pagination, on
      sets the story's own premise says accumulate over a term.
    evidence: |-
      Both TopicService.listProvisional and TopicService.listForSubject (called via
      TopicCurationService) issue a plain findMany with no take/cursor. Fine at current
      data volumes; becomes a slow response or oversized payload as the provisional
      queue or a Subject's canonical set grows across terms.
    location: >-
      apps/api/src/topics/topic.service.ts
    severity: medium
  - summary: >-
      A merge's audit row is recorded only under the merged Topic's id; the surviving
      Topic's own audit history has nothing pointing at the tags/history it absorbed.
    evidence: |-
      TopicCurationService.merge calls this.audit.record(tx, actorId, 'topic.merge',
      'Topic', topicId, ...) where topicId is the merged (now-deleted) Topic; targetTopicId
      is only a detail field. An operator reviewing the survivor's own audit trail later has
      no entry showing it absorbed another Topic's history.
    location: >-
      apps/api/src/admin/topic-curation.service.ts
    severity: low
  - summary: >-
      The merge-target dropdown offers no in-panel retry on a failed loadTargets fetch;
      the operator must close and reopen the merge control to retry.
    evidence: |-
      TopicCurationList's openMerge sets targetsError on any loadTargets failure but
      renders no retry action beside it, unlike the page-level load failure which shows
      an explicit Retry button.
    location: >-
      apps/web/src/app/admin/_components/TopicCurationList.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 7.1 mints a provisional canonical Topic whenever a label matches nothing, and nothing has ever been able to confirm, rename, or merge one — so a Subject's canonical set accumulates unreviewed near-duplicates and every parent's Mastery picture fragments quietly as a term goes on.

**Approach:** Give the Admin surface a Topic curation screen backed by three operator actions within one Subject's canonical set: confirm a provisional Topic as-is, rename it, or merge it into another Topic of the same Subject — the merge re-pointing every `QuestionTopic` tag onto the survivor and recomputing Mastery for every affected Student Profile through Story 7.2's one recompute path, all inside a single transaction.

## Boundaries & Constraints

**Always:**
- **AD-17 ownership holds.** `topics` stays the sole writer of `Topic`; `grading` stays the sole writer of `QuestionTopic` and `TopicMastery`. The new admin service orchestrates and holds no Prisma delegate of any of the three.
- **A merge reuses `GradingService.recomputeMastery` (AD-12).** No second window definition, no second formula, no recompute job.
- **A merge is one transaction** (AD-10): repoint, remove the merged Topic, recompute every affected profile, and write the audit row commit or roll back together. No reader may see re-pointed tags beside stale Mastery.
- Every action is audited through `AdminAuditService.record` on the caller's `tx`, with redacted metadata only (AD-20/AD-25): ids, names, counts — never child content.
- Every action stays inside one Subject's canonical set: a merge whose two Topics differ in `subjectId` is refused.
- A rename recomputes `matchKey` through `topicMatchKey` and clears the cached vector, so stage 1 and stage 2 never decide a match by a spelling the Topic no longer has.
- No user-facing string is a literal in a component (AD-32); all Admin copy lands in `apps/web/src/copy/admin.ts`.

**Block If:**
- Reusing `recomputeMastery` for the merge would require changing its signature or its window rule.
- Honouring AD-17 for all three tables would require a module import cycle that cannot be broken by pointing the arrow at `admin`.

**Never:**
- No change to the AD-11 cascade itself: `normalize` keeps its single entry point, its three stages, its threshold and its prompt. Curation is downstream of matching and never a second matching path.
- No Topic deletion outside a merge, no cross-Subject merge, no bulk/auto-merge, no parent- or student-visible change of any kind.
- No new generation, extraction or provider call: curation makes no `ai` call at all.
- No schema migration: `Topic`, `QuestionTopic` and `TopicMastery` are used as they stand, including the existing `@@index([subjectId, provisional])` this story is the first reader of.
- No bespoke Admin styling: the existing theme at compact density, as every other Admin screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confirm | `POST admin/topics/:id/confirm` on a provisional Topic | `provisional` false; name, `matchKey`, embedding and every `TopicMastery` row untouched; `topic.confirm` audited | No error expected |
| Confirm already-confirmed | Same call on `provisional: false` | Idempotent: the row is returned unchanged, still audited | No error expected |
| Rename | `PATCH admin/topics/:id/name` with a new name | `name` stored trimmed and bounded, `matchKey` re-derived, `embedding`/`embeddingModel` cleared, `provisional` untouched, Mastery untouched; `topic.rename` audited | 409 when the new key collides with another Topic of that Subject |
| Merge | `POST admin/topics/:id/merge` with `targetTopicId` | Every `QuestionTopic` on the merged Topic re-points to the target (colliding tags deleted, not duplicated); merged `Topic` row removed; `recomputeMastery(tx, profile, [target])` runs for every affected profile; `topic.merge` audited with both ids and the re-pointed count | Rolls back whole on any failure |
| Merge, no tags | Merged Topic has no `QuestionTopic` rows | Row removed, nothing re-pointed, no profile recomputed | No error expected |
| Merge into itself | `targetTopicId` equals the path id | Refused, nothing written | 400 |
| Cross-Subject merge | Target Topic belongs to another Subject | Refused, nothing written | 400 |
| Unknown Topic | Any action on an id with no row, or a merge whose target has no row | Refused, nothing written | 404 |
| Unauthenticated | No/expired admin bearer token | Refused before any read | 401 via `AdminAuthGuard` |
| Provisional queue read | `GET admin/topics/provisional` | Every provisional Topic across Subjects, with Subject name, created instant and its tagged-Question count, oldest first | Empty array when none |
| Merge-target read | `GET admin/topics/subjects/:subjectId` | That Subject's whole canonical set, name-ordered, each with its provisional flag | 404 on unknown Subject |

</intent-contract>

## Code Map

**API — reuse, do not re-implement**

- `apps/api/src/topics/topic.service.ts` — sole writer of `Topic`. `:36` `TopicNormalizeRequest`, `:52` `TopicDescription`, `describe(topicIds)` (`:246`) is the shape to imitate for the new readers; `mint` (`:474`) shows the `Prisma.DbNull` vs `null` embedding rule and the P2002 handling to copy for rename. `boundedLabel` (`:539`, file-local) with `MAX_TOPIC_LABEL_LENGTH` (`topic-policy.ts`) bounds the renamed name exactly as a minted one.
- `apps/api/src/topics/topic-match-key.ts` `topicMatchKey(name)` — the **only** derivation of `matchKey`; a rename re-derives through it.
- `apps/api/src/topics/topics.module.ts` — exports `TopicService`; its doc block already states that the confirm/merge/rename surface is this story.
- `apps/api/src/grading/grading.service.ts:1099` `recomputeMastery(tx, studentProfileId, topicIds)` — **called unchanged**; its doc block already names this story's merge as the caller AD-12 requires. `:216` shows `PracticeTestService` injected as a seam.
- `apps/api/src/practicetest/practice-test.service.ts:1950` `submittedAttemptsFor(tx, studentProfileId)` — the per-profile read; this story needs its inverse (profiles for a set of Practice Tests) added beside it, same `tx`-taking, ownership-respecting shape.
- `apps/api/src/admin/taxonomy.service.ts` — the service recipe: `prisma.withTransaction`, read-before-write, `NotFoundException` / `ConflictException` / `BadRequestException`, `conflictOnDuplicate` (`:51`), `audit.record(tx, …)` inside the same transaction.
- `apps/api/src/admin/taxonomy.controller.ts` — the controller recipe: `@Controller('admin/…')`, `@UseGuards(AdminAuthGuard)`, `@SkipThrottle({ login: true })`, `ParseUUIDPipe`, and `actor(req)` reading `req.admin!.adminUserId`.
- `apps/api/src/admin/admin-audit.service.ts:10` `AuditAction` — the union to extend; `AuditDetail` is redacted metadata only.
- `apps/api/src/admin/admin.module.ts` — where the new controller and service register, and where `TopicsModule` + `GradingModule` are imported. The arrow points `admin -> topics` and `admin -> grading` (`grading -> topics` already exists, so no cycle); the existing `ExplanationModule` comment states this precedent.
- `apps/api/src/admin/dto/taxonomy.dto.ts` — the DTO recipe (`@Transform(trim)`, `@IsString`, `@MinLength/@MaxLength`, `@IsUUID`).
- `apps/api/prisma/schema.prisma` — `Topic` (`:1578`, unique `(subjectId, matchKey)`, index `(subjectId, provisional)`), `QuestionTopic` (`:1661`, unique `(questionId, topicId)`, index `(topicId, practiceTestId)`), `TopicMastery` (`:1713`, both relations `onDelete: Cascade`). **Read-only: no migration in this story.**
- `apps/api/test/harness.ts:567` `adminToken(jwt, operatorId)` / `:645` `bearer`; `apps/api/test/taxonomy.int-spec.ts` (admin-guarded route recipe), `apps/api/test/mastery.int-spec.ts` + `weak-area.int-spec.ts` (graded hand-in fixture that produces real `QuestionTopic` and `TopicMastery` rows), `apps/api/test/topic-normalization.int-spec.ts` (how a canonical set is set up).

**Web — reuse, do not re-implement**

- `apps/web/src/lib/admin-api.ts:181` `adminApi` — where the new calls go; `call<T>` (`:153`) and `messageFor` (`:145`) already map 401/404/409 to copy.
- `apps/web/src/app/admin/taxonomy/page.tsx` — the screen recipe: token check + `router.replace('/admin/login')`, `reload()`, `announcement` live region, `AdminApiError` handling.
- `apps/web/src/app/admin/_components/TaxonomyList.tsx` — the row-with-inline-rename control; `AdminChrome.tsx:38-49` — where the nav entry goes.
- `apps/web/src/copy/admin.ts` — `nav`, a new `topics` namespace, and `announce` entries; `errors` already covers 401/404/409.
- `apps/web/src/theme/tokens.ts` `density` — the only spacing source.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/topics/topic.service.ts` -- add four members: `listProvisional()` (every `provisional: true` Topic with its Subject name, `createdAt` asc, `id` asc tie-break), `listForSubject(subjectId)` (the Subject's whole set, name asc, `id` asc), `confirm(tx, topicId)`, `rename(tx, topicId, name)` (bounded name, re-derived `matchKey`, embedding cleared, P2002 surfaced as a named conflict), `removeMerged(tx, topicId)` (deletes the row) -- `Topic` has exactly one writer, and curation is a write to it.
- `apps/api/src/topics/topic.service.spec.ts` -- cover the rename key re-derivation, the embedding clear, the confirm idempotence, and that none of the four reaches a cascade stage -- these are the rules a later edit would silently drop.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `profilesWithSubmittedAttemptsOn(tx, practiceTestIds)` returning distinct `studentProfileId`s, beside `submittedAttemptsFor` -- `Attempt` is `practicetest`'s, and the merge must find whose Mastery moved.
- `apps/api/src/grading/grading.service.ts` -- add `topicTagCounts(topicIds)` (groupBy on `QuestionTopic`) and `repointTopicTags(tx, fromTopicId, toTopicId)`: read the merged Topic's tags, delete the tags whose Question already carries the target, re-point the rest, and return `{ repointed, affectedProfileIds }` (union of the profiles from `profilesWithSubmittedAttemptsOn` over the touched Practice Tests and the profiles already holding a `TopicMastery` row on either Topic) -- both tables are `grading`'s, and the unique `(questionId, topicId)` makes a naive `updateMany` a constraint violation.
- `apps/api/src/grading/grading.service.spec.ts` (or a new `topic-merge.spec.ts`) -- cover the collision partition and the affected-profile union -- the two rules that decide whether a merge is lossless.
- `apps/api/src/admin/admin-audit.service.ts` -- extend `AuditAction` with `topic.confirm`, `topic.rename`, `topic.merge` -- an unaudited curation action is an unexplained canonical set.
- `apps/api/src/admin/topic-curation.service.ts` -- new: the orchestration. Reads through `TopicService`; each action opens one `prisma.withTransaction` and, for a merge, runs repoint -> `topics.removeMerged` -> `grading.recomputeMastery(tx, profileId, [targetTopicId])` per affected profile -> audit, in that order -- one transaction is what AD-10 requires, and the order is what keeps a cascade from deleting rows the recompute still needs.
- `apps/api/src/admin/dto/topic-curation.dto.ts` -- new: `RenameTopicDto` (trimmed, 1..200) and `MergeTopicDto` (`@IsUUID targetTopicId`) -- the wire shape is validated before any read.
- `apps/api/src/admin/topic-curation.controller.ts` -- new: `@Controller('admin/topics')` under `AdminAuthGuard`, routes `GET provisional`, `GET subjects/:subjectId`, `POST :id/confirm`, `PATCH :id/name`, `POST :id/merge`, each passing `actor(req)` -- the same guard, throttle and pipe set every other Admin route uses.
- `apps/api/src/admin/admin.module.ts` -- import `TopicsModule` and `GradingModule`; register the controller and service -- boot is where a missing provider or a cycle should fail.
- `apps/api/test/topic-curation.int-spec.ts` -- new: drive all three actions through supertest with an admin token, including a merge over a real graded hand-in that asserts the survivor's `TopicMastery` counts moved and the merged Topic's rows are gone, plus every refusal row of the I/O matrix -- the merge's whole claim is a database fact.
- `apps/web/src/lib/admin-api.ts` -- add `provisionalTopics`, `subjectTopics`, `confirmTopic`, `renameTopic`, `mergeTopic` and their view types -- one client, one error mapping.
- `apps/web/src/copy/admin.ts` -- add `nav.topics` and a `topics` namespace (title, intro, empty, loading, retry, column labels, confirm/rename/merge controls, the merge target label, and a merge confirmation sentence taking the two names and the tagged-Question count as parameters) plus `announce` entries for the three actions -- AD-32, and the merge's blast radius must be stated before it fires.
- `apps/web/src/app/admin/_components/TopicCurationList.tsx` -- new: one row per provisional Topic (name, Subject, tagged-Question count, created) with Confirm, inline Rename, and a Merge control whose target select is that Subject's other Topics -- the target set is per Subject, so it is fetched per row's Subject and never globally.
- `apps/web/src/app/admin/topics/page.tsx` -- new: the screen, following the taxonomy page's token check / reload / announce / error shape -- an operator reaches curation the same way they reach every other queue.
- `apps/web/src/app/admin/topics/page.spec.tsx` -- new: render the queue, exercise confirm/rename/merge against a mocked `adminApi`, and assert the empty and load-failed states -- the screen is the only place the three actions are composed.
- `apps/web/src/app/admin/_components/AdminChrome.tsx` -- add the nav entry -- a destination with no nav entry is one an operator cannot reach.

**Acceptance Criteria:**

- Given a provisional Topic with stored Mastery, when an Admin confirms it, then `provisional` is false and every `TopicMastery` row for that Topic is byte-for-byte unchanged.
- Given a provisional Topic, when an Admin renames it, then the stored name is the new one, `matchKey` equals `topicMatchKey(newName)`, the cached vector is cleared, `provisional` is unchanged, and no `TopicMastery` row changes.
- Given two Topics of one Subject where a child has graded Questions tagged with both, when an Admin merges the first into the second, then no `QuestionTopic` row references the merged Topic, no Question carries a duplicate tag, the merged `Topic` row is gone, and the survivor's `TopicMastery` for that child equals what `recomputeMastery` produces over the union — computed inside the same transaction as the repoint.
- Given a merge that fails partway, when the transaction rolls back, then the tags, the Topic row and every Mastery row are exactly as they were before the request.
- Given any of the three actions, when it succeeds, then exactly one `admin_audit` row is written in the same transaction, naming the actor, the action and the Topic ids, and carrying no child content.
- Given an operator with no valid admin token, when they call any curation route, then the request is refused with 401 before any Topic is read.
- Given the curation screen, when the provisional queue is empty, then the screen states that in words rather than rendering a blank panel.

## Spec Change Log

- 2026-09-30: Rebased the parked attempt-1 implementation (`refs/attempt-preserve-dirty/20260926-202152-4fb2-d203172a-1`) onto `04897d8` with a 3-way apply; cleared the now-satisfied `operator_actions` salvage note.

## Review Triage Log

### 2026-09-30 - Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 5, low 3)
- defer: 2: (high 0, medium 1, low 1)
- reject: 11: (high 0, medium 4, low 7)
- addressed_findings:
  - `[medium]` `[patch]` The merge's per-profile recompute loop was only ever exercised with one affected profile, so collapsing it to a single call would have kept the suite green -- added an int-spec merge over two profiles, one qualifying only through a submitted Attempt with no stored Mastery row, asserting both survivors and `recomputeMastery` running twice.
  - `[medium]` `[patch]` No test covered the wire-level refusals the controller exists for -- added int-spec cases for a non-UUID path id, a non-UUID `targetTopicId`, a missing/non-string `name`, an over-bound name, and a name exactly at the bound.
  - `[medium]` `[patch]` `RenameTopicDto`'s `@MaxLength(200)` was a restated literal that could drift from `MAX_TOPIC_LABEL_LENGTH` and make existing Topics unrenamable -- the decorator now takes the constant.
  - `[medium]` `[patch]` `topicTagCounts` and `profilesWithSubmittedAttemptsOn` had no direct tests (the merge unit spec stubbed the latter) -- added unit coverage for dedupe, empty-input short-circuit, absent-Topic-means-zero, and the `submittedAt: { not: null }` + `distinct` statement.
  - `[medium]` `[patch]` `page.tsx run()` reported a committed write as failed when the following re-read rejected, sending the operator into a retry that 404s -- the write's announcement now lands before the re-read, and a re-read failure surfaces as a load error.
  - `[low]` `[patch]` `mergeConfirmation` and `announce.topicMerged` were unpluralized ("1 tagged questions") and the confirmation promised `taggedQuestionCount` while collisions are deleted rather than moved -- both pluralize now and the confirmation reads as an upper bound.
  - `[low]` `[patch]` `openMerge` wrote its target list unconditionally, so opening a second row before the first resolved showed the wrong Subject's Topics -- the write is now guarded on the row still being the open request.
  - `[low]` `[patch]` `createdOn` used `toLocaleString()`, whose output depends on ambient locale/timezone and can differ between server and browser render -- replaced with a fixed UTC `Intl.DateTimeFormat`.

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 6: (high 0, medium 1, low 5)
- reject: 7: (high 0, medium 2, low 5)
- addressed_findings:
  - `[medium]` `[patch]` `TopicCurationList`'s `openMerge` caught every `loadTargets` failure the same way, never checking for a 401 like every other read/write on this screen -- an operator whose session expired while opening the merge panel saw a generic load-failed sentence instead of the bounce to `/admin/login` the rest of the screen guarantees. `page.tsx` now wraps `loadTargets` to check `AdminApiError`'s `401` and call `toLogin()` before rethrowing, matching `load`/`refresh`/`run`; `page.spec.tsx`'s `status === 401` count assertion updated from 3 to 4.

## Design Notes

**Why the orchestration lives in `admin` and not in `topics`.** A merge writes three tables owned by two modules, and `grading -> topics` already exists — so putting the orchestration in `topics` would need `topics -> grading` and close the cycle. `admin` is imported by nothing but `app.module.ts`, which makes it the only place both arrows can point out of. It holds no delegate of `Topic`, `QuestionTopic` or `TopicMastery`; it holds the transaction and calls the two owners, exactly as it already reaches `explanation` for the flagged queue.

**Why the repoint partitions instead of updating.** `QuestionTopic` is unique on `(questionId, topicId)`. A Question tagged with both the merged and the surviving Topic — the ordinary case for two spellings of one concept on one paper — makes a blanket `updateMany` a constraint violation, and `skipDuplicates` does not exist for updates. So the colliding tags are deleted and the rest re-pointed: the Question ends carrying the survivor exactly once, which is the idempotence the unique index exists for.

**Why the affected-profile set is a union.** Profiles are found from the touched Practice Tests, because a child whose window Questions were all `Ungraded` has no `TopicMastery` row to be found by and still needs recomputing. Profiles already holding a row on either Topic are added, because a row can outlive the evidence behind it. Recomputing a profile that turns out to have no evidence is a delete, which is the right answer for it anyway.

**Why rename leaves `provisional` alone.** Confirm is the one action that means "a human has judged this", and making a rename mutate a second flag would be a hidden second decision. The queue row carries Confirm and Rename side by side, so an operator who fixes a spelling confirms on the same row — the queue still drains, and neither action silently performs the other.

**Why a rename clears the cached vector.** `embedding` is a vector of the Topic's *name*. After a rename it describes a spelling the row no longer has, and stage 2 would go on matching against it — silently, with a cosine that looks perfectly healthy. Clearing it costs one stage-3 call the next time a near-duplicate arrives, which `cacheVectorFor` then refills from the new name.

## Verification

**Commands:**
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm --filter api run typecheck` -- expected: clean.
- `pnpm --filter web run lint` -- expected: clean.
- `pnpm --filter web run typecheck` -- expected: clean.
- `pnpm --filter api exec vitest run src/topics src/grading src/admin` -- expected: all pass.
- `pnpm --filter api exec vitest run test/topic-curation.int-spec.ts test/mastery.int-spec.ts test/weak-area.int-spec.ts test/analytics.int-spec.ts test/taxonomy.int-spec.ts test/topic-normalization.int-spec.ts` -- expected: all pass; Epic 7's existing suites still green.
- `pnpm --filter web run test` -- expected: all pass.

## Auto Run Result

**Summary of implemented change:** This pass was a fresh, unattended review of the already-implemented Story 7.6 (Admin Topic curation: confirm/rename/merge, backed by `TopicCurationService`, `TopicCurationController`, `GradingService.repointTopicTags`/`topicTagCounts`, `PracticeTestService.profilesWithSubmittedAttemptsOn`, and the `apps/web/src/app/admin/topics` screen). No new functional surface was added this pass; one inconsistency in existing behavior was patched.

**Files changed with one-line descriptions:**
- `apps/web/src/app/admin/topics/page.tsx` — `loadTargets` now checks for a 401 and bounces to `/admin/login` before rethrowing, matching `load`/`refresh`/`run`.
- `apps/web/src/app/admin/topics/page.spec.tsx` — updated the `status === 401` occurrence-count assertion from 3 to 4.
- `_bmad-output/implementation-artifacts/spec-7-6-admin-topic-curation.md` — this review pass's triage log entry and six new `deferred` items.

**Review findings breakdown:** 14 findings after triage (0 intent_gap, 0 bad_spec). 1 patch applied (medium). 6 deferred (1 medium, 5 low) — a concrete instance of the untestable-conditional-rendering gap, the unhandled-concurrent-delete race on confirm/rename/merge, a needless embedding-clear on a no-op rename, unbounded `listProvisional`/`listForSubject` reads, a merge audit row not cross-linked from the survivor's side, and the merge-target dropdown's missing in-panel retry. 7 rejected — a distinct admin authorization-scope request, an unrequested merge-blast-radius confirmation cap, a suggestion to test that two length constants can't drift, the codebase-wide `req.admin!` non-null-assertion pattern (verified consistent with every other admin controller), an intent-alignment read alleging the UI should expose rename/merge on already-confirmed Topics directly (rejected: the I/O matrix's own row label, "Merge-target read", and the Approach paragraph's phrasing both scope rename/merge to acting on a provisional Topic), and two duplicates of already-known/already-deferred issues (the merge's per-profile recompute-inside-one-transaction cap, and the general no-DOM-test-environment gap).

**Follow-up review recommendation:** `false`. Only one finding was triaged `patch` this pass, at `medium` severity: score = 3×1 (medium) + 1×0 (low) = 3, below the `5` threshold, and it was not `high`.

**Verification performed:** `pnpm --filter web run lint` — clean. `pnpm --filter web run typecheck` — clean. `pnpm --filter web run test` — 70 files, 1488 tests, all pass (failed once on the stale `status === 401` count of 3, fixed to 4, then green). No API files changed this pass, so API lint/typecheck/vitest/int-specs were not re-run.

**Residual risks:** The six newly deferred items above are real but each low-consequence at current scale (single-operator admin tool, small data volumes) — see their `deferred` entries for detail. No correctness or data-integrity risk was found; every gap either degrades an error path (500 instead of 404 on a rare race) or is a scale/observability concern for later.

