---
title: 'Story 4.5: Release or Discard'
type: 'feature'
created: '2026-09-25'
baseline_revision: 'cf36aab3945140a202e4072d94d9143793676b37'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-4-draft-editing.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The release and discard controls, their confirmations and the new Student Home list are
      covered by specs that grep their own source text rather than render them, so no
      executing unit test drives either transition or the released list in a DOM.
    evidence: |-
      `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` and
      `apps/web/src/app/student/page.spec.tsx` assert with `expect(SOURCE).toContain(...)`
      against `readFileSync(page.tsx)`. Swapping `RELEASED_DRAFTS_HREF` and
      `DISCARDED_DRAFTS_HREF` at the one `router.replace(transition === ...)` call site --
      which would tell a parent a release was a discard, and the reverse -- leaves every
      searched string in place and ships green. `apps/web/vitest.config.ts` sets
      `environment: 'node'` and no testing-library dependency exists under `apps/web`, so a
      real render test needs a DOM the web tier does not have. Carried from Stories 4.3 and
      4.4; this story adds more instances of it. The Playwright pass is the compensating
      surface, and it does assert both landing sentences by their own test ids.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx;
      apps/web/src/app/student/page.spec.tsx
    severity: medium
  - summary: >-
      The api test suite fails 1-2 non-deterministic tests on a full parallel run, at the baseline
      revision as well as on this story, always as a 404 on an unrelated parent or admin route.
    evidence: |-
      Reproduced at `cf36aab` by stashing this story's changes: two consecutive full runs of
      `pnpm --filter api test` failed two tests each, a different pair every time
      (`the request > answers 404 for a Source Test belonging to another account`,
      `topic weighting > judges the label itself, not the padding around it`,
      `validation.int-spec.ts > rejects a missing name with 400`,
      `source-test.int-spec.ts > keeps a Subject the new Grade Level still offers`). The stack is
      always the same shape: a setup call such as `setPinFor` (harness.ts:544) answering 404 where
      it expects 204, i.e. the account it just created is gone. Every failing spec passes in
      isolation. The cause is test isolation, not product code: spec files run in parallel against
      one Postgres database and several call `resetParentAccounts`/`resetTaxonomy` in `beforeEach`,
      so one file's reset deletes rows another file's in-flight case depends on. Needs either a
      per-file schema or database, or `fileParallelism: false` for the integration specs.
    location: >-
      apps/api/vitest.config.ts; apps/api/test/harness.ts
    severity: medium
  - summary: >-
      `releasedFor` is unbounded and has no index matching its own predicate, so a child's Student
      Home read grows without limit as releases accumulate.
    evidence: |-
      The query filters `(parentAccountId, studentProfileId, status)` and sorts
      `createdAt desc, id desc` with no `take`. The only relevant index on `practice_test` is
      `@@index([studentProfileId])`; the allowance index `@@index([parentAccountId, chargedAt])`
      does not serve this shape. A composite index and a cap belong with the first cross-boundary
      read, but both require a migration, which this story's intent excludes. Harmless at v0
      volumes and a real cost once a child has a year of releases.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (releasedFor); apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      A transition's response `siblingCount` counts the drafts that remain, so it can contradict the
      `ordinal` beside it.
    evidence: |-
      `transitionTo` recomputes `count({ generationJobId, status: 'Draft' })` after the row has left
      `Draft`, so releasing the only draft of a job answers `ordinal: 1, siblingCount: 0` — which
      `parentCopy.drafts.position` would render as "Draft 1 of 0". Unobserved only because the
      screen navigates away on success and never draws the returned view. This is the identical
      shape Story 4.4's `deleteQuestion` discard branch already ships, so fixing it is a change to
      the view contract both transitions and the delete share, not a local repair.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (transitionTo)
    severity: low
  - summary: >-
      No parent-visible surface lists what a child can now see, so after an irreversible release the
      only confirmation is a transient sentence on Pending drafts.
    evidence: |-
      `draftsFor` scopes `status: 'Draft'` and the parent draft read 404s a released id, by design.
      Nothing in Story 4.5's acceptance criteria asks for a parent-side released list and Epic 5's
      Story 5.1 owns only the student's, so no story currently owns it — which is why it is recorded
      here rather than built. A parent who reloads after `?released=1` has no way to confirm what
      was released.
    location: >-
      apps/web/src/app/parent/drafts/page.tsx
    severity: low
  - summary: >-
      The comment-stripping regexes the web page specs use to build their searchable source can eat
      string literals, silently weakening the word bans built on them.
    evidence: |-
      `.replace(/\/\/.*$/gm, '')` deletes everything after any `//` on a line, including one inside
      a string such as a URL, and `/\/\*[\s\S]*?\*\//g` can span string boundaries. A banned word
      sitting after such a sequence stops being checked, so the "ban on the code, not the prose"
      guarantee is weaker than it reads. Pre-existing across the drafts and student page specs
      rather than introduced here; this story adds callers of it.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx;
      apps/web/src/app/student/page.spec.tsx
    severity: low
  - summary: >-
      No test drives an elevation bearer expiring in the exact window between the
      release/discard confirmation opening and the parent confirming it, so the
      401/403-on-expiry path for these two new actions is unverified.
    evidence: |-
      `e2e/tests/parent-practice-test.spec.ts` covers a 500 and a 404 on each
      transition but not a 401/403. The `endsParentView`/expiry handling itself is
      pre-existing and shared by edit and delete, and those actions carry no such
      test either, so this is a gap in the established pattern rather than
      something this story introduced alone.
    location: >-
      e2e/tests/parent-practice-test.spec.ts;
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (confirmTransition)
    severity: low
  - summary: >-
      If the elevation token becomes null in the narrow window between opening a
      release/discard confirmation and clicking confirm, `confirmTransition`
      silently returns with the dialog left open, no error and no way for the
      parent to tell why nothing happened.
    evidence: |-
      `confirmTransition` guards with `if (token === null || transition === null)
      return;` — no `setActionError`, no `leave()`, no dialog dismissal. The window
      is narrow (elevation expiry mid-confirmation) and Cancel still works, so this
      is a rough edge rather than a lost action, and is not new to this story's
      pattern of guarding on `token === null`.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (confirmTransition)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Stories 4.3 and 4.4 gave the parent a draft they can read and fix, but no way to finish. Every generated Practice Test is still stuck in `Draft`, unreachable by the child it was made for — the epic's whole point is a human quality gate, and a gate with no *open* is a wall. Discard likewise exists only as a side effect of deleting the last Question.

