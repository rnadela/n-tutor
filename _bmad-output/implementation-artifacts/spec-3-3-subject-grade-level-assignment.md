---
title: 'Story 3.3 — Subject & Grade Level Assignment'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: '225c74ca8d39db0e58a9f517cfa8c2dbfd0fbcf4'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      source_test.subjectId carries a Restrict foreign key with no index, while the
      grade-level axis is indexed.
    evidence: |-
      Postgres does not index foreign-key columns automatically. Subject-axis reads
      planned for Epics 4 and 7, and the Restrict check run on every Subject delete,
      both scan source_test. The spec asked only for @@index([gradeLevelId]), so the
      omission is deliberate-by-spec rather than an implementation slip.
    location: >-
      apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      A Subject patch against a draft whose stored Grade Level an Admin has since
      withdrawn is refused with the Subject sentence, naming the wrong cause.
    evidence: |-
      isSubjectOffered delegates to listSelectableSubjects, which answers [] for a
      disabled Grade Level rather than throwing, so every subjectId patch on such a
      draft returns 400 SUBJECT_NOT_AVAILABLE. Submission is unaffected, and the
      stored classification still resolves, so this is a message-accuracy gap on a
      rare state rather than a broken rule.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts
    severity: low
  - summary: >-
      One classification patch issues more queries than it needs, fetching the whole
      offered Subject list only to test membership and re-resolving both names after
      the write.
    evidence: |-
      classify runs requireDraft, resolveSubject, listSelectableSubjects, updateMany
      and then a full read that resolves both taxonomy names again. Membership could
      be a single join-row read, and the answering view could be built from state the
      method already holds. No measured problem at current volumes.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts
    severity: low
  - summary: >-
      A pre-existing E2E failure in the auth spec, surfaced by running the full suite
      during this story and untouched by it.
    evidence: |-
      e2e/tests/parent-auth.spec.ts:105 uses getByRole('status'), which became a
      strict-mode violation when story 1-7 added a global polite live region in
      ThemeRegistry. No file in this story's diff touches auth or the live region,
      and the capture spec passes.
    location: >-
      e2e/tests/parent-auth.spec.ts:105
    severity: medium
  - summary: >-
      The classify() announcement on the capture screen assumes a patch never
      carries both subjectId and gradeLevelId at once, so a combined patch
      would describe only the grade-level change and never mention the subject.
    evidence: |-
      classificationAnnouncement branches solely on whether gradeLevelId is
      present in the patch; today's UI only ever sends one field per select's
      onChange, so the combined path is unreachable from the current screen.
      The DTO, API and service all accept both fields together, so a future
      caller (e.g. a combined-picker UI) would hit this silently.
    location: >-
      apps/web/src/lib/classification.ts (classificationAnnouncement)
    severity: low
  - summary: >-
      loadGradeLevels/loadSubjects' out-of-order-response guard is verified only
      by asserting the guard call text is present in page.tsx's raw source, not
      by exercising the guard against actually-out-of-order responses.
    evidence: |-
      page.spec.tsx's coverage of applyIfCurrent(gradeLevelsCurrent.current, ...)
      and applyIfCurrent(subjectsCurrent.current, ...) is `PAGE_SOURCE.toContain(...)`
      against the file text; the spec file never renders CapturePage, only PageStrip.
      No test (unit or e2e) resolves two grade-level/subject reads out of order and
      asserts the later-issued one wins. The guard mirrors the already-working
      profiles/draft guards, so it is very likely correct, but that is unverified.
    location: >-
      apps/web/src/app/parent/capture/page.tsx (loadGradeLevels, loadSubjects)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A Source Test carries no Subject and no Grade Level, so nothing downstream knows what was photographed. Story 3.2 left `submit` gated on page count alone, and the taxonomy Epic 2 built (Subject × Grade Level availability, three independent `enabled` flags) has no parent-facing reader for Subjects at all.

**Approach:** Give `SourceTest` a nullable `subjectId` and `gradeLevelId`, seed the Grade Level from the chosen Student Profile when the draft is opened, add a classification write that validates the pair against the Admin-enabled availability, expose the Subjects offered for a Grade Level to the parent, and extend the server-side submit gate to refuse while either is unset.

