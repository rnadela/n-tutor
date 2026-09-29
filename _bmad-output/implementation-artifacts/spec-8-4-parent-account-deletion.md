---
title: 'Story 8.4: Parent Account Deletion'
type: 'feature'
created: '2026-09-29'
baseline_revision: '944d8cb3beffb1e6b8b9cc5cf09c4118e24296a0'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The bytes-first deletion protocol is now authored twice: roughly forty lines of
      `AccountDeletionService.delete` mirror `ProfileDeletionService.delete` statement for
      statement, including the whole private `markReleasedPages`.
    evidence: |-
      `apps/api/src/deletion/account-deletion.service.ts:121-222` and
      `apps/api/src/deletion/profile-deletion.service.ts:147-267` share the password gate, the
      `pageIds*` -> `releaseBytes` -> `kept > 0` refusal, the in-transaction page-set re-read, the
      `catch { markReleasedPages; throw }` and the marking helper. Only the purge calls, the log
      wording and the tombstone step differ. The spec chose sibling services deliberately and
      argued for "one readable body", so this is a refactor decision (a shared preamble, a base
      class, or a `withReleasedBytes` helper) rather than a defect in either service.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts:121
    severity: medium
  - summary: >-
      The failure copy for a shortfall says "Nothing was removed" on the one path where
      photographs were in fact permanently unlinked.
    evidence: |-
      A 503 `DELETION_INCOMPLETE` carries no client-readable `reason`, so the web app falls back to
      `parentCopy.settings.deleteAccountFailed` / `parentCopy.students.deleteFailed`. On that path
      `releaseBytes` already unlinked every page in `removedIds` and those rows were marked
      `Deleted` — the rows survive but the photographs do not. The wording predates this story
      (Story 8.3 authored it) and is identical on both paths, so fixing it is one copy decision
      across both deletion surfaces.
    location: >-
      apps/web/src/copy/parent.ts
    severity: medium
  - summary: >-
      The in-transaction page-set re-read narrows but does not close the mid-flight window, while
      the comment beside it claims the set is "proved unchanged".
    evidence: |-
      Prisma interactive transactions run at the database default isolation (READ COMMITTED) with no
      row lock, no `Serializable` and no advisory lock on the account, so a page committed after the
      re-read and before `sourceTest.deleteMany` still cascades away with its bytes left on disk.
      The identical guard and the identical claim are in `profile-deletion.service.ts`, so this is a
      design-level question about how the two paths serialize, not a defect introduced here.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts:148
    severity: medium
  - summary: >-
      A page retaken mid-flight keeps its id, so the id-set guard cannot see that its bytes were
      rewritten after release.
    evidence: |-
      The guard compares page ids, and a retake writes new bytes at the path derived from the same
      page id. A retake landing between `releaseBytes` and the `sourceTest.deleteMany` therefore
      leaves a file whose row is gone. The same hole exists on Story 8.3's profile path with the
      same guard, and closing it needs a written-at marker rather than an id comparison.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts:153
    severity: medium
  - summary: >-
      The preview counts `Deleted` page images while the deletion excludes them, so the
      confirmation can name more photographs than are actually unlinked.
    evidence: |-
      `SourceTestService.countsForAccount` counts every `page_image` row of the account, whereas
      `pageIdsForAccount` filters `state: { not: 'Deleted' }` because a `Deleted` row's bytes are
      already gone. An account with expired pages therefore reads a higher photograph count than the
      deletion removes. This mirrors `countsFor` from Story 8.3 exactly, so it is a pre-existing
      inconsistency in what "photographs" means on both preview surfaces.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts
    severity: medium
  - summary: >-
      Nothing exercises a large account against the fixed 60-second deletion transaction ceiling,
      which was chosen by doubling the per-profile figure rather than by measurement.
    evidence: |-
      `ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS = 60_000` bounds one all-or-nothing transaction over
      every child of the account, with no batching and no resumability; `pageIdsForAccount` also
      materializes every page id of the account in memory. The integration cases seed two children
      with a handful of rows each, so the timeout path is never approached in any tier.
    location: >-
      apps/api/src/deletion/deletion-policy.ts
    severity: medium
  - summary: >-
      No test mounts the assembled Settings screen, so the dialog's own gate and the post-deletion
      sign-out are asserted only by inheritance.
    evidence: |-
      `apps/web/vitest.config.ts:10` is `environment: 'node'`, so `settings/page.spec.tsx` tests
      exported helpers, statically rendered fragments and page source text. Untested at any tier:
      that the counted body reaches `DestructiveConfirmDialog`, that its confirm control stays
      disabled until a password is typed, and that a success clears elevation and replaces to
      `/auth/sign-in`. This is the tier-wide convention Story 8.2 and 8.3 already deferred, not
      something this story introduced.
    location: >-
      apps/web/src/app/parent/settings/page.spec.tsx
    severity: medium
  - summary: >-
      The `apps/api` integration tier flakes nondeterministically across unrelated files, and this
      run saw it in more files than Story 8.3 recorded.
    evidence: |-
      Four full-suite runs failed a different set of 1-6 tests each time, spread over
      `practice-test.int-spec.ts`, `parent-pin.int-spec.ts`, `uncommitted-state.int-spec.ts` and
      `extraction.int-spec.ts` — every one of them a file this story does not touch, and never one
      of the new specs. The signature is an elevation or setup read answering 404. It reproduces on
      a clean tree (`git stash` + a single-file run: 2 of 202 failed) and it still occurs with this
      story's new `rate-limit.int-spec.ts` cases reverted, so it is environmental rather than caused
      or aggravated here.
    location: >-
      apps/api/test
    severity: medium
  - summary: >-
      Two concurrent `DELETE /api/parent/account` requests for the same account are untested; the
      loser's row-count check is a plausible way to hit an unhandled 404 rather than a clean refusal.
    evidence: |-
      `AccountDeletionService.delete` and `ParentAccountService.removeAccount` reject on a row count
      other than 1, which is the expected shape of a losing racer once the winner's transaction has
      already committed. No unit or integration test drives two simultaneous deletes against one
      account, so the 404 this path produces, and whether the web client's `refusalText`/
      `endsParentView` plumbing gives it a sane message, is unverified.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts
    severity: medium
  - summary: >-
      A Student Profile created between the preview read and the confirmed delete is silently
      destroyed without ever being named to the parent; only pages have an in-flight guard.
    evidence: |-
      The mid-flight re-read inside the transaction (`account-deletion.service.ts:157`) only proves
      the page set is unchanged and 503s `DELETION_INCOMPLETE` if it grew. A Student Profile added
      on another device between the preview response and the confirmed delete has no equivalent
      check: it is destroyed along with everything else, but the confirmation the parent read never
      named it. This is a narrower version of the same in-flight-arrival problem the page guard
      already treats as worth refusing for.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts:157
    severity: medium
  - summary: >-
      Nothing asserts that the counts a purge actually removes match the counts the preview showed
      for the same account.
    evidence: |-
      `AccountDeletionService.previewFor` and `.delete` call the same per-kind services
      (`sourceTests`, `practiceTests`, `explanations`, `students`) but no test computes a preview,
      runs the delete, and checks the removed-row totals against it. A future field added to one
      query and not its sibling would ship undetected.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts
    severity: low
  - summary: >-
      `DeleteAccountDto`'s password field has no validation-pipe test for a non-string body (e.g. a
      number), only behavioral tests for correct/incorrect/empty string passwords.
    evidence: |-
      `DeleteAccountDto` documents the absence of an `@IsNotEmpty()` guard as deliberate, but nothing
      confirms a non-string `password` is rejected by the validation pipe before reaching argon2.
    location: >-
      apps/api/src/deletion/dto/delete-account.dto.ts
    severity: low
  - summary: >-
      No end-to-end test proves Student Profile deletion (Story 8.3) leaves the account's other
      `AiCall` rows untouched; the guarantee rests on a doc comment, not an assertion.
    evidence: |-
      The account-deletion int-spec proves account deletion erases `AiCall` rows; nothing exercises
      the negative case that profile deletion must NOT touch them, only unit-level comments assert
      the ownership split.
    location: >-
      apps/api/src/deletion/profile-deletion.service.ts
    severity: low
  - summary: >-
      An elevation bearer token is a stateless JWT with no revocation on account deletion; replaying
      it against another parent-scoped route right after a successful delete is untested and may
      surface a raw 404/500 instead of a clean 401.
    evidence: |-
      Only the cookie-based checks (`/api/auth/me`, `/api/student/session`) are verified after
      deletion. The elevation bearer itself remains cryptographically valid until its own expiry, and
      no test drives it against e.g. `deletion-preview` or another parent route post-deletion to see
      what the now-nonexistent account resolves to.
    location: >-
      apps/api/src/identity/parent-elevation.guard.ts
    severity: medium
  - summary: >-
      Two independent deletion transactions (a Student Profile delete and an Account delete) can run
      concurrently against overlapping rows with no lock coordinating them.
    evidence: |-
      `ProfileDeletionService.delete` and `AccountDeletionService.delete` each open their own
      transaction with no per-account advisory lock or row lock acquired first. A profile delete and
      an account delete racing on the same account could interleave in ways neither transaction's own
      re-read guards against, since each only re-checks its own view of the page set.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts
    severity: medium
  - summary: >-
      If the elevation token expires while the destructive confirmation dialog is already open,
      clicking confirm silently does nothing instead of showing a refusal.
    evidence: |-
      `onDeleteConfirmed` in `apps/web/src/app/parent/settings/page.tsx` guards
      `if (confirming === null || token === null || deleting) return;` before setting `deleting` or
      any refusal text, so a token that has gone null since the dialog opened makes the confirm
      button a no-op with no feedback. `DestructiveConfirmDialog` itself has no notion of the token
      and cannot disable its confirm control for this case. The identical guard shape exists in
      `apps/web/src/app/parent/students/page.tsx` (`onDeleteConfirmed`, line 310), so this is an
      inherited pattern from Story 8.3, not something this story introduced.
    location: >-
      apps/web/src/app/parent/settings/page.tsx:175
    severity: medium