**Approach:** Add the two terminal transitions the schema already names. Two elevation-guarded, `Draft`-only mutations on `practicetest` — release and discard — each behind a confirmation that states its consequence in words before it fires, plus the first student-scoped read of a Practice Test: released ones only, for the bound profile, with no Question content at all. Release makes the test visible on Student Home; discard removes it from everywhere a child or a downstream reader can see.

## Boundaries & Constraints

**Always:**
- Both transitions sit behind `ParentElevationGuard` in `PracticeTestController`, take the account from `req.elevated`, and scope `parentAccountId` **and** `status: 'Draft'` inside the statement that mutates — so an unknown id, another account's id, an already-`Released` id and an already-`Discarded` id all answer the **same 404 `PRACTICE_TEST_NOT_FOUND`** by construction, never 403 and never a distinguishable sentence (AD-18).
- That identical 404 on a second release **is** the irreversibility: release is one-way in v0, and no route, flag or parameter anywhere returns a `Released` row to `Draft`.
- The released-state write barrier now has teeth to prove: `editQuestion` and `deleteQuestion` refuse a `Released` row with the same 404 they already refuse a foreign one with. This story adds the tests, not the check.
- Neither transition touches `chargedAt` and neither writes an allowance figure. A discard does not refund (AD-14), and the derived usage count is unchanged by either transition because it counts rows that have *ever* reached draft.
- Each transition answers with the full `PracticeTestDraftView` the read and both 4.4 mutations already return, carrying the new `status` — the screen reads the status rather than inferring success from a bare 204.
- The student-scoped read is **one new route**, `GET /student/practice-tests`, behind `StudentModeGuard`, scoped to `parentAccountId` **and** `studentProfileId` from `req.student` and to `status: 'Released'`. It is a **summary**: id and question count per row, nothing else. No prompt, no answer, no option body, no Topic label, no allowance figure, no tier, no model name (AD-20, AD-26). A `Draft` or `Discarded` row is not in it.
- Ordered server-side, `createdAt desc` with `id desc` breaking the tie — the same rule `draftsFor` states, for the same reason.
- Release and discard are **per draft**. No batch control, no "release all", and a released test appears on Student Home on its own.
- Both confirmations name the consequence **before** the action. Release states that the practice test becomes visible to that child immediately and can no longer be changed; discard states that the child never sees it and that the Generation Allowance already spent is not given back.
- Every user-facing string is parameterized — `apps/web/src/copy/parent.ts` in the third person about the student, `apps/web/src/copy/student.ts` in the second person to the child. Plain fact: no exclamation marks, no cheerleading, no upsell, no error codes.
- The child's display name on the review screen is joined in the browser from the Student Profile read, exactly as Pending drafts does it — `practicetest` reads no identity table (AD-17). A name not in hand falls back to `parentCopy.drafts.unknownStudent`; it never blocks the release control.
- Student Home stays cookie-only: it reaches `GET /api/student/session` and `GET /api/student/practice-tests` and no parent-scoped call, and it never names a profile id.