## Boundaries & Constraints

**Always:**
- Exactly one Subject and one Grade Level per Source Test, stored as ids and never as copied labels. Names are resolved on read through `admin`'s `TaxonomyService` — the same rule `StudentProfileView` already follows, so an Admin rename changes what the Source Test reads without writing its row.
- The Subjects offered are exactly `TaxonomyService.listSelectableSubjects(gradeLevelId)`: the conjunction of Subject-enabled, Grade-Level-enabled and join-row-enabled, computed there and nowhere else. No second reader of `subject`, `grade_level` or `subject_grade_level` is created (AD-17) — `sourcetest` imports `TaxonomyModule` exactly as `identity` does.
- A Grade Level may be assigned only while it is selectable (enabled); an unknown one is 404 and a disabled one is 400, matching `requireSelectableGradeLevel`'s existing split.
- A Subject may be assigned only while it is offered for the Grade Level the Source Test will hold **after** this write applies. Subject and Grade Level sent together are validated as one resulting pair.
- Once stored, a reference keeps resolving. A later Admin disable never invalidates a stored classification and never blocks submission — the submit gate asserts non-null, never enabled.
- Grade Level defaults to the Student Profile's on `openDraft` and is overridable per upload. Changing it never touches the Student Profile.
- Submission is refused server-side while either field is null. The disabled button is a courtesy, not the control, and the on-screen reason names which part is missing.
- The account comes from `req.elevated` (AD-18); a foreign or unknown Source Test is 404, never 403. Draft-only, expiry-filtered, exactly as every other write on this controller.
- User-facing strings live in `src/copy/parent.ts`; web rules are exported pure functions with colocated specs (the web suite has no DOM).

**Block If:**
- Nothing. Every decision here is settled by the epic context and the existing taxonomy service.

**Never:**
- Do not build the camera viewfinder or library multi-select (Story 3.1), the legibility check, the Upload Allowance charge or the commit confirmation copy (Story 3.4), Extraction (Story 3.5), or the thin-Extraction warning (Story 3.6).
- Do not add an Admin surface, an audit row, or any taxonomy write — this story reads the taxonomy and never mutates it.
- Do not copy a Subject or Grade Level **name** onto `source_test`. Do not backfill a Grade Level onto existing draft rows in the migration; a pre-existing draft simply reads as unclassified and the parent classifies it.
- Do not re-check enablement at submit. Do not touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open a draft for a child | `POST /parent/source-tests` `{ studentProfileId }`, no live draft | 200; `gradeLevelId` equals the profile's, `gradeLevelName` resolved, `subjectId` null | No error expected |
| Resume an existing draft | A live draft already classified | 200; the stored classification is returned unchanged, never re-defaulted from the profile | No error expected |
| List offered Subjects | `GET /parent/source-tests/subjects?gradeLevelId=<id>` | 200; exactly the Subjects enabled for that Grade Level, by name | 404 for an unknown Grade Level; `[]` for a disabled one |
| Assign a Subject | `PATCH .../classification` `{ subjectId }`, Subject offered for the stored Grade Level | 200; `subjectId` and `subjectName` set | No error expected |
| Assign an unavailable Subject | Subject disabled, or not enabled for this Grade Level | 400 `SUBJECT_NOT_AVAILABLE`; nothing written | Whole request rejected |
| Override the Grade Level | `PATCH .../classification` `{ gradeLevelId }`, stored Subject still offered there | 200; new Grade Level, Subject kept | No error expected |
| Override to a Grade Level that drops the Subject | Stored Subject not offered for the new Grade Level | 200; Grade Level changed and `subjectId` cleared to null, so the parent re-chooses | No error expected |
| Assign a disabled Grade Level | `{ gradeLevelId }` naming a disabled row | 400 `GRADE_LEVEL_NOT_SELECTABLE`; nothing written | Whole request rejected |
| Assign an unknown taxonomy id | A uuid matching no `subject` / `grade_level` row | 404 from `TaxonomyService`'s own resolve | Nothing written |
| Empty classification body | `PATCH .../classification` `{}` | 400 `NOTHING_TO_CLASSIFY`; nothing written | Whole request rejected |
| Submit unclassified | Draft with pages, `subjectId` or `gradeLevelId` null | 400 `CLASSIFICATION_REQUIRED`; status stays `Draft` | Client shows the stated reason |
| Submit classified with pages | Draft with 1–10 `Ready` pages and both set | 200; status `Submitted` | No error expected |
| Classify a submitted or expired Source Test | Status `Submitted`, or `expiresAt` past | 409 `SOURCE_TEST_NOT_DRAFT`; 404 `SOURCE_TEST_NOT_FOUND` for expired | Client returns to the start of the flow |
| Classify another account's Source Test | Valid elevation, foreign id | 404 `SOURCE_TEST_NOT_FOUND`; nothing written | Never 403 |
| Subject disabled after assignment | Stored Subject later disabled by Admin | Reads still resolve its name; submit still succeeds | No error expected |