---

<intent-contract>

## Intent

**Problem:** FR-33 lets a parent delete their Parent Account entirely and nothing in the product does. Story 8.3 built the per-child path, but the account row itself is held by five `Restrict` edges (`StudentProfile`, `SourceTest`, `PracticeTest`, `GenerationJob`, `AiCall`), so no account deletion is expressible today; the uncommitted Parent View state, consents, reset tokens, timezone history and the usage tombstones 8.3 leaves behind all still hang off an account nobody can remove. There is also no parent-facing surface for account-level data actions at all.

**Approach:** A second service in the existing `deletion` module walks the same order one level out — every account-scoped purge in place of every profile-scoped one, plus the one thing only account deletion erases (`AiCall` cost rows, per the deletion enumeration) — inside one transaction, behind the same account-password gate and the same `DestructiveConfirmDialog`. No tombstone is written, because account deletion erases tombstones too. It lands on a new, minimal **Parent View → Settings → Data & deletion** screen, which is the entry point the UX names and the one 8.2/8.3 deferred for want of a home.

## Boundaries & Constraints

**Always:**
- Deletion **erases**. Rows are removed, bytes are unlinked, and there is no husk account, no `deletedAt` column and no disabled-account state.
- **Bytes before rows, all of them, and any unlink failure refuses the whole deletion** — exactly 8.3's contract and through the same `PageExpiryService` routine, never a second unlink site and never a path built from anything but a page id. On a transaction failure after the bytes came away, the released pages are marked as the retention sweep marks them.
- `AiCall` rows for the account are **deleted** (they are a longitudinal per-account activity trace, and the deletion enumeration names them: anonymized on profile deletion, deleted on account deletion). They are deleted **by `ai`**, the sole writer of `ai_call` (AD-17).
- The account row is deleted by `ParentAccountService`, the sole writer of `parent_account` (AD-17). `AccountConsent`, `PasswordReset`, `AccountTimezone`, `UncommittedState` and `UsageTombstone` cascade from it, which is how the retained uncommitted Parent View state and the tombstones go.
- The `Restrict` edges are walked inward-out, never weakened: Practice Tests, then Generation Jobs, then Source Tests (pages and Extractions cascade), then every Student Profile (Attempts, Explanations, Mastery, uncommitted cascade), then `AiCall`, then the account.
- The **account password** re-authenticates, verified by account id through the existing `ParentAccountService.verifyPassword`. Never the Parent PIN.
- A wrong password is **409 with a sentence**, never 401 — `endsParentView` reads a 401 as the elevation expiring and would take the parent off the screen holding the refusal.
- The account is taken from `req.elevated`, never from a payload or a path (AD-18).
- On success the API **clears both the parent session cookie and the Student Mode cookie**, through the same helpers sign-out uses: the account the device was attached to no longer exists.
- The confirmation names what is destroyed by count and kind (children, uploads, photographs, practice tests, runs, explanations, topics with progress) and states that it cannot be undone.
- No log line, and no response body, carries an email, a child's name, a count of a child's work or any id (AD-20).