**Block If:**
- Nothing. The epic's acceptance criteria, FR-14 and the existing `PracticeTestStatus` enum fully specify this story.

**Never:**
- No timer field, no timer route, no suggested duration — Story 4.6.
- No Attempt, no answering, no grading, no Subject label, no released/in-progress/completed state distinction and no sort band on the student list — Epic 5 (Story 5.1) owns the list a student works from. This story ships **visibility** and nothing a child can do with it beyond seeing that it is there.
- No Analytics surface and no Analytics query: Epic 7 owns it. Discard's exclusion from Analytics is inherited rather than implemented — see Design Notes.
- No new table, no new column, no migration, no queue job, no AI call. `PracticeTestStatus` already carries both states.
- No unrelease, no recall, no undo, no soft-restore of a discarded row, no revision history.
- No new student-scoped **write** of any kind: `StudentModeController` and the new controller are reads only.
- No release or discard path that does not pass through a parent's confirmation; nothing auto-releases on job completion, on the last edit, or on anything else.
- No Question content on any student-scoped response, and no server-rendered parent data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Release a draft | `POST /parent/practice-tests/:id/release` on an owned `Draft` | Row is `Released`; the answer is the full view with `status: 'Released'`; `chargedAt` unchanged | No error expected |
| Release again | Same call on the now-`Released` id | Refused; nothing is written | 404 `PRACTICE_TEST_NOT_FOUND` |
| Discard a draft | `POST /parent/practice-tests/:id/discard` on an owned `Draft` | Row is `Discarded`; the answer carries `status: 'Discarded'`; `chargedAt` unchanged | No error expected |
| Discard a released test | Discard on a `Released` id | Refused — release is terminal | 404 `PRACTICE_TEST_NOT_FOUND` |
| Read a released draft afterwards | `GET /parent/practice-tests/:id` for a just-released id | The same 404 an unknown id gets | 404 `PRACTICE_TEST_NOT_FOUND` |
| Released row leaves Pending drafts | `GET /parent/practice-tests/drafts` after a release | The released id is absent; the remaining drafts' `siblingCount` reflects the smaller set | No error expected |
| Edit or delete after release | `PATCH`/`DELETE` a Question of a `Released` row | Refused; no row is written | 404 `PRACTICE_TEST_NOT_FOUND` |
| Foreign or unknown id | Either transition with another account's or a random id | Refused as though it did not exist | 404 `PRACTICE_TEST_NOT_FOUND` |
| Malformed id | Path segment not a UUID | Refused on shape before a row is read | 400 from `ParseUUIDPipe` |
| Unelevated call | Either transition with no elevation bearer | Refused by the guard | 401 |
| Student reads released tests | `GET /student/practice-tests` with a binding cookie, one released and one draft in the account | 200 with exactly the released row: `{ id, questionCount }`; no question text anywhere in the body | No error expected |
| Student reads with nothing released | Same call, account holds drafts only | 200 with `[]` — a state, never a 404 | No error expected |
| Student reads another child's release | Binding on profile A, release made for profile B | 200 with `[]` — scoped by the bound profile, not by the account | No error expected |
| Discarded test on the student read | A `Discarded` row for the bound profile | Absent from the list | No error expected |
| Student read, unbound device | No binding cookie, or a stale one | Refused by the guard, cookie cleared as it already is | 401 `bound: false` |
| Student read with an elevation bearer | The parent's bearer, no cookie | Refused — wrong audience | 401 |
| Screen: release confirmed | Parent releases the draft they are reading | Confirmation names the child and says it becomes visible and unchangeable; on confirm the parent lands on Pending drafts, told it was released | Server's own sentence surfaced on a 4xx |
| Screen: discard confirmed | Parent discards the draft they are reading | Confirmation says the child never sees it and that the spent allowance is not given back; on confirm the parent lands on Pending drafts, told it was discarded | Cancel leaves the draft untouched |
| Screen: draft moved out from under it | Release fires on an id another tab already released | The screen's existing missing state, with the way back | 404 handled as the read's own 404 already is |
| Student Home: one released test | Bound device, one released | The list is rendered and the "nothing yet" sentence is gone | Read failure is retryable and never routes the child away |