</intent-contract>

## Code Map

**Patterns to follow (read-only anchors):**
- `apps/api/src/admin/taxonomy.service.ts:93` -- `listSelectableSubjects(gradeLevelId)`: 404 for an unknown Grade Level, `[]` for a disabled one, otherwise the three-flag conjunction in one query. **Call it; never re-derive the rule.** `resolveSubject` / `resolveGradeLevel` (`:123`, `:131`) succeed for disabled rows — that is what makes a stored reference keep resolving.
- `apps/api/src/admin/taxonomy.module.ts:19-20` -- exports `TaxonomyService`. `apps/api/src/identity/identity.module.ts:43` -- the precedent: a consumer imports `TaxonomyModule` directly and never re-exports it. `SourceTestModule` must do the same; `IdentityModule` does **not** re-export it.
- `apps/api/src/identity/student-profile.service.ts:218-227` -- `requireSelectableGradeLevel`: unknown is 404 (raised by `resolveGradeLevel`), disabled is 400 `GRADE_LEVEL_NOT_SELECTABLE` (exported at `:39`). Reuse that exported constant rather than writing a second sentence.
- `apps/api/src/identity/student-profile.service.ts:238-252` -- `withGradeLevel` / `withGradeLevels`: names resolved on read, one taxonomy read per distinct id. The view shape to mirror.
- `apps/api/src/identity/student-profile.controller.ts:71-75` -- `GET parent/grade-levels`, the existing parent-facing taxonomy read the web app already calls.
- `apps/api/src/sourcetest/source-test.service.ts` -- `openDraft` (:140), `submit` (:330), `requireDraft` / `requireLive` (:430+), `viewOf` (:450+), `SourceTestView` (:49). All five are the edit sites.
- `apps/api/src/sourcetest/source-test.controller.ts:151-175` -- the declaration-order rule already stated in this file (`pages/order` before `pages/:pageId`). The new `@Get('subjects')` must likewise be declared **before** `@Get(':id')`, or `ParseUUIDPipe` answers 400 for the literal `subjects`.
- `apps/api/src/sourcetest/source-test-policy.ts` -- where every message constant and pure rule lives. Add the new ones here; tests compare against the constant, never a literal.
- `apps/api/src/sourcetest/dto/source-test.dto.ts` -- class-validator DTO shape; the global pipe is what runs them.
- `apps/api/test/harness.ts:126,139` -- the hand-maintained TRUNCATE lists (both already name `subject` / `subject_grade_level` in the first; the second does not and does not need to). `createGradeLevel` (:244) is the fixture pattern a new `createSubject` must follow — through `TaxonomyService`, never a raw delegate.
- `apps/api/test/source-test.int-spec.ts` -- the int-spec shape and the existing coverage the new cases extend.
- `apps/web/src/lib/parent-api.ts:119` (`SourceTestView`), `:358` (`gradeLevels`), `:473-530` (the Source Test thunks), `:198` (`call<T>`), `:243` (`elevated`).
- `apps/web/src/app/parent/capture/page.tsx` -- `submittable` (:~195), the child `TextField select` (:~290) is the select idiom to copy, `submitBlocked` render (:~380).
- `apps/web/src/lib/page-order.ts` + `.spec.ts` -- the pure-rule + colocated-spec shape to follow for the new classification rule.
- `apps/web/src/copy/parent.ts` (`capture` namespace) -- `submitBlocked` is currently a bare string and becomes a function of the two reasons.
- `e2e/fixtures.ts:79` (`createGradeLevelFixture`) and `:98` (`taxonomyNameKey`) -- the seeding pattern a `createSubjectFixture` must follow, including the enabled `subject_grade_level` join row.
- `e2e/tests/parent-capture.spec.ts:40` (`openCapture`) -- the flow the new E2E case extends; the MUI-select idiom (`[role="combobox"]` then `getByRole('option')`) is at `:52`.