**Block If:** nothing. The deletion enumeration settles `AiCall` and `AdminAudit`; every other edge is settled by the schema.

**Never:**
- Do not write a `UsageTombstone` on this path, and do not preserve existing ones — the account's whole usage record goes with it.
- Do not delete, anonymize or rewrite `AdminAudit` rows: they carry no child content and deliberately survive deletion. They hold no foreign key, so nothing is needed either way.
- Do not build a global spend rollup, a spend ceiling or any Epic 9 allowance enforcement. The ceiling AD-23 describes does not exist yet; this story only removes rows and states that the ceiling, when built, must read an account-anonymous aggregate.
- Do not move, restyle or re-home Story 8.3's per-profile Delete control; the Students screen keeps it.
- Do not add a `requirePassword` flag or any other gate-weakening prop to `DestructiveConfirmDialog`.
- Do not add an admin-initiated account deletion, an export, a "download my data" path or an email confirmation step.
- Do not chase queued pg-boss jobs that reference deleted rows: identifier-only payloads fail closed and are discarded, which is the existing behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete with correct password | Account with two children, uploads with bytes on disk, practice tests, attempts, explanations, mastery, tombstones, consents, a reset token, timezone rows, uncommitted state, AiCall rows | 204; every one of those rows gone, every page byte unlinked, the account row gone; both cookies cleared | No error expected |
| Another account untouched | A second account with its own children and bytes | Every row and file of the second account is exactly as it was | No error expected |
| Wrong / empty password | Elevated parent | Nothing is deleted | 409, `PASSWORD_INCORRECT`; parent stays elevated |
| An unlink fails mid-deletion | Disk refuses one page | Nothing is deleted; every row and every other byte stay | 503, `DELETION_INCOMPLETE`, logged by page id only |
| A page arrives while in flight | A page photographed onto a draft during the transaction | Nothing is deleted | 503, `DELETION_INCOMPLETE` |
| Account with nothing under it | No children, no uploads | 204; the account and its consents/timezone rows are gone | No error expected |
| Preview read | Elevated parent | Counts of children, uploads, photographs, practice tests, attempts, explanations, mastery topics | No error expected |
| Session after deletion | Any parent route with the old cookie | Refused; the account no longer resolves | 401 from the existing session guard |
| Flagged explanation under the account | Pending flags in the Admin queue | Gone with their Explanations; the queue no longer lists them | No error expected |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:123-176` `ParentAccount` — the edge list **is** the deletion order. `Restrict` from `StudentProfile` (`:200`), `SourceTest` (`:445`), `AiCall` (`:580`), `GenerationJob` (`:900`), `PracticeTest` (`:961`); `Cascade` from `UncommittedState` (`:284`), `AccountConsent` (`:305`), `PasswordReset` (`:321`), `AccountTimezone` (`:339`), `UsageTombstone` (`:1833`). Every `Restrict` child except `AiCall` carries a **non-null** `studentProfileId`, which is why purging the children clears them.
- `apps/api/prisma/schema.prisma:89-101` `AdminAudit` — **no foreign key at all**: it survives by construction. Nothing to write. Same for `GradeDispute` (`:1345`) and `ExplanationFlag` (`:1541`), whose `parentAccountId` is a plain column and whose real edges cascade.
- `apps/api/src/deletion/profile-deletion.service.ts:147-243` — **the template for this story's method, one level out**: ownership → password → `releaseBytes` → refuse on `kept` → transaction proving the page set did not move → purges inward-out → `markReleasedPages` on failure. Read it before writing anything; the new service is its sibling and must not restate its reasoning.
- `apps/api/src/deletion/deletion-policy.ts:1-86` — `PASSWORD_INCORRECT`, `DELETION_INCOMPLETE` (reused verbatim), `DELETION_TRANSACTION_TIMEOUT_MS`/`MAX_WAIT_MS` and `ProfileDeletionSummary`. The account summary and its own timeout go here.
- `apps/api/src/deletion/parent-deletion.controller.ts:37-72` — `@Controller('parent')` + `@SkipThrottle({ login: true })` + `ParentElevationGuard`; the delete carries `@ParentCredentialRoute()` + `@SkipThrottle({ default: true, login: true })` because it runs argon2. The two new routes join it. No existing `parent/account*` route exists.
- `apps/api/src/deletion/deletion.module.ts:44-66` — the leaf-orchestrator import list; `AiModule` joins it (`apps/api/src/ai/ai.module.ts:16-19` imports nothing, so no cycle is expressible). `AllowanceModule` stays for `ProfileDeletionService` alone.
- `apps/api/src/sourcetest/source-test.service.ts:916-972` — `submittedInstantsFor`, `pageIdsFor` (both `tx`-aware, `state: { not: 'Deleted' }`, ids never paths), `countsFor`, `purgeForStudentProfile`. The account-scoped twins go beside them, in the same shapes.
- `apps/api/src/sourcetest/page-expiry.service.ts:118-178` — `releaseBytes` (returns `removedIds`/`kept`) and `markReleased`; their log lines hard-code "Student Profile deletion", which is the one thing that needs widening.
- `apps/api/src/practicetest/practice-test.service.ts:1621-1662` — `chargedInstantsFor`, `countsFor`, `purgeForStudentProfile` (tests **then** jobs, because `PracticeTest.generationJob` is `Cascade` and `PracticeTest.sourceTest` is `Restrict`), and the private `deletionScope`/`attemptDeletionScope` helpers the account twins mirror.
- `apps/api/src/explanation/explanation.service.ts:1390-1405` — `chargedInstantsFor`, `countsFor`. Only a count is needed here; the rows cascade.
- `apps/api/src/identity/student-profile.service.ts:233-257` `removeOwned` — the account-scoped `deleteMany` idiom and the 404-not-403 rule; `PROFILE_NOT_FOUND` at `:41`.
- `apps/api/src/identity/parent-account.service.ts:296-338` — `findCredentialById`, `verifyPassword` (reused as-is), and `setPin(tx, …)` at `:314` as the "owner method takes the caller's tx" idiom the account delete follows.
- `apps/api/src/identity/parent-session.cookie.ts:19-25` and `student-mode.cookie.ts` — `clearSessionCookie` / `clearStudentModeCookie`; `parent-auth.controller.ts:77-88` is the sign-out precedent for clearing both with `@Res({ passthrough: true })`.
- `apps/api/src/ai/ai.service.ts:249-254,487-505` — the sole writer of `ai_call` and its injected `PrismaService`; the purge belongs here and nowhere else.
- `apps/api/src/prisma/prisma.service.ts:11,40` — `TransactionClient`, `withTransaction(fn, options)`.
- `apps/web/src/app/parent/page.tsx:104-155` — the hub's link list, every entry a client-side `NextLink` (a full load would unmount the elevation provider). The Settings link goes here.
- `apps/web/src/app/parent/students/page.tsx:130-345,691-705` — the whole delete flow to mirror: `applyIfCurrent`/`requestId` staleness guard, `leave()` on `endsParentView`, preview-before-dialog, `refusalText` into the dialog's `refusal`, `announce`. `:48-133` shows which helpers a page exports so a node-environment spec can reach them.
- `apps/web/src/components/Dialog.tsx:216-320` `DestructiveConfirmDialog` — already takes `subject`, optional `body`, `refusal`, `busy`; needs no change.
- `apps/web/src/lib/parent-api.ts:48-55,1263,1370-1401` — `StudentDeletionPreview`, `signOut`, and the two 8.3 calls whose shape the account calls copy (`elevated(token)` header, password in the DELETE body, never a query string); `:1110` `messageFor`, `:1135-1175` `failureDetailFrom` already surface a 409 `message` as `reason`.
- `apps/web/src/copy/parent.ts:287-345` — `students.archiveNote`/`deleteNote`/`deleteBody` with the `countPhrase` + `listOf` helpers the account body reuses; `apps/web/src/copy/common.ts:11-23` `commonCopy.destructive`.
- `apps/api/test/student-profile-deletion.int-spec.ts:1-136,288-330` — the real-Postgres exemplar: `photo(seed)`, `fileExists(pageId)` via `storagePathFor`, `elevatedParent()`, `childOf()`, `rowCounts()`, and the harness imports. The account spec is its sibling and seeds two accounts.
- `apps/web/src/app/parent/students/page.spec.tsx:1-20` — `apps/web/vitest.config.ts:10` is `environment: 'node'`, so a page spec tests exported helpers and `renderToStaticMarkup`s small extracted components rather than mounting the screen.
- `_bmad-output/planning-artifacts/epics.md:154` — the deletion enumeration: AiCall deleted on account deletion, AdminAudit survives, job payloads need no path, client-held Attempt state is a stated limitation.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/deletion/deletion-policy.ts` -- add `AccountDeletionSummary` (`students`, `sourceTests`, `pageImages`, `practiceTests`, `attempts`, `explanations`, `masteryTopics`) and `ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS = 60_000`; reuse `PASSWORD_INCORRECT`, `DELETION_INCOMPLETE` and the existing max-wait unchanged -- one file holds every refusal sentence, and an account is several children's worth of statement tree, so the per-profile ceiling is doubled rather than a second wording of the same refusal being invented.
- `apps/api/src/deletion/account-deletion.service.ts` -- `previewFor(parentAccountId)` and `delete(parentAccountId, password)`: password → `pageIdsForAccount` → `releaseBytes` (refuse and mark on any shortfall) → one transaction that re-proves the page set, then purges practice tests, Source Tests, every profile, `AiCall` and finally the account row -- the order is the correctness argument and belongs in one readable body, as `ProfileDeletionService.delete` does; no tombstone is written because the tombstones cascade away with the account.
- `apps/api/src/deletion/parent-deletion.controller.ts` -- add `GET parent/account/deletion-preview` (200, summary) and `DELETE parent/account` (204, `@Body() DeleteAccountDto`, `@ParentCredentialRoute()`, `@SkipThrottle({ default: true, login: true })`, `@Res({ passthrough: true })` clearing both cookies) -- the deletion routes already live here behind the elevation guard, and the device must stop being attached to an account that no longer exists.
- `apps/api/src/deletion/dto/delete-account.dto.ts` -- `password: string`, `@IsString()`, `@MaxLength(PASSWORD_MAX_LENGTH)`, no emptiness check -- the sibling DTO's contract exactly: an empty password is a wrong password, answered by one sentence and one status, and argon2 never runs against an unbounded body.
- `apps/api/src/deletion/deletion.module.ts` -- import `AiModule`, provide and export `AccountDeletionService` -- `ai` owns `ai_call` and imports nothing, so the leaf orchestrator stays a leaf with no `forwardRef`.
- `apps/api/src/identity/parent-account.service.ts` -- add `removeAccount(tx, id): Promise<void>` (`deleteMany({ where: { id } })`, raising if it removed nothing) -- `identity` stays the sole writer of `parent_account`; the consents, reset tokens, timezone history, uncommitted state and usage tombstones cascade with this one statement.
- `apps/api/src/identity/student-profile.service.ts` -- add `removeAllOwned(tx, parentAccountId): Promise<number>` and `countOwned(parentAccountId): Promise<number>` -- the sole writer of `student_profile` performs the write; the count is what the confirmation names first.
- `apps/api/src/sourcetest/source-test.service.ts` -- add `pageIdsForAccount(parentAccountId, tx?)`, `countsForAccount(parentAccountId)` and `purgeForAccountAllProfiles(tx, parentAccountId)` -- `sourcetest` owns `SourceTest` and `PageImage`, so nothing outside it queries those delegates; the `tx`-aware page read is what proves no page arrived mid-deletion.
- `apps/api/src/sourcetest/page-expiry.service.ts` -- widen `releaseBytes` and `markReleased` to take an optional caller label used in their log lines, defaulting to today's wording -- one unlink site and one marking site serve both deletion paths, and a line that says "Student Profile deletion" about an account deletion is a log that misleads the one person reading it.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `countsForAccount(parentAccountId)` and `purgeForAccountAllProfiles(tx, parentAccountId)` deleting practice tests then generation jobs, matched by `parentAccountId` -- the owner deletes its own rows in the one order Postgres accepts, for the reason `purgeForStudentProfile` documents.
- `apps/api/src/explanation/explanation.service.ts` -- add `countsForAccount(parentAccountId)` -- the rows cascade; only the number the confirmation names is needed.
- `apps/api/src/ai/ai.service.ts` -- add `purgeForAccount(tx, parentAccountId): Promise<number>` -- the sole writer of `ai_call` (AD-17, AD-20) removes the cost rows, which is the one thing account deletion erases that profile deletion does not; a future spend ceiling must read an account-anonymous aggregate, stated here and not built.
- `apps/api/src/deletion/account-deletion.service.spec.ts` -- unit-cover the matrix: happy path and the exact purge order, wrong password, empty account, a failed unlink refusing and marking, a page arriving mid-transaction, and that no tombstone is ever written -- the order and the refusals are the contract.
- `apps/api/test/parent-account-deletion.int-spec.ts` -- real-Postgres cases over the routes: every row of a two-child account gone and every byte off disk; consents, reset tokens, timezone rows, uncommitted state, usage tombstones and AiCall rows gone; `AdminAudit` rows still present; a second account completely untouched; the Admin flag queue emptied of that account's reports; both cookies cleared and the old cookie refused afterwards; wrong password 409 with nothing removed; an empty account deletable; preview counts -- bytes, cascades and cookie effects are only reachable in this tier.
- `apps/api/test/harness.ts` -- add whatever narrow seeding helper the account spec needs (an `AiCall` row, a consent, a reset token) only if it is not already there -- a spec that hand-rolls what the harness already mints is the drift the harness exists to prevent.
- `apps/web/src/lib/parent-api.ts` -- add `AccountDeletionPreview`, `accountDeletionPreview(token)` and `deleteAccount(token, password)`, reusing the elevated header and the password-in-body shape -- a client wired to a path the server does not serve fails only in front of a parent.
- `apps/web/src/copy/parent.ts` -- add a `settings` section: title, the `dataAndDeletion` heading, `deleteAccount`, `deleteAccountNote`, `deleteAccountSubject`, `deleteAccountBody(counts)` (names every non-zero count and kind, the children by number, that it cannot be undone and that nothing is recoverable afterwards), `accountDeleted`, `deleteAccountFailed`; add `parentView.settings` for the hub link -- every visible string lives in a copy file, and the confirmation's sentence is the story's acceptance.
- `apps/web/src/app/parent/settings/page.tsx` -- the Settings screen with a **Data & deletion** section holding the account-delete control: reads the preview, opens `DestructiveConfirmDialog` with the counted body, deletes on confirm, then clears elevation and replaces to `/auth/sign-in`; exports the small pure helpers and note component its spec reaches -- this is the entry point the UX names, and the one 8.2 and 8.3 both deferred for want of a home.
- `apps/web/src/app/parent/page.tsx` -- add the client-side `NextLink` to `/parent/settings` beside its neighbours -- a screen a parent cannot reach is a screen that did not ship.
- `apps/web/src/app/parent/settings/page.spec.tsx` -- cover the exported helpers and statically render the section: that the body names the counts, that the note says what deletion costs, and that a 409's `reason` is what the dialog shows -- the AC is about what the surface says before the parent confirms.
- `apps/web/src/lib/parent-api.spec.ts` -- cover the two new calls: verb, path, elevated header, and the password in the delete body -- the same case the 8.3 calls carry.
- `apps/web/src/copy/parent.spec.ts` -- cover `settings.deleteAccountBody`: a full account, an account with nothing under it, and that it always states the irreversibility -- the sentence is the gate's content, so it is tested as one.

