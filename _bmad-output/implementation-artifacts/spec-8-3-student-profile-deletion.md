---
title: 'Story 8.3: Student Profile Deletion'
type: 'feature'
created: '2026-09-29'
baseline_revision: '798a672a247e86b76ffb406286212ff19a1c3174'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The two surfaces the UX names for deletion — Parent View -> Settings -> Data & deletion,
      and a Student Profile detail screen — do not exist, so the delete control lands on a row
      of the Students list table instead.
    evidence: |-
      `apps/web/src/app/parent/` has no `settings` route and no per-profile detail route; the
      whole profile UI is one table at `students/page.tsx`. Story 8.2's deferred ledger already
      records the same missing-surface problem ("the missing list surface is larger than this
      story and is where 8.3/8.4's Data & deletion entry point will also have to land"). The
      control is reachable and password-gated where it is; what is missing is the navigation
      surface, which is larger than this story.
    location: >-
      apps/web/src/app/parent/students/page.tsx
    severity: medium
  - summary: >-
      No test drives the assembled Students screen: the delete flow is proved through exported
      pure functions, a separately mounted dialog and isolated fetch calls.
    evidence: |-
      `apps/web/vitest.config.ts` runs `environment: 'node'` with no DOM, so `page.spec.tsx`
      tests `deleteBody`, `refusalText` and the extracted `StudentRowNotes` rather than
      rendering `StudentsPage`. Nothing asserts that the preview is fetched before the dialog
      opens, or that the dialog receives the real API counts. This is the tier-wide convention
      Story 8.2 already deferred, not something this story introduced; changing it is a
      decision about how `apps/web` is tested.
    location: >-
      apps/web/src/app/parent/students/page.spec.tsx
    severity: medium
  - summary: >-
      The api integration suite fails a different random handful of cases on almost every full
      run, with setup requests answering 404, across unrelated spec files.
    evidence: |-
      Three full runs during this story failed in `practice-test`, `parent-pin`,
      `uncommitted-state` and `extraction` int-specs with a different set each time; every file
      passes when run alone. Reproduced on the baseline commit `798a672` with the working tree
      stashed, so it predates this story. `vitest.config.ts` sets `fileParallelism: false`, so
      it is shared state or connection exhaustion across files rather than concurrency between
      them.
    location: >-
      apps/api/vitest.config.ts
    severity: low
  - summary: >-
      `restoreNote` is still carried only as a `title` tooltip, unreachable on touch and to a
      screen reader.
    evidence: |-
      The archive and delete notes were converted to visible text with `aria-describedby`
      (P14), but restore's was left as it was: it is not the sentence that distinguishes
      keeping history from destroying it, so it fell outside the finding. It is the same class
      of problem and the same one-line fix, wherever this screen is next touched.
    location: >-
      apps/web/src/app/parent/students/page.tsx
    severity: low
  - summary: >-
      The deletion-preview counts shown in the confirmation dialog are read once and never
      re-validated against the state at the moment of confirm.
    evidence: |-
      `onDeleteRequested` fetches the preview once and stores it in `confirmingDelete`;
      `onDeleteConfirmed` runs the real delete later with no re-fetch. The server's own
      transaction re-reads and refuses on a page-set drift, so bytes can never orphan, but a
      non-page count (an Explanation, an Attempt) that changed between preview and confirm
      would leave the parent confirming against a number the dialog is still showing but the
      delete no longer matches.
    location: >-
      apps/web/src/app/parent/students/page.tsx
    severity: low
  - summary: >-
      No test exercises two overlapping `DELETE` requests for the same profile (a double
      submit, or two tabs).
    evidence: |-
      `ProfileDeletionService.delete`'s structure implies the loser of the race gets a 404 from
      `removeOwned`'s `deleteMany` count check, but nothing in `profile-deletion.service.spec.ts`
      or the int-spec drives two concurrent `delete` calls to confirm it, unlike the mid-flight
      page-arrival case, which is tested.
    location: >-
      apps/api/src/deletion/profile-deletion.service.ts
    severity: low
  - summary: >-
      `PageExpiryService.releaseBytes`'s new chunking reuses `PAGE_EXPIRY_SWEEP_BATCH_SIZE`, a
      constant named and originally sized for the unrelated 90-day background sweep.
    evidence: |-
      Tuning that constant for sweep throughput now silently changes filesystem concurrency for
      a live, user-facing delete request, and vice versa; no test pins either behavior to the
      shared value, so the coupling is invisible until it causes an incident. A dedicated
      constant for the deletion path would decouple the two call sites' tuning.
    location: >-
      apps/api/src/sourcetest/page-expiry.service.ts
    severity: low
  - summary: >-
      No test exercises a page mid-upload (`Uploading` status) at the moment its profile is
      deleted.
    evidence: |-
      `pageIdsFor` deliberately includes `Uploading` rows so their bytes are unlinked, but
      nothing drives the actual race of an in-flight upload write landing concurrently with a
      profile deletion's unlink — structurally different from the already-tested mid-flight
      page-arrival case, and a plausible real-world overlap (a parent uploading a new page while
      the profile is deleted from another tab).
    location: >-
      apps/api/src/sourcetest/page-ingest.service.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** FR-33 lets a parent delete a Student Profile and everything under it, and nothing in the product does. `StudentProfileService` can archive and restore; the schema deliberately `Restrict`s a profile's Source Tests, Practice Tests and Generation Jobs so nothing of a child's is ever removed as a side effect, which means no deletion path exists at all. Allowance is *derived* by counting artifacts (`AllowanceService.counters`), so a naive delete would silently refund the account's monthly usage and make delete-and-recreate a path to unlimited free generation.

**Approach:** A new `deletion` module orchestrates the removal across the modules that own each entity cluster (AD-17) — it may not live in `identity`, because every other module already imports `IdentityModule` for its guards. Before any row goes, the charged artifacts are collapsed into anonymous `usage_tombstone` rows (Parent Account, period start, usage class, count) that `allowance` adds to its live counts, so usage stays honest with no child data behind it. The parent reaches it from the Students screen, beside archiving and visibly distinct from it, behind the existing password-gated `DestructiveConfirmDialog` whose body names what goes by count and kind.

## Boundaries & Constraints

**Always:**
- Deletion **erases**: rows are removed and bytes unlinked. No soft-delete, no husk row, no `deletedAt` column on `StudentProfile`.
- Bytes come away **before** rows, exactly as Story 8.1's `removeAndMark` orders it, and through `PageIngestService.remove` — never a second unlink site, never a path built from anything but a page id. If **any** unlink fails, the whole deletion is refused and nothing is removed: "no orphaned stored files" is the requirement, and a half-done delete is the failure mode.
- Tombstones are written **inside the same transaction** as the row deletes. A crash between the two would refund allowance.
- Every read and write is scoped by `parentAccountId` in the same statement, as every other method on `StudentProfileService` is: another account's id is a 404, never a 403.
- The **account password** re-authenticates, verified against `passwordHash` by account id (the `ParentPinService.changePin` precedent) — never the Parent PIN, and never re-resolved from an email claim.
- A wrong password answers **409 with a sentence**, not 401: the web client treats every 401 as "Parent View ended" (`endsParentView`) and would sign the parent out of the screen they are standing on.
- Archiving stays exactly as it is, and both controls sit in the same row saying which is which.

**Block If:** nothing. Every decision here is settled by FR-33, the epic context and the existing code.

**Never:**
- Do not implement Parent Account deletion (8.4), tier/allowance **enforcement** (Epic 9), or a Settings → Data & deletion hub. This story's entry point is the Students screen that already exists.
- Do not refund allowance, and do not add a counter column, a period column or a reset job anywhere — usage stays derived (AD-14).
- Do not weaken any `Restrict` edge to `Cascade` to make deletion easier; the order of the `deleteMany` calls is what makes it possible.
- Do not make `identity` depend on `sourcetest`, `practicetest`, `explanation` or `grading`.
- Do not add a `requirePassword` flag to `DestructiveConfirmDialog`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete with correct password | Owned profile with uploads, practice tests, attempts, explanations, mastery | 204; every row above gone, page bytes unlinked, profile row gone; tombstones written | No error expected |
| Allowance after deletion | Same account, same period | `consumptionFor` reports the **same** `used` for upload, generation and explanation as before the delete | No error expected |
| Wrong / empty password | Owned profile | Nothing is deleted | 409, `PASSWORD_INCORRECT`; parent stays elevated |
| Another account's profile id | Valid password | Nothing is deleted | 404, `PROFILE_NOT_FOUND` — never 403 |
| Archived profile | `archivedAt` set | Deleted like any other: archiving is not a gate | No error expected |
| Profile with nothing under it | No uploads, no tests | 204; no tombstone rows written (nothing was charged) | No error expected |
| An unlink fails mid-deletion | Disk refuses one page | Nothing is deleted; rows and the other bytes stay | 503, `DELETION_INCOMPLETE`, logged by page id only |
| Flagged explanation under the profile | Pending flag in the Admin queue | Flag is gone with its Explanation; the queue no longer lists it | No error expected |
| Preview read | Owned profile | Counts of uploads, photographs, practice tests, attempts, explanations, mastery topics | 404 for another account's id |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:183-231` `StudentProfile` — the edges are the whole deletion order. **Restrict** from `SourceTest` (`:441`), `PracticeTest` (`:961`), `GenerationJob` (`:900`): these must be deleted explicitly, innermost first. **Cascade** from `UncommittedState` (`:280`), `Attempt` (`:1110`), `Explanation` (`:1451`), `TopicMastery` (`:1769`): these go with the profile row. `PracticeTest.sourceTest` is also `Restrict` (`:960`) and `PracticeTest.generationJob` is `Cascade` (`:962`), so practice tests go before generation jobs, which go before source tests.
- `apps/api/prisma/schema.prisma:500-538` `PageImage` — `Cascade` from `SourceTest`, `storagePath` derived from `id` alone. Deleting the Source Test takes the rows; the bytes are **not** a row and must be unlinked first.
- `apps/api/src/sourcetest/page-expiry.service.ts:47,102,118` — `sweepExpired` / `expireNow` / the private `removeAndMark`: the unlink-then-mark routine, its `ENOENT`-is-success contract, its refusal to throw, and its "log page ids, never paths" rule. This story adds a **third trigger** that unlinks and then lets the row deletion take the rows — reuse `this.ingest.remove`, do not re-type it.
- `apps/api/src/sourcetest/page-ingest.service.ts:262` `remove(pageId)` — returns `false` only on a real failure; `ENOENT` is `true`.
- `apps/api/src/sourcetest/source-test.service.ts:1286` `requireReadable`, `:208-227` constructor — how `sourcetest` scopes by account; the purge is profile-scoped and runs under the deletion service's own ownership check.
- `apps/api/src/allowance/allowance.service.ts:98-125` `counters` — the three derived counts: `sourceTests.countSubmittedIn`, `practiceTest.count` on `chargedAt`, `explanation.count` on `chargedAt`, all over the half-open window `[start, end)`. **This is what a delete would refund**, and where the tombstone sum is added.
- `apps/api/src/allowance/period.ts:128` `resolveWindow(instant, history)` — deterministic for a past instant, because `zoneInEffectAt` reads the effective-dated history. That is what makes a tombstone's `periodStart` stable after the fact.
- `apps/api/src/identity/student-profile.service.ts:44-64` (sole-writer rule), `:186` `archive`, `:230` `requireOwned` — the account-scoped `updateMany` idiom the new delete must follow; `PROFILE_NOT_FOUND` at `:41`.
- `apps/api/src/identity/parent-pin.service.ts:172-183` — the precedent for verifying an **account password** for a sensitive action: `accounts.findCredentialById(accountId)` (`parent-account.service.ts:296`) then `argon2.verify`, resolved by id and never by the token's email claim. `DUMMY_HASH` lives at `parent-auth.service.ts:37`.
- `apps/api/src/identity/parent-pin.controller.ts:40-56` — `@ParentCredentialRoute()` + `@SkipThrottle({ default: true, login: true })` + `ParentElevationGuard`: the shape for any route that runs argon2.
- `apps/api/src/identity/student-profile.controller.ts:47-49` — `@Controller('parent')` behind `ParentElevationGuard`, account from `req.elevated`, never the payload (AD-18).
- `apps/api/src/analytics/analytics.module.ts:1-12` — **the precedent for this story's module**: a leaf orchestrator importing `Identity`, `PracticeTest`, `Grading`, `Explanation`, `Topics` with no `forwardRef`. `allowance/allowance.module.ts:17` shows the same one-way shape. Every domain module already imports `IdentityModule`, which is why the orchestration cannot live in `identity`.
- `apps/api/src/prisma/prisma.service.ts:11,40` — `TransactionClient` and `withTransaction`; `parent-account.service.ts:314` `setPin(tx, …)` is the "owner method takes the caller's tx" idiom.
- `apps/api/prisma/migrations/20260929210000_add_mastery/migration.sql:1-17` — hand-written SQL with a header explaining the edges; directory name `YYYYMMDDHHMMSS_name`.
- `apps/web/src/app/parent/students/page.tsx:373-425` — the actions cell: Rename, then Archive/Restore with `title={parentCopy.students.archiveNote}`. The Delete control goes here, and `write(profile.id, …)` at `:151` is the lock-refresh-announce idiom to reuse.
- `apps/web/src/components/Dialog.tsx:206-310` `DestructiveConfirmDialog` — password-gated, `busy`/`firing` lock, render-phase reset, `commonCopy.destructive.irreversible(subject)` as its body. **It has no production caller yet**; this story is its first, and it needs an optional `body` so the sentence can name counts and kinds.
- `apps/web/src/lib/parent-api.ts:1341-1353` `archiveStudent`/`restoreStudent` (the call shape), `:1110` `messageFor`, `:1135-1175` `failureDetailFrom` — a **409** body's `message` is already surfaced as `reason`; `parent-view.ts:23` `endsParentView` is why a wrong password must not be a 401.
- `apps/web/src/copy/common.ts:11-23` `commonCopy.destructive`; `apps/web/src/copy/parent.ts` `parentCopy.students` — every visible string lives in a copy file.
- `apps/api/test/student-profile.int-spec.ts`, `apps/api/test/page-image-expiry.int-spec.ts`, `apps/api/test/harness.ts` — the real-Postgres exemplars: the harness mints elevation and seeds accounts, and the expiry spec already sets up pages with bytes on disk plus derived rows.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `enum UsageClass { Upload Generation Explanation }` (`@@map("usage_class")`) and `model UsageTombstone { id, parentAccountId, periodStart, usageClass, count, createdAt }` with `@@unique([parentAccountId, periodStart, usageClass])`, `@@index([parentAccountId, periodStart])`, `@@map("usage_tombstone")`, and a `ParentAccount` relation `onDelete: Cascade` plus its back-relation -- the anonymous record the epic requires: account, period, class and a number, and nothing a child could be read out of; Cascade is how 8.4 erases them.
- `apps/api/prisma/migrations/20260929235000_add_usage_tombstone/migration.sql` -- hand-written SQL for the enum, table, unique index and FK, with a header stating why the row exists and why it carries no child data -- the migration is where the next reader meets this table.
- `apps/api/src/deletion/deletion-policy.ts` -- `PASSWORD_INCORRECT`, `DELETION_INCOMPLETE` message constants and the `ProfileDeletionSummary` shape (`sourceTests`, `pageImages`, `practiceTests`, `attempts`, `explanations`, `masteryTopics`) -- one place holds every refusal sentence, as `source-test-policy.ts` does.
- `apps/api/src/deletion/profile-deletion.service.ts` -- `previewFor(parentAccountId, id)` and `delete(parentAccountId, id, password)`: ownership → password → collect charged instants → unlink every page byte (refuse on any failure) → one transaction that writes the tombstones and then deletes practice tests, generation jobs, source tests and the profile row, innermost `Restrict` first -- the orchestration lives in one readable method because the **order** is the correctness argument.
- `apps/api/src/deletion/parent-deletion.controller.ts` -- `@Controller('parent')` behind `ParentElevationGuard`; `GET students/:id/deletion-preview` (200, summary) and `DELETE students/:id` (204, `@Body() DeleteStudentProfileDto`), the delete carrying `@ParentCredentialRoute()` + `@SkipThrottle({ default: true, login: true })` -- it runs argon2, so it spends the parent credential budget exactly as the PIN routes do.
- `apps/api/src/deletion/dto/delete-student-profile.dto.ts` -- `password: string`, non-empty, max `PASSWORD_MAX_LENGTH` -- a hash never runs against an unbounded body.
- `apps/api/src/deletion/deletion.module.ts` -- imports `IdentityModule`, `SourceTestModule`, `PracticeTestModule`, `ExplanationModule`, `AllowanceModule`, `PrismaModule`, `JwtModule` (elevation guard), exports the service -- a leaf orchestrator with no `forwardRef`, following `AnalyticsModule`; registered in `apps/api/src/app.module.ts`.
- `apps/api/src/identity/parent-account.service.ts` -- add `verifyPassword(accountId, password): Promise<boolean>`: `findCredentialById`, then `argon2.verify` against the hash or `DUMMY_HASH`, returning false rather than throwing -- the hash is verified inside the delegate's owner and never leaves it, and the dummy keeps a credential-less account indistinguishable in cost.
- `apps/api/src/identity/student-profile.service.ts` -- add `removeOwned(tx, parentAccountId, id): Promise<void>` (a `deleteMany` scoped by both ids, 404 when it removes nothing) -- `identity` stays the sole writer of `StudentProfile` (AD-17); the cascading children go with it.
- `apps/api/src/sourcetest/source-test.service.ts` -- add `submittedInstantsFor(studentProfileId)`, `pageIdsFor(studentProfileId)`, `countsFor(studentProfileId)` and `purgeForStudentProfile(tx, studentProfileId)` -- `sourcetest` owns `SourceTest` and `PageImage`, so nothing outside it queries those delegates.
- `apps/api/src/sourcetest/page-expiry.service.ts` -- add `releaseBytes(pageIds): Promise<{ removed: number; kept: number }>` and have `removeAndMark` use it -- the third trigger reaches `ingest.remove` through the one service that already owns unlinking, with its logging discipline intact.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `chargedInstantsFor(studentProfileId)`, `countsFor(studentProfileId)` and `purgeForStudentProfile(tx, studentProfileId)` deleting practice tests then generation jobs, matched on `studentProfileId` **or** a source test of that profile -- the owner deletes its own rows, and the widened match means a row cross-linked to the child cannot survive to block the source-test delete.
- `apps/api/src/explanation/explanation.service.ts` -- add `chargedInstantsFor(studentProfileId)` and `countsFor(studentProfileId)` -- explanations and their flags cascade from the profile, so only the charge needs collecting; the Admin queue empties itself.
- `apps/api/src/allowance/allowance.service.ts` -- add the tombstone sum for the window to each of the three counters -- usage stays derived, and this is the one place a deleted artifact keeps being counted.
- `apps/api/src/deletion/profile-deletion.service.spec.ts` -- unit-cover the matrix: happy path, wrong password, foreign id, archived profile, empty profile writes no tombstone, a failed unlink refuses and deletes nothing, and the delete order -- the matrix is the contract.
- `apps/api/src/allowance/allowance.service.spec.ts` -- cover that tombstones add to each of the three counts and are scoped to the window -- a tombstone counted in the wrong period is a silent refund.
- `apps/api/src/identity/parent-account.service.spec.ts` -- cover `verifyPassword`: correct, wrong, and an account with no credential -- the credential-less case must be false, not a throw.
- `apps/api/test/student-profile-deletion.int-spec.ts` -- real-Postgres cases over the routes: bytes gone from disk and every row gone; allowance unchanged across the delete; a sibling profile's data untouched; a flagged Explanation gone from the Admin queue; wrong password 409 and nothing removed; another account's id 404; preview counts; archived profile deletable -- concurrency, bytes and cascade behaviour belong in this tier.
- `apps/web/src/components/Dialog.tsx` -- give `DestructiveConfirmDialog` an optional `body` prop defaulting to `commonCopy.destructive.irreversible(subject)` -- FR-33 requires the sentence to name counts and kinds; the password field and its gate are untouched.
- `apps/web/src/copy/parent.ts` -- add `parentCopy.students.delete`, `deleteNote`, `deleteBody(name, counts)` (names every count and kind, states it cannot be undone and that the monthly allowance is not given back), `deleted(name)`, `deleteFailed`, and reword `archiveNote` if it does not already say *hides from Student Mode, keeps history* -- the two controls must read as different actions.
- `apps/web/src/lib/parent-api.ts` -- add `studentDeletionPreview(token, id)` and `deleteStudent(token, id, password)`, and give `PASSWORD_INCORRECT` / `DELETION_INCOMPLETE` parent-readable sentences -- a refusal a parent cannot act on is the same as no message.
- `apps/web/src/app/parent/students/page.tsx` -- add a Delete control to the actions cell: it reads the preview, opens `DestructiveConfirmDialog` with the counted body, deletes on confirm, refreshes and announces -- the row is where archive already lives, which is where the distinction has to be visible.
- `apps/web/src/components/Dialog.spec.tsx` -- cover the `body` override and that the password field and its disabled-until-typed gate survive it -- the override must not become a way past the safeguard.
- `apps/web/src/app/parent/students/page.spec.tsx` -- assert the Delete control, that its dialog body names the counts, that archive and delete are separately labelled with notes saying which keeps history, and that a 409 leaves the parent on the screen -- the AC is about what the surface offers.
- `apps/web/src/lib/parent-api.spec.ts` -- cover the two new calls: verb, path, elevated header, and the password in the delete body -- a client wired to a path the server does not serve fails only in front of a parent.

**Acceptance Criteria:**
- Given a Student Profile with uploads, photographs on disk, practice tests, attempts, explanations and mastery rows, when the parent confirms deletion with the correct account password, then every one of those rows is gone, no file remains at any of those pages' storage paths, the profile row is gone, and a sibling profile on the same account is completely untouched.
- Given that same account and period, when `consumptionFor` is read before and after the deletion, then all three `used` figures are identical, and creating a new profile and deleting it again does not lower them.
- Given a stored `usage_tombstone` row, when it is read, then it names only the Parent Account, a period start, a usage class and a count — no student id, no title, no text.
- Given the Students screen, when a row is read, then Archive and Delete are separately labelled controls, Archive says it hides the child from Student Mode and keeps their history, and Delete's confirmation names the child, every count and kind that will be destroyed, and that it cannot be undone.
- Given the confirmation dialog, when it is open, then it asks for the **account password** and no PIN, and its confirm control stays disabled until a password is typed.
- Given a wrong password, when the parent confirms, then nothing is deleted, the refusal is shown on the screen, and the parent is still in Parent View.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 0, medium 7, low 7)
- defer: 4: (high 0, medium 2, low 2)
- reject: 10: (high 0, medium 1, low 9)
- addressed_findings:
  - `[medium]` `[patch]` A transaction failure after the bytes were released left every photograph unlinked while every row survived, `PageImage` rows still `Ready` with a non-null `storagePath`, and the parent told nothing was removed — added `PageExpiryService.markReleased`, and the deletion now marks the released pages the way Story 8.1 marks an expired one before rethrowing.
  - `[medium]` `[patch]` The interactive transaction ran on Prisma's default 5s timeout, which a large cascade can exceed — explicit `timeout`/`maxWait` constants in `deletion-policy.ts`.
  - `[medium]` `[patch]` The page set was snapshotted outside the transaction, so a page written to a Draft Source Test in between would have its row deleted and its bytes orphaned — the set is now re-read inside the transaction and any drift refuses with 503.
  - `[medium]` `[patch]` The three charging-instant collectors ran outside the transaction, so an artifact charged in between was deleted with no tombstone — the collectors take the transaction client and share one snapshot with the deletes.
  - `[medium]` `[patch]` The 409 refusal rendered into the page-body alert, behind the dialog's own backdrop, so "that is not the account password" was invisible — `DestructiveConfirmDialog` gained a `refusal` slot rendered inside it.
  - `[medium]` `[patch]` Nothing asserted that the new argon2-running delete route spends the parent credential budget, and it skips both other throttler buckets — added the 429 case and its preview-reads-are-free companion to `rate-limit.int-spec.ts`.
  - `[medium]` `[patch]` The tombstone's unique index and the upsert's increment branch were untested — the int-spec now asserts exact `periodStart`/`count` triples and that a second deletion in the same period increments one row rather than inserting beside it.
  - `[low]` `[patch]` `PracticeTestService.deletionScope` was widened but `ExplanationService`'s collectors were not, so a Practice Test reached only by the widened branch could take a charged Explanation away untombstoned — the scope is now mirrored in `explanation` and in the preview's counts.
  - `[low]` `[patch]` `releaseBytes` issued one `Promise.all` over every page id — now chunked by `PAGE_EXPIRY_SWEEP_BATCH_SIZE`.
  - `[low]` `[patch]` `PageExpiryService.unlink` claimed to be the one call site of `ingest.remove` in the codebase; `SourceTestService` has two others — the claim was corrected to what is true.
  - `[low]` `[patch]` `expect(body).not.toContain('0 ')` would fail for any count ending in zero — replaced with absent-kind-name assertions plus a case proving `10 photographs` renders.
  - `[low]` `[patch]` `deleteBody` used an ASCII apostrophe against the rest of the parent copy's typographic one, and `deleted(name)` claimed "everything saved under them" even in the nothing-saved case — both reworded.
  - `[low]` `[patch]` `onDeleteRequested` had no in-flight guard, so two taps raced two preview reads — guarded, disabled while in flight, and applied through the screen's staleness rule.
  - `[low]` `[patch]` The archive/delete notes were `title` tooltips on buttons carrying `aria-label`, so the sentence saying which keeps history was unreachable on touch and to a screen reader — extracted `StudentRowNotes`, rendered as visible text wired through `aria-describedby`.