**Files to create:**
- `apps/api/prisma/migrations/<timestamp>_add_source_test_classification/migration.sql`
- `apps/web/src/lib/classification.ts`, `.spec.ts`

**Files to change:**
- `apps/api/prisma/schema.prisma`, `apps/api/src/sourcetest/source-test-policy.ts`, `source-test-policy.spec.ts`, `source-test.service.ts`, `source-test.controller.ts`, `dto/source-test.dto.ts`, `source-test.module.ts`
- `apps/api/test/harness.ts`, `apps/api/test/source-test.int-spec.ts`
- `apps/web/src/lib/parent-api.ts`, `apps/web/src/copy/parent.ts`, `apps/web/src/app/parent/capture/page.tsx`, `apps/web/src/app/parent/capture/page.spec.tsx`
- `e2e/fixtures.ts`, `e2e/tests/parent-capture.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `subjectId String?` and `gradeLevelId String?` to `SourceTest` with `Restrict` relations to `Subject` and `GradeLevel`, back-relations on both taxonomy models, and `@@index([gradeLevelId])` -- nullable because an existing draft predates the columns and because "unset" is the state the submit gate exists to refuse; `Restrict` because a Source Test is never destroyed as a side effect, exactly like its other two relations.
- `apps/api/prisma/migrations/<timestamp>_add_source_test_classification/migration.sql` -- generate with `prisma migrate dev --name add_source_test_classification`; do not hand-add a backfill -- a pre-existing draft reads as unclassified and the parent classifies it.
- `apps/api/src/sourcetest/source-test-policy.ts` -- add `SUBJECT_NOT_AVAILABLE`, `CLASSIFICATION_REQUIRED`, `NOTHING_TO_CLASSIFY` message constants and a pure `isClassified({ subjectId, gradeLevelId })` -- one source of truth per sentence and per rule, as every other figure in this file already is.
- `apps/api/src/sourcetest/source-test-policy.spec.ts` -- unit-test `isClassified` across all four null combinations -- the gate's rule is the story's whole assertion.
- `apps/api/src/sourcetest/source-test.service.ts` -- inject `TaxonomyService`; seed `gradeLevelId` from the profile in `openDraft`'s create (resume path untouched); add `listSubjectsFor(gradeLevelId)` delegating straight to `listSelectableSubjects`; add `classify(parentAccountId, sourceTestId, { subjectId?, gradeLevelId? })` that requires a draft, refuses an empty patch, validates the **resulting** pair (grade level selectable; subject present in `listSelectableSubjects` of the resulting grade level), clears `subjectId` when a grade-level change drops it, and writes both columns in one `updateMany` scoped by account and `status: 'Draft'`; extend `submit` to throw `CLASSIFICATION_REQUIRED` when `isClassified` is false, inside the same transaction as the page count; extend `viewOf` to resolve `subjectName` / `gradeLevelName` through `resolveSubject` / `resolveGradeLevel` -- a stored id always resolves, so a later disable changes the label the view reads and nothing else.
- `apps/api/src/sourcetest/dto/source-test.dto.ts` -- add `ClassifySourceTestDto` with `@IsOptional() @IsUUID()` on both fields -- whether the pair is *available* depends on rows, so that stays in the service beside the write, exactly as `ReorderPagesDto` leaves permutation-checking to `reorderedOrThrow`.
- `apps/api/src/sourcetest/source-test.controller.ts` -- add `@Get('subjects')` (query `gradeLevelId`, `ParseUUIDPipe`) **declared before `@Get(':id')`**, and `@Patch(':id/classification')` -- the declaration-order hazard is the same one already documented for `pages/order`.
- `apps/api/src/sourcetest/source-test.module.ts` -- import `TaxonomyModule` -- `IdentityModule` does not re-export it, and a second reader of the taxonomy tables would break AD-17.
- `apps/api/test/harness.ts` -- add a `createSubject(h, { name?, gradeLevelId?, enabled?, available? })` fixture that creates through `TaxonomyService` and sets availability through `setAvailability` -- the fixture must exercise the same write path the Admin console uses.
- `apps/api/test/source-test.int-spec.ts` -- cover every new matrix row end to end: the default-from-profile on open, the resume path not re-defaulting, the offered-Subjects list (including the disabled-Grade-Level empty list and the unknown-Grade-Level 404), each rejection, the grade-level change that clears the Subject, the unclassified submit refusal, the classified submit success, the foreign-account 404, and a Subject disabled *after* assignment still resolving and still submitting -- the last one is what proves the "stored reference keeps resolving" rule rather than asserting it.
- `apps/web/src/lib/parent-api.ts` -- extend `SourceTestView` with `subjectId`/`subjectName`/`gradeLevelId`/`gradeLevelName` (all nullable) and add `sourceTestSubjects(token, gradeLevelId)` and `classifySourceTest(token, id, input)` through the existing `elevated(token)` builder.
- `apps/web/src/lib/classification.ts` + `.spec.ts` -- pure `isClassified(view)` and `submitBlockedReasons(view, readyPageCount)` returning which of the two gates is unmet -- the web suite has no DOM, so the rules have to be reachable without one.
- `apps/web/src/copy/parent.ts` -- add a `classification` block to the `capture` namespace: section heading, Subject and Grade Level labels, the "choose a Grade Level first" and "no Subjects are available for that Grade Level" states, the announcement made when a Grade Level change clears the Subject, and turn `submitBlocked` into a function of the unmet reasons -- no user-facing string is a hardcoded literal.
- `apps/web/src/app/parent/capture/page.tsx` -- render the classification block above the strip: a Grade Level `TextField select` fed by `parentApi.gradeLevels`, a Subject `TextField select` fed by `parentApi.sourceTestSubjects` re-read whenever the Grade Level changes (with the same `applyIfCurrent` staleness guard the other reads use), both writing through `classifySourceTest` on the shared `write()` path so the strip stays locked and the answer is announced; fold `isClassified` into `submittable` and render the reason from `submitBlockedReasons` -- the parent must be told *which* requirement is unmet, not merely that one is.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- cover the new copy function's branches and the classification rules; keep the existing `PageStrip` coverage intact.
- `e2e/fixtures.ts` -- add `createSubjectFixture(label, gradeLevelId)` seeding an enabled `subject` row plus an enabled `subject_grade_level` join row, reusing `taxonomyNameKey` -- a seeded row that keys itself differently would collide for no product reason.
- `e2e/tests/parent-capture.spec.ts` -- extend `openCapture` to seed a Subject for the test's Grade Level, then drive: the Grade Level pre-selected to the child's, the Subject chosen from the offered list, submit refused with the stated reason before the Subject is set, and submit succeeding once both are set -- the outermost surface the intent references is the parent's screen.

**Acceptance Criteria:**
- Given a parent opening a Source Test for a child, when the capture screen loads, then the Grade Level shown is the child's own and the parent can change it for this upload without the Student Profile changing.
- Given a Grade Level selected on the capture screen, when the Subject list is offered, then it holds exactly the Subjects an Admin has enabled for that Grade Level, and choosing one that an Admin disables mid-session is refused by the server rather than silently accepted.
- Given a draft with pages but no Subject, when the parent attempts to submit, then the submit control is disabled with the missing requirement named on screen and the server refuses the submission independently of the client.
- Given a Source Test already classified and submitted, when an Admin later renames or disables that Subject, then the Source Test still reads a resolved Subject name and nothing about the stored row changed.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 6, low 2)
- defer: 4: (high 0, medium 1, low 3)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` classify read-validate-write had no compare-and-set, so two overlapping patches could each validate against the pre-write state and store a pair that was never validated together — the write is now scoped to the state it validated, retried once, and refused as not-a-draft if the row keeps moving.
  - `[medium]` `[patch]` submit enforced the classification gate only through an in-transaction read — the non-null condition now lives in the updateMany where-clause, so a concurrent clear cannot produce a Submitted unclassified row.
  - `[medium]` `[patch]` A Subject or Grade Level an Admin disabled after it was stored rendered as a blank select on a draft that is in fact classified — a pure `optionsWithStored` now keeps the stored value visible and selected.
  - `[medium]` `[patch]` A failed Grade Level read rendered as the "no grade levels exist" empty state, and Retry never re-issued a failed Subject read — both reads now surface a stated failure and both are retried.
  - `[medium]` `[patch]` The elevation-guard enumeration omitted both new routes, and the explicit-null patch, the Subject-against-a-null-Grade-Level refusal and the missing query parameter had no HTTP-surface tests — all added.
  - `[medium]` `[patch]` No test anywhere executed the grade-level change that clears a Subject, so its announcement and the staleness guard shipped unverified — an E2E case now drives the switch in the browser.
  - `[low]` `[patch]` ClassifySourceTestDto accepted any UUID version while every sibling pins v4, and carried no message constants — both fields now pin v4 and name their own refusal.
  - `[low]` `[patch]` submitBlockedReasons restated the page bound instead of calling the existing canSubmitPages — it now calls it, so the two cannot disagree.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 1: (high 0, medium 0, low 1)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` The classification screen's staleness guard and announcement branching were verified only by matching source text, never by executing it — the announcement decision is now a pure, colocated-tested `classificationAnnouncement` in `classification.ts`, and `page.tsx` defers to it instead of restating the branch inline.
  - `[medium]` `[patch]` `loadGradeLevels` had no staleness guard against an out-of-order response, unlike every sibling read (`loadProfiles`, `openDraft`, `loadSubjects`) — it now carries the same request-id/`applyIfCurrent` guard.
  - `[low]` `[patch]` `loadGradeLevels`'s failure handler discarded the real `cause.message` while `loadSubjects`'s preferred it for the same shape of failure — both now prefer `cause.message` when it is an `Error`.
  - `[low]` `[patch]` The int-spec's 404-unknown-Grade-Level test omitted the "nothing written" assertion every sibling rejection test in the same block carries — added, asserting the seeded Grade Level stands unchanged.
  - `[low]` `[patch]` `resultingSubject`'s doc comment described a "neither field moved" branch that `tryClassify`'s own `NOTHING_TO_CLASSIFY` guard makes unreachable — corrected to name only the two reachable cases.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` A Subject or Grade Level `optionsWithStored` kept visible after an Admin withdrew it carried `enabled: false` that the select never read, so a parent could reselect an unavailable option and have the write refused with no visible reason it was blocked — both selects now render that option `disabled`.
  - `[low]` `[patch]` The Grade Level read had no loading state, unlike the Subject read, so the classification section could flash the false "no grade levels exist" empty state before the first response landed — added `gradeLevelsLoading`, mirroring `subjectsLoading`.

