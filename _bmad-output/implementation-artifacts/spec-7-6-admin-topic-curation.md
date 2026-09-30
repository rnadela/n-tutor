---
title: 'Story 7.6: Admin Topic Curation'
type: 'feature'
created: '2026-09-29'
baseline_revision: 'd203172a34bbf9f85e80c2866702ee2ced04d361'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
operator_actions:
  - >-
    Prior dev session timed out twice (2026-09-29). Attempt 1 left real, uncommitted
    work parked at `refs/attempt-preserve-dirty/20260926-202152-4fb2-d203172a-1`
    (admin topic-curation controller/service/DTOs, topic merge logic in grading +
    topic services, unit + integration tests, admin UI wiring — 13 files). Attempt 2
    parked at `...-2` is just the spec file, no code. Before the next dev session
    starts fresh, inspect attempt 1 for salvage:
    `git show --stat refs/attempt-preserve-dirty/20260926-202152-4fb2-d203172a-1`,
    and either recover it (`git merge --ff-only refs/attempt-preserve-dirty/20260926-202152-4fb2-d203172a-1`)
    or discard and start clean.
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

## Review Triage Log

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