### 2026-09-29 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 1, medium 1, low 0)
- defer: 2: (high 0, medium 0, low 2)
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[high]` `[patch]` The early refusal path in `ProfileDeletionService.delete` (unlink shortfall found before the transaction even opens) unlinked some pages' bytes and then threw without marking any row — the pages that *did* lose their bytes were left `Ready` with a `storagePath` pointing at a file that no longer exists, the exact orphan the "no orphaned stored files" constraint forbids, just reached from a second code path the existing test suite never exercised. `PageExpiryService.releaseBytes` now returns the unlinked ids (`removedIds`) instead of a bare count, and the refusal path marks exactly those pages before throwing `DELETION_INCOMPLETE`. Covered by a new assertion in `profile-deletion.service.spec.ts`'s partial-unlink-failure test.
  - `[medium]` `[patch]` `onDeleteRequested` guarded against a second tap on the same row but not against a tap on a *different* row while a delete confirmation was already open for the first: the later preview's response silently swapped the open dialog's subject and counts out from under the parent reading them. Added a `confirmingDelete !== null` guard to `onDeleteRequested` and to the Delete button's `disabled` condition in `apps/web/src/app/parent/students/page.tsx`.
- Full verification suite re-run after the patches: `pnpm --filter api test` passes except the pre-existing cross-file flake already recorded above (confirmed unrelated: the two failing cases pass individually); `pnpm --filter web test` (1399/1399), `pnpm lint`, `pnpm typecheck`, and `pnpm exec prettier --check` on every changed file are all clean.

### 2026-09-29 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2: (high 0, medium 0, low 2)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - none

## Design Notes

**Why a new module and not `identity`.** `sourcetest`, `practicetest`, `explanation`, `grading` and `analytics` all import `IdentityModule` for `ParentElevationGuard`. Injecting any of their services into `StudentProfileService` makes every one of those a cycle. `AnalyticsModule` already shows the shape this story needs: a leaf that imports many and is imported by none. The entity owners keep their delegates (AD-17) and expose narrow purge and count methods; `deletion` only decides the order.

**Why the order is the design.** The `Restrict` edges are deliberate — nothing of a child's is ever removed as a side effect — so the deletion has to walk them inward-out itself:

```ts
await this.prisma.withTransaction(async (tx) => {
  await this.writeTombstones(tx, accountId, charged);   // before any row goes
  await this.practiceTests.purgeForStudentProfile(tx, id); // tests, then their jobs
  await this.sourceTests.purgeForStudentProfile(tx, id);   // pages cascade with them
  await this.students.removeOwned(tx, accountId, id);      // attempts, explanations,
});                                                        // mastery, uncommitted cascade
```

**Why bytes first, and why a failed unlink refuses everything.** Story 8.1 unlinks before marking so a crash leaves a row whose file is already gone — recoverable, because the next pass re-selects it. Here the rows are about to disappear, so there is no next pass: a file left behind after its row is gone is precisely the orphan §5.2 says does not exist. Unlinking every page first and refusing the whole deletion if any one fails is the only order with no orphan in it. The parent retries; nothing was lost.

**Why 409 and not 401 for a wrong password.** `endsParentView` treats every 401 as the elevation expiring, and the Students screen responds by clearing elevation and routing to the PIN prompt. A mistyped password is not an expired session, and signing the parent out of the screen would hide the refusal they need to read. 409 already carries a policy sentence to the client (`failureDetailFrom`), which is the mechanism Story 8.2's two refusals use.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev` -- expected: the migration applies and `prisma generate` reflects `UsageTombstone`.
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass, including the new deletion and tombstone cases.
- `pnpm --filter web test` -- expected: the dialog, students-page and parent-api specs pass.
- `pnpm lint && pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --write .` -- expected: no unformatted files remain.