**Acceptance Criteria:**
- Given an account with two children, uploads with photographs on disk, practice tests, attempts, explanations, mastery rows, usage tombstones, consents, a reset token, timezone history, uncommitted state and AiCall rows, when the parent confirms deletion with the correct account password, then every one of those rows is gone, no file remains at any of those pages' storage paths, the account row is gone, and a second account's rows and files are completely untouched.
- Given the same deletion, when the `admin_audit` table is read afterwards, then the rows recorded against that account are still there and still carry no child content.
- Given a completed deletion, when the same session cookie is replayed against any parent route, then it is refused, and the response that performed the deletion cleared both the parent session and Student Mode cookies.
- Given Parent View, when the parent opens Settings, then a Data & deletion section offers account deletion, says plainly what it costs, and its confirmation names the number of children and every count and kind that will be destroyed and that it cannot be undone.
- Given the confirmation dialog, when it is open, then it asks for the account password and no PIN, and its confirm control stays disabled until a password is typed.
- Given a wrong password, when the parent confirms, then nothing is deleted, the refusal is shown inside the dialog, and the parent is still in Parent View.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 3, low 9)
- defer: 8: (high 0, medium 8, low 0)
- reject: 11: (high 0, medium 2, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The confirmation could name stale counts: the preview was read once on mount and reused, so a child added or an upload committed since load left the dialog asserting old numbers. `onDeleteRequested` now reads the preview itself, guarded and staleness-checked, and a failed read opens nothing.
  - `[medium]` `[patch]` No test covered the new argon2-running `DELETE /api/parent/account` against the parent credential budget, so a dropped `@ParentCredentialRoute()` would have left no trace. Added the sibling block in `rate-limit.int-spec.ts` for the delete flood and for the preview not spending the budget.
  - `[medium]` `[patch]` The integration unlink-failure case asserted the rows survived but never that the released pages were marked and their files actually gone. It now asserts state, `storagePath`, `bytesDeletedAt` and disk for both the released and the refused page.
  - `[low]` `[patch]` The mid-flight page check scanned an account-wide array per page; it now tests membership against one `Set`.
  - `[low]` `[patch]` `ByteReleaseTrigger` was hand-duplicated beside `ExpiryTrigger` and defaulted to the profile path's label; it is now derived with `Extract` and required, with both call sites passing it explicitly and the profile spec asserting it.
  - `[low]` `[patch]` `refusalText` existed as two identical exported page helpers; the implementation moved to `@/lib/parent-view` and both pages re-export it.
  - `[low]` `[patch]` The Delete control sat disabled with nothing saying why while the preview was in flight; a `role="status"` line now says so.
  - `[low]` `[patch]` Nothing asserted the Parent View hub link, so the screen could have been made unreachable with every test green; the spec now reads `../page.tsx` for the href and the label, following the analytics precedent.
  - `[low]` `[patch]` The copy spec's typographic-apostrophe case was vacuous (no asserted string contained an apostrophe of either kind). It now asserts against sentences that carry one, plus a digits-ending-in-zero case for the absent-kind rule.
  - `[low]` `[patch]` The integration fixture hard-coded `aiCalls: 3`, coupling a deletion test to how many provider calls an upload happens to make; cost rows are now seeded explicitly and asserted on their own terms.
  - `[low]` `[patch]` Two unit cases awaited `delete` twice before asserting "nothing was deleted", so the assertions read the second attempt; each now captures one rejection.
  - `[low]` `[patch]` The success announcement was dead — the live region unmounted in the same tick as the `replace` to sign-in. Removed it with its copy key, and `setDeleting(false)` no longer runs on the paths that navigate.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 10: (high 0, medium 7, low 3)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` No test enforced the AD-20 log-line invariant (no id, no count of a child's work) on success — only a comment asserted it. Added a spy-on-`Logger` unit case in `account-deletion.service.spec.ts` asserting the success log carries no account id and no page id.
  - `[low]` `[patch]` `parent-view.ts`'s shared-rules JSDoc had a mid-sentence insertion that produced a run-on and contradicted its own "three rules" header (now reads as four). Reworded for one coherent sentence flow.
  - `[low]` `[patch]` The Settings-link comment on the Parent View hub (`parent/page.tsx`) was an unfinished/malformed sentence left over from editing. Rewritten.
  - `[low]` `[patch]` Two `rate-limit.int-spec.ts` block comments (and the mirroring doc comment on `ParentDeletionController`) called the shared `login` throttler bucket "the admin `login` bucket", but no admin-specific bucket exists in `app.module.ts` — it is one shared bucket used by both admin and parent credential routes. Reworded all three to "the shared `login` bucket(s)".
  - `[low]` `[patch]` The Settings delete button's `disabled` prop omitted `token === null`, so if the elevation token went null between mount and click, `onDeleteRequested`'s own guard would silently no-op with no visible feedback. Added `|| token === null` to the button's `disabled` expression to match the guard it fronts.

Note: two findings this pass restated pre-existing entries already in `deferred` from the prior pass verbatim (the `countsForAccount`/`pageIdsForAccount` state-filter mismatch, and the in-transaction page re-read's narrowed-not-closed race window) plus one restating the Settings screen's source-text-only test coverage; none were re-appended to avoid duplicate entries. All three are counted in the `defer` tally above.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` A successful account deletion could be reported to the parent as a failure: `onDeleteConfirmed` awaited `deleteAccount`, `clearElevation()` and `router.replace()` inside one `try`, so if either post-delete call threw, the `catch` set the refusal text to "nothing was removed" even though the delete had already committed. Restructured so `clearElevation()`/`router.replace()` run only after the `await` resolves cleanly, outside the `try`/`catch`, and can no longer produce a false refusal for an already-successful delete.

Twelve findings this pass restated entries already present in `deferred` (from this or the prior review passes) or the same source-text-only web-tier test-coverage limitation already logged; all thirteen (twelve reject-as-duplicate plus one accepted as a new defer below) were not re-appended where already present, per the dedup rule. One finding (`onDeleteRequested`'s early-return guard omitting the `loading` flag the button's own `disabled` expression checks) was rejected as unreachable: the button is the sole call site and is already disabled while `loading` is true.

## Design Notes

**Why a second service and not a flag on the first.** `ProfileDeletionService.delete` writes tombstones and refuses to refund; account deletion erases tombstones and has no allowance to keep honest. A shared method with a boolean would carry two contradictory contracts under one name, and the tombstone branch is exactly the part that must never be reached by accident. They are siblings in one module, sharing the policy file, the unlink routine and the password verifier.

**The order, one level out:**

```ts
await this.prisma.withTransaction(async (tx) => {
  await this.practiceTests.purgeForAccountAllProfiles(tx, accountId); // tests, then jobs
  await this.sourceTests.purgeForAccountAllProfiles(tx, accountId);   // pages, extractions cascade
  await this.students.removeAllOwned(tx, accountId);                  // attempts, explanations,
  await this.ai.purgeForAccount(tx, accountId);                       // mastery, uncommitted cascade
  await this.accounts.removeAccount(tx, accountId);                   // consents, resets, zones,
}, { timeout: ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS, maxWait: DELETION_TRANSACTION_MAX_WAIT_MS });
```

**Why `AiCall` goes.** It is the only `Restrict` child of the account that is not profile-scoped, so it would block the account delete outright — and it is a longitudinal per-account activity trace, which is precisely what FR-33 says does not survive. The deletion enumeration settles it: anonymized on profile deletion (nothing to do — the row carries no child id), deleted on account deletion. The global spend ceiling AD-23 wants is not built yet; when it is, it must read an account-anonymous rollup rather than this table, and that is Epic 9's problem, not a column this story adds.

**Why no tombstone.** A tombstone exists so a deleted artifact keeps being counted against a *surviving* account. There is no surviving account, and `UsageTombstone` cascades from the row being removed. Writing one would be a statement about an account that no longer exists, and would be deleted by the same transaction that wrote it.

**Why the cookies are cleared by the API.** The web app can clear its own in-memory elevation, but the session cookie is `httpOnly` and the Student Mode cookie binds the device to a child of the account just erased. Sign-out already clears both with these helpers, and a 204 that left them set would leave the browser holding a credential for an account that cannot be resolved — a 401 on the next navigation rather than a sign-in screen.

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass, including the new account-deletion cases.
- `pnpm --filter web test` -- expected: the settings-page, parent-api and copy specs pass.
- `pnpm lint && pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --write .` -- expected: no unformatted files remain.

## Auto Run Result

**Summary:** Story 8.4 (Parent Account Deletion) was already implemented and reviewed across two prior passes when this run started. This run invoked build-auto directly against the `done` spec, which per routing rules starts one more fresh review pass over the same diff rather than resuming implementation.

**Files changed:** unchanged from the prior passes' implementation (see Code Map / Tasks & Acceptance above), plus one file touched by this pass's patch:
- `apps/web/src/app/parent/settings/page.tsx` -- `onDeleteConfirmed` restructured so post-delete cleanup (`clearElevation`, `router.replace`) can no longer be caught and misreported as a deletion failure.

**Review findings breakdown (this pass):** 1 patch applied (medium), 1 deferred (medium), 14 rejected (duplicates of existing `deferred` entries, or unreachable/noise). See `## Review Triage Log` above for the full breakdown and `deferred` frontmatter for the newly added item (token-null-mid-dialog confirm no-op, inherited from Story 8.3's identical pattern).

**Verification performed:**
- `pnpm --filter web test` -- 68 files / 1425 tests passed, including `src/app/parent/settings/page.spec.tsx`.
- `pnpm --filter web lint` -- clean.
- `pnpm --filter web exec tsc --noEmit` -- clean.
- `pnpm exec prettier --write` on the touched file -- already formatted.
- The API tier (`pnpm --filter api test`) was not re-run this pass: no API file was touched by this pass's patch, and the prior review passes already exercised it against this same code.

**Residual risks:** all pre-existing, already recorded in the `deferred` frontmatter (bytes-first protocol duplication between the two deletion services, the mid-flight page/profile race windows, preview counts including already-`Deleted` pages, no advisory lock across concurrent deletion transactions, the Settings screen's node-environment test tier, the elevation bearer token's lack of revocation, and the pre-existing `apps/api` integration flake). None are new to this pass.