</intent-contract>

## Code Map

**Change these:**

- `apps/api/src/practicetest/practice-test.service.ts` -- add `release(parentAccountId, practiceTestId)` and `discard(parentAccountId, practiceTestId)` beside `deleteQuestion` (:723), and `releasedFor(parentAccountId, studentProfileId)` beside `draftsFor` (:471). Both transitions use `updateMany` with `{ id, parentAccountId, status: 'Draft' }` in the `where` and `count !== 1 → NotFoundException(PRACTICE_TEST_NOT_FOUND)`, exactly the shape `deleteQuestion`'s `deleteMany` (:729-740) already uses — then build the answer from `DRAFT_SELECT` (:1354) + `draftViewOf` (:1393) inside the same transaction, as `deleteQuestion`'s discard branch (:779-792) already does for a row that is no longer a draft. Log identifiers only (AD-20), after the commit. Add a `PracticeTestReleasedSummary` interface beside `PracticeTestDraftSummary` (:207).
- `apps/api/src/practicetest/practice-test.controller.ts` -- add `POST practice-tests/:id/release` and `POST practice-tests/:id/discard` below `deleteQuestion` (:190+), same guard, same `ParseUUIDPipe`. Extend the header comment: the gate now *opens*, and the identical 404 on a second release is what makes irreversibility a property of the statement rather than a promise.
- `apps/api/src/practicetest/student-practice-test.controller.ts` (new) -- `@Controller('student')`, `@UseGuards(StudentModeGuard)`, one `@Get('practice-tests')` taking both ids from `req.student`. Mirrors `StudentModeController` (`apps/api/src/identity/student-mode.controller.ts`) in shape and in its header comment's claim: still no student-scoped write, and still not one word of generated content.
- `apps/api/src/practicetest/practice-test.module.ts` -- register the new controller and add `StudentModeGuard` to `providers`, for the same reason `ParentElevationGuard` is constructed here (:49): an enhancer is built in its own controller's injector. `IdentityModule` already exports `ParentAccountService` and `StudentProfileService`, and this module already registers `JwtModule` on the parent secret — the guard's three dependencies, with nothing new imported.
- `apps/api/src/practicetest/practice-test-policy.ts` -- nothing new to add. `PRACTICE_TEST_NOT_FOUND` (:120) is the one sentence every ownership and state refusal shares (AD-18); do **not** introduce `ALREADY_RELEASED` or similar, which would let the outside tell the refusals apart.
- `apps/api/test/practice-test.int-spec.ts` -- a `describe('release and discard')` block beside `describe('draft editing')` (:1607), reusing that file's `withDrafts` helper (:1356). Every matrix row that touches a row. Extend `Ready` (:92) and `generatable` (:107) to carry `studentProfileId` so the student read can be bound and driven here.
- `apps/api/test/student-mode.int-spec.ts` -- the `exposes no practice-test path to a bound device` case (:538) asserts `/api/student/practice-tests` answers **404**; that path now exists. Change that one entry to assert the released-only contract against a real `Draft` in the same account: 200, `[]`, and no `draft.id` and no question text in the body. Every other probed path stays 404, and both parent writes stay 401.
- `apps/web/src/lib/parent-api.ts` -- add `releasePracticeTest` and `discardPracticeTest` beside `deleteDraftQuestion` (:905), both returning `PracticeTestDraftView`; and `studentPracticeTests()` beside `studentSession` (:604) — cookie only, no bearer. Add a `StudentPracticeTestSummary` interface beside `PracticeTestDraftSummary` (:238).
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` -- a release control and a discard control for the draft as a whole, each behind an `AppDialog` confirmation (the same dialog the delete confirmation uses at :930 — **not** `DestructiveConfirmDialog`, which re-asks for the account password). Both reuse the existing `failed`/`busy`/`actionError` machinery and, on success, `router.replace` to Pending drafts with the outcome in the URL, exactly as the delete-to-zero branch (:545-556) already does. Add a `parentApi.students(token)` read for the child's name, as `apps/web/src/app/parent/drafts/page.tsx` (:154-165) does, failing soft to `unknownStudent`. Drop every slot the draft holds on either transition — `discardEverySlot` (:465) already exists for exactly this.
- `apps/web/src/app/parent/drafts/page.tsx` -- `DiscardedNotice` (:73) becomes an outcome notice covering `?released=1` as well as `?discarded=1`, one alert either way.
- `apps/web/src/app/student/page.tsx` -- read `parentApi.studentPracticeTests()` beside the session read, settled **independently** of it for the reason Pending drafts states: one failing read must not blank a screen the other answered. Render the released rows as a real list with restored `role="list"`/`role="listitem"`, and show `studentCopy.empty` only when the list came back empty.
- `apps/web/src/copy/parent.ts` -- extend the `drafts` block (:505+): the two controls, the two confirmation titles and bodies, the two confirm labels, the two landing sentences on Pending drafts, and the two failure sentences.
- `apps/web/src/copy/student.ts` -- the released list's heading and each row's label. Second person, no exclamation mark, and no hardcoded figure.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx`, `apps/web/src/app/parent/drafts/page.spec.tsx`, `apps/web/src/app/student/page.spec.tsx`, `apps/web/src/lib/parent-api.spec.ts` -- the screens' and the client's cases in each file's existing style. `student/page.spec.tsx`'s `expect(SOURCE).not.toMatch(/parentApi\.(?!studentSession)/u)` must be widened to the two permitted calls and no more; its `not.toMatch(/studentProfileId/u)` and its no-figure sweep stay.
- `e2e/tests/parent-practice-test.spec.ts` -- extend the browser pass: release a draft and read it back through **Student Mode** via the layout's `Back to Student Mode` control (`apps/web/src/app/parent/_components/BackToStudentMode.tsx`), and discard another and see it gone from Pending drafts.