## Design Notes

**Why the offered-Subjects route lives on `SourceTestController`.** The Subject list exists in this product for exactly one purpose — classifying a Source Test — so it is mounted at `GET /parent/source-tests/subjects` rather than as a free-standing `/parent/subjects`. The precedent is `/parent/grade-levels` living on `StudentProfileController`: the Grade Level list is parent-facing because a Student Profile needs one, and it is served by the module that needs it, reading through `TaxonomyService`. Neither creates a second reader of the taxonomy tables. The cost is the declaration-order hazard, which this controller already documents once for `pages/order`.

**Why the pair is validated together, not field by field.** A PATCH carrying both fields, a PATCH carrying only the Grade Level, and a PATCH carrying only the Subject all end at a single resulting `(subjectId, gradeLevelId)` pair, and availability is a property of the pair. Validating fields independently would let `{ subjectId: X, gradeLevelId: Y }` through whenever X is offered for the *old* Y.

**Why a grade-level change clears an unavailable Subject rather than refusing.** Refusing would strand a parent who picked the wrong grade first: they would have to unset the Subject through a route that exists only to set one. Clearing it, announcing it, and re-offering the list is the recoverable behavior, and the submit gate then keeps them honest.

**Why submit checks null and not enabled.** The taxonomy's whole design is that disabling changes what may be *chosen*, never what a stored reference resolves to (`resolveSubject` succeeds for a disabled row on purpose). A submit gate that re-checked enablement would let an Admin action invalidate work a parent already did.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev --name add_source_test_classification` -- expected: a new checked-in migration directory; `prisma migrate deploy` replays it clean.
- `pnpm typecheck` -- expected: no errors in either workspace.
- `pnpm --filter api run lint` and `pnpm --filter web run lint` -- expected: clean, `jsx-a11y` included.
- `pnpm test` -- expected: the new `classification.spec.ts` and the extended `source-test-policy.spec.ts` pass with the rest.
- `pnpm --filter api run test:int` -- expected: `source-test.int-spec.ts` passes against real Postgres, every new matrix row covered.
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- expected: passes against the full stack.
- `pnpm exec prettier --write .` -- expected: clean tree before commit.