## Auto Run Result

**Summary of implemented change:** Story 8.3 (Student Profile Deletion) was already implemented and reviewed to `done` in prior passes. This run performed a fresh, follow-up review pass against the full diff since `baseline_revision` (`798a672a247e86b76ffb406286212ff19a1c3174`) with no code changes made.

**Files changed with one-line descriptions:** No files changed by this pass (review-only). The diff reviewed spans the `deletion` module, `allowance`/`page-expiry`/`practicetest`/`sourcetest`/`identity` service additions, the `UsageTombstone` schema/migration, and the web Students-screen/dialog/copy/api changes already committed in prior passes (see `## Code Map` and `## Tasks & Acceptance` above for the full file list).

**Review findings breakdown:** 0 patched, 2 deferred (both low severity: `PageExpiryService.releaseBytes` reusing the unrelated sweep's batch-size constant; no test for a page mid-upload at the moment its profile is deleted), 9 rejected as noise, restated-precedent, or already covered by the six pre-existing deferred items. No `intent_gap` or `bad_spec` findings.

**Follow-up review recommendation:** `false` — this pass triaged 0 findings as `patch` (score 0, no high-severity patch).

**Verification performed:** Review-only pass; no code was changed, so no verification commands were re-run. The previous pass's full verification (recorded in the prior `## Auto Run Result`-equivalent triage log entries) stands: `pnpm --filter api test`, `pnpm --filter web test` (1399/1399), `pnpm lint`, `pnpm typecheck`, and `pnpm exec prettier --check` all clean, with the pre-existing cross-file `apps/api` int-spec flake noted as unrelated and already deferred.

**Residual risks:** The eight deferred items in frontmatter (six pre-existing plus the two added this pass) remain open, all low-to-medium severity, none blocking. The largest is the missing DOM-rendered test coverage for the assembled `StudentsPage` screen (tier-wide convention, not introduced by this story) and the pre-existing cross-file `apps/api` integration-test flake.