**Read-only evidence (do not change):**
- `apps/api/prisma/schema.prisma:753-760` — `PracticeTestStatus` already names `Released` and `Discarded` as "Story 4.5's transitions; neither refunds". `:862` is `chargedAt`, the column neither transition touches. No migration.
- `apps/api/src/identity/student-mode.guard.ts` — the cookie-only guard, complete since Story 1.4. This story is a caller.
- `apps/api/src/practicetest/practice-test.service.ts:1393` (`draftViewOf`), `:1354` (`DRAFT_SELECT`), `:563` (`draftViewIn`) — the one mapper; do not write a second.
- `_bmad-output/planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/prd.md:387-394` — FR-14, including the recorded `[ASSUMPTION: unrelease/recall is not needed for v0.]`.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/practicetest/practice-test.service.ts` -- add `release`, `discard` and `releasedFor` -- the two transitions are the story, and scoping `Draft` inside the mutating statement is what makes irreversibility and the write barrier properties of the statement rather than checks somebody has to remember.
- `apps/api/src/practicetest/practice-test.controller.ts` -- add the two routes and extend the header comment -- the module that guarded the gate now opens it, and why a second release is a 404 belongs beside the route.
- `apps/api/src/practicetest/student-practice-test.controller.ts` (new) + `apps/api/src/practicetest/practice-test.module.ts` -- the first student-scoped read of a Practice Test, and its guard -- "visible in Student Mode" is the acceptance criterion, and a summary with no content is the smallest read that satisfies it without handing a child the answer key Epic 5 has not built the surface for yet.
- `apps/api/test/practice-test.int-spec.ts` -- integration-cover every matrix row that touches a row, against real Postgres -- especially the second release, the discard of a released row, the post-release 404 on all four parent routes, the unchanged `chargedAt`, and the student read's profile scoping.
- `apps/api/test/student-mode.int-spec.ts` -- retarget the one probe that assumed this path did not exist -- the boundary case must now assert what the path *serves* rather than that it serves nothing, or the epic's "a draft never appears in Student Mode" criterion loses its only executing test.
- `apps/web/src/lib/parent-api.ts` + `parent-api.spec.ts` -- add the three calls -- method, URL, bearer-or-cookie and the returned shape, asserted like every sibling call.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` + `page.spec.tsx` -- the two controls, the two confirmations, the child's joined name, and the slot cleanup -- the gate a parent can finally close in either direction.
- `apps/web/src/app/parent/drafts/page.tsx` + `page.spec.tsx` -- state either outcome on arrival -- the screen that knows is the one being navigated away from, and a live region unmounted mid-announcement says nothing.
- `apps/web/src/app/student/page.tsx` + `page.spec.tsx` -- render the released tests -- this is the surface the acceptance criterion names, and it stays cookie-only with no parent-scoped call and no profile id.
- `apps/web/src/copy/parent.ts` + `apps/web/src/copy/student.ts` -- the new strings -- parameterized, plain fact, and the two confirmations state their consequence in advance because there is no undo.
- `e2e/tests/parent-practice-test.spec.ts` -- release and read it back in Student Mode, and discard one -- the criterion is about what a child can see, which only a browser crossing the mode boundary can prove.