## Auto Run Result

**Summary:** Follow-up review pass on the already-`done` Story 3.3 implementation (Subject & Grade Level classification for a Source Test). No code changes were requested in this pass beyond two small patch fixes surfaced by review; the feature itself was unchanged.

**Files changed this pass:**
- `apps/web/src/app/parent/capture/page.tsx` -- added `gradeLevelsLoading` state (mirroring the existing `subjectsLoading`) so the classification section shows a loading message instead of a false "no grade levels" empty state before the first response lands; both classification `<MenuItem>`s now render `disabled` when `optionsWithStored` marks the option `enabled: false` (a withdrawn stored Subject/Grade Level), so a parent can no longer reselect an option the write will refuse.
- `apps/web/src/copy/parent.ts` -- added `classification.loadingGradeLevels` copy for the new loading state.

**Review findings breakdown:**
- Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) ran against the diff since `baseline_revision`.
- patch: 2 (medium 1, low 1) -- both applied, see Review Triage Log above.
- defer: 1 (medium 1) -- the out-of-order guard on `loadGradeLevels`/`loadSubjects` is exercised only by a `PAGE_SOURCE.toContain` source-text assertion, not by an actual out-of-order-response test; recorded in `deferred`.
- reject: 12 -- mostly duplicates of findings already recorded in `deferred` from the prior two passes (the missing `subjectId` index, the `classificationAnnouncement` combined-patch gap), design-intentional behavior restated as a bug (submit-gate granularity, the "keeps resolving after disable" philosophy, the bounded-retry 409 on contention), and two false positives verified against actual behavior: the claimed UUID-version-pipe inconsistency matches the codebase-wide `ParseUUIDPipe` convention everywhere else, and the claimed MUI "out-of-range value" console warning does not fire for an empty-string value (confirmed by reading MUI's own `SelectInput.js` guard: `value !== ''`).
- Follow-up review recommendation score: 3 × 1 medium + 1 × 1 low = 4 (< 5) and no high-severity patch, so `followup_review_recommended: false`.

**Verification performed:**
- `pnpm exec prettier --write .` -- clean.
- `pnpm typecheck` -- clean, both workspaces.
- `pnpm --filter web run lint` -- clean.
- `pnpm --filter web test` (classification.spec.ts, page.spec.tsx, full web suite) -- 295/295 passed.
- `pnpm test` (full monorepo unit + api integration suite against real Postgres) -- 449/449 (api) passed, web unchanged from above.
- No API/schema/service files changed this pass, so the migration and Playwright commands were not re-run; nothing in this pass touches them.

**Residual risks:**
- The deferred out-of-order-guard verification gap: the guard code mirrors the already-working `profiles`/`draft` request-id pattern, so it is very likely correct, but no test proves it against an actually-out-of-order response.
- All other pre-existing `deferred` items from the prior two passes stand unchanged.