**Acceptance Criteria:**

- Given a draft the parent is reading, when they release it, then the stored row is `Released`, it is gone from Pending drafts, the parent is told on arrival there that it was released, and the practice test is visible on that child's Student Home.
- Given a draft, when the parent discards it, then the stored row is `Discarded`, it appears on no parent draft surface and on no student-scoped response, and `chargedAt` is unchanged.
- Given a `Released` Practice Test, when release, discard, a Question edit or a Question delete is called on it with a valid elevation token, then each answers a 404 whose sentence is identical to the one an unknown id gets, and nothing is written.
- Given a device bound to one child, when the student read is made, then it returns exactly that child's `Released` Practice Tests as `{ id, questionCount }` rows — never a `Draft`, never a `Discarded` one, never another child's, and never a prompt, an answer, an option body, a Topic label or an allowance figure.
- Given a parent about to release or discard, then the confirmation states the consequence before the action: release, that the child can see it immediately and it can no longer be changed; discard, that the child never sees it and the Generation Allowance already spent is not given back.
- Given any log line or error message produced by either transition, then it carries identifiers only — no Question text, no Topic label, no allowance figure, no tier, no model name.
- Given no Practice Test has been released for the bound child, then Student Home says so as plain fact and reaches no parent-scoped endpoint and names no profile id.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass (2)

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 2: (high 0, medium 0, low 2)
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[low]` `[patch]` The int-spec proved release's removal from Pending drafts
    (row absent, `siblingCount` down) but had no equivalent case for discard,
    though the acceptance criteria state the same "appears on no parent draft
    surface" claim for both terminal states symmetrically. Added
    `takes a discarded row out of Pending drafts too, and the sibling count
    with it` beside the release case in `apps/api/test/practice-test.int-spec.ts`.

### 2026-09-25 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 6: (high 0, medium 2, low 4)
- reject: 11: (high 0, medium 1, low 10)
- addressed_findings:
  - `[medium]` `[patch]` Student Home's practice-test read set nothing on a non-404 rejection, so a
    500, a 429 or a dropped connection on that read alone left `tests === null` *and*
    `error === null`: no rows, no "nothing yet" sentence, and no error — which meant the retry
    control, rendered only from a failure, was unreachable and a child sat on a greeting with
    nothing to act on. The list now carries its own `testsError` with its own alert and a retry
    that re-issues both reads, and the session's greeting still renders beside it.
  - `[medium]` `[patch]` Neither transition's failure path was driven by anything that ran.
    Omitting `setBusy(null)` from the catch — which disables every control on the screen for the
    rest of the session — shipped green, as did swapping the two failure sentences. A Playwright
    case now intercepts both routes: a 500 on release asserts the release's own sentence, the
    unchanged URL, the whole draft, an empty notice and both controls enabled again; a 500 on
    discard asserts the discard's own sentence; and a 404 asserts the missing state with the way
    back rather than a fault or a navigation.
  - `[medium]` `[patch]` Nothing asserted that the confirmation names the child, so the whole
    `parentApi.students` join could degrade to `unknownStudent` ("A student profile") for every
    parent with no test failing. Both dialogs now assert the name the flow already creates.
  - `[low]` `[patch]` No assertion anywhere proved `student-empty` *visible* on a bound device with
    nothing released — the only other reference was a `toHaveCount(0)` in a non-empty state, which
    the sentence never rendering at all satisfies. Added where a bound device with no releases
    already stands, in `student-mode.spec.ts`.
  - `[low]` `[patch]` The ordering case built its expectation from a second Prisma query carrying
    the service's own `orderBy`, and its two rows had distinct `createdAt`, so the `id: 'desc'`
    tiebreak was never reached and deleting it passed. Both rows are now forced to one literal
    instant and the expected sequence is computed in the test from the ids it already holds.
  - `[low]` `[patch]` The write barrier was proven only for a `Released` id, though both the
    controller and the service assert the two terminal states behave identically. Added the
    equivalent case for a `Discarded` id across all five parent routes.
  - `[low]` `[patch]` The no-content case regex-checked the `PRACTICE_TEST_NOT_FOUND` constant,
    which this story does not change, so it could not fail for any reason related to release or
    discard. It now reads the draft's real prompt, answer, option bodies and Topic labels and
    sweeps the actual response bodies of a refused release and a refused discard for each of them,
    plus allowance/tier/model wording, the account id, and any word that would let the outside tell
    the two refusals apart.
  - `[low]` `[patch]` `releasedFor` described its order as "newest first" as though about release,
    but `createdAt` is generation time: a test generated last week and released today sorts below
    one generated this morning. There is no `releasedAt` column and this story adds none, so the
    words were corrected — in the service, the student controller and the web client — to state
    the made-at instant and why it is what is available.
  - `[low]` `[patch]` A `findFirstOrThrow` selected `prompt` and discarded it, then a second
    `findUniqueOrThrow` re-read the same column. Collapsed to one query.

## Design Notes

**Why a second release is a 404 and not a 409.** Irreversibility could have been a distinct refusal — "this is already released". It is deliberately the module's one sentence instead. `Draft` is in the `where` of the statement that mutates, so *not being a draft any more* is indistinguishable from *never having been this account's*, which is the same rule AD-18 already imposes on the reads and on 4.4's writes. A 409 would be a second sentence for one rule, and would let anything outside enumerate which of another account's ids exist by reading which refusal came back.

**Why the student read carries no Question content.** "Becomes visible in Student Mode" is a claim about visibility, and this epic ends there: taking the test is Epic 5. A student-scoped read that already returned prompts, options and *correct answers* would hand a child the answer key before any surface existed to grade an Attempt against — the exact leak the whole gate exists to prevent. So the row is an identifier and a count, which is enough for Student Home to render and enough for Epic 5's list to grow from.

**How discard's exclusion from Analytics is met without Analytics.** Epic 7 owns Analytics; there is no query here to exclude a row from. What this story does instead is make the exclusion structural: `practicetest` is the sole owner of these tables (AD-17), so every downstream reader goes through its service, and the only cross-boundary read of a Practice Test that now exists — `releasedFor` — scopes `status: 'Released'` in the statement. A `Discarded` row is therefore not something Epic 7 must remember to filter; it is something it cannot reach. The int-spec asserts that directly: a `Discarded` row for the bound profile is absent from the read.

**The transition, in the shape `deleteQuestion` already established:**

```ts
// `updateMany` with the state in the `where`, not `update` after a check: a row
// released by another tab between a read and this statement would make the check
// stale, and `update` would surface Prisma's own missing-row fault as a 500.
const moved = await tx.practiceTest.updateMany({
  where: { id: practiceTestId, parentAccountId, status: 'Draft' },
  data: { status: to }, // `chargedAt` is absent on purpose (AD-14).
});
if (moved.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
// The row is no longer a draft, so the `Draft`-scoped reader would refuse it —
// correctly. The view is built here, as the discard branch of `deleteQuestion`
// already does, carrying the new status for the screen to read.
```

**Why the review screen navigates away.** Both transitions leave the parent on a URL whose read now 404s. Rather than render the missing state — which reads as a fault — the screen goes to Pending drafts and hands the outcome over in the URL, the mechanism Story 4.4 already built for delete-to-zero. One notice component there, two sentences.

## Verification

**Commands:**
- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter api test` -- expected: the unit suite passes.
- `pnpm --filter api test:int` -- expected: `practice-test.int-spec.ts` and `student-mode.int-spec.ts` pass against real Postgres, covering both transitions, every refusal, the post-release write barrier and the student read's scoping.
- `pnpm --filter web test` -- expected: `parent-api.spec.ts`, both drafts page specs and `student/page.spec.tsx` pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the extended pass releases a draft and reads it back in Student Mode, and discards one.
- `pnpm prettier --check .` -- expected: clean. (`pnpm lint` is known-unusable here — `eslint` is not installed; run `pnpm exec eslint` on changed files instead.)

## Auto Run Result

**Summary:** Story 4.5 was already implemented and committed (`74f88e8`) when this run started; this pass was a fresh review cycle (`status: done` → `in-review`), not a re-implementation. Four review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran against the diff since baseline `cf36aab`. One low-severity test-coverage gap was patched; two low-severity items were deferred; the rest were rejected as noise, already covered by an existing deferred item, or intentional per the intent contract.

**Files changed this pass:**
- `apps/api/test/practice-test.int-spec.ts` -- added a discard-side counterpart to the existing release-side test proving a terminal transition removes the row from Pending drafts and updates the remaining siblings' `siblingCount`.

**Review findings breakdown:**
- patch: 1 (low) -- applied (see Review Triage Log above).
- defer: 2 (low) -- added to frontmatter `deferred`: a missing 401/403-on-elevation-expiry e2e case for release/discard, and `confirmTransition`'s silent no-op when the token goes null mid-confirmation.
- reject: 13 (low) -- included: a synthetic-concurrency test for `transitionTo` (redundant given the atomic `updateMany`), an unbounded-list pagination concern (duplicate of an already-deferred item), an unexplained `@SkipThrottle` copy (intentional mirroring of `StudentModeController`), a dead defensive branch in `transitionTo` (mirrors `deleteQuestion`'s established shape), missing OpenAPI annotations (no such convention exists in this codebase), a "cannot be undone" phrasing duplication (matches the pre-existing `deleteLastBody` convention), and others judged out of this story's scope or already covered by deferred item 1 (the source-text-only web spec style, carried from Stories 4.3/4.4).
- Follow-up review recommendation: `false`. Only this pass's `patch` findings count: 1 low, `3×medium + 1×low = 1`, below the 5 threshold, and none were high severity.

**Verification performed:**
- `pnpm --filter api typecheck` -- clean.
- `pnpm --filter web typecheck` -- clean.
- `pnpm --filter api test:int -t "takes a discarded row out of Pending drafts too"` -- new test passes; full `test:int` run (20 files, 534 tests) green.
- `pnpm --filter api test` -- 831/832 pass. The one failure (`a payload the deterministic pass rejects > re-issues the generation call rather than failing the parent at once`) is the pre-existing non-deterministic test-isolation flake already recorded as a medium-severity deferred item in this spec; it is unrelated to release/discard and not reproduced by every run.
- `pnpm --filter web test` -- 474/474 pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- 10/10 pass.
- `pnpm prettier --check .` -- clean.

**Residual risks:** the two newly-deferred low-severity items above; the six pre-existing deferred items carried in frontmatter, unchanged by this pass.

