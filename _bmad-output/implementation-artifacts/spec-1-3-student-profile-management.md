---
title: 'Story 1.3: Student Profile Management'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_revision: '281801d221653fdaf56c90a085d7bbe395ca61fd'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      No audit trail exists for parent-side Student Profile mutations: create, rename,
      Grade-Level change, archive and restore write no actor and no record.
    evidence: |-
      Admin writes all go through AdminAuditService (AD-25), but nothing equivalent covers
      the parent surface. `archivedAt` is the only trace any of these five operations leaves,
      and renames and Grade-Level changes leave none at all. Epic 8's deletion path and any
      support question ("who archived this profile, and when?") have nothing to read.
    location: >-
      apps/api/src/identity/student-profile.service.ts
    severity: low
  - summary: >-
      Nothing bounds the number of Student Profiles an elevated parent can create.
    evidence: |-
      The Account-Tier cap is deliberately Epic 9 (FR-31) and the suite asserts six profiles
      succeed on a Free account. Separately from that product rule, no sanity ceiling exists,
      so an authenticated create loop inserts rows without limit. This is an availability
      concern rather than the tier rule, and it can outlive Epic 9 if the cap lands as a tier
      figure alone.
    location: >-
      apps/api/src/identity/student-profile.service.ts create()
    severity: low
  - summary: >-
      Display-name normalisation does not strip zero-width, bidi-override or other
      format/control characters.
    evidence: |-
      `normaliseDisplayName` applies NFKC, collapses whitespace and trims, which leaves
      U+200B and bidi overrides intact. A name can therefore render invisibly or
      direction-flipped in Parent View, and two visually identical names can differ.
    location: >-
      apps/api/src/identity/student-profile-policy.ts
    severity: low
  - summary: >-
      `listSelectableGradeLevels()` is unbounded (no take/skip) and is read on every
      Students screen load.
    evidence: |-
      Same class as DW-8 (the unbounded Parent Accounts list): `findMany` with a where and an
      orderBy and no limit. Harmless at today's taxonomy size, unbounded by construction.
    location: >-
      apps/api/src/admin/taxonomy.service.ts
    severity: low
  - summary: >-
      The web app has no render-testing setup, so no Parent View screen behaviour is unit
      tested - only exported pure helpers and copy strings.
    evidence: |-
      `apps/web/vitest.config.ts` runs `environment: 'node'` and `apps/web/package.json`
      carries neither jsdom nor @testing-library/react. Every web spec in the repo therefore
      tests extracted functions; per-row pending locks, draft-survives-a-rejection, and error
      rendering are reachable only through Playwright, which is slower and coarser.
    location: >-
      apps/web/vitest.config.ts
    severity: medium
  - summary: >-
      Display-name length is bounded by UTF-16 code-unit count, not code points or
      grapheme clusters, so astral-plane characters (many emoji) count double and an
      unpaired surrogate is not explicitly rejected.
    evidence: |-
      `DISPLAY_NAME_MAX_LENGTH` gates both the DTO's `@MaxLength` and
      `isAcceptableDisplayName` on `string.length`, which counts UTF-16 units. A name
      built from astral-plane characters therefore has an unpredictable effective
      character budget, and no test exercises a surrogate pair or a lone surrogate.
      Same class of gap as the existing zero-width/bidi-override normalisation item
      above.
    location: >-
      apps/api/src/identity/student-profile-policy.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A Parent Account has no children under it: nothing models a Student Profile, so a parent cannot create one, name it, give it the one Admin-configured Grade Level everything downstream classifies by, or take it out of circulation without destroying its history. Every later epic — uploads, generation, attempts, mastery — hangs off a Student Profile that does not yet exist.

**Approach:** Add `StudentProfile` to the `identity` entity cluster (its sole writer), scoped to the elevation-gated Parent View surface: create / rename / change Grade Level / archive / restore over `/api/parent/students`, with the Grade Level resolved through `admin`'s `TaxonomyService` rather than a second reader of its tables. Archiving is a nullable timestamp — nothing is copied, nothing is cascaded, nothing is deleted — so a reference held by id keeps resolving and history survives by construction.

## Boundaries & Constraints

**Always:**
- `identity` is the sole writer of `StudentProfile` (AD-17). Nothing outside `StudentProfileService` touches its Prisma delegate.
- Grade Levels are read through `TaxonomyService` only — never through a `gradeLevel` delegate in `identity`.
- Every route is behind `ParentElevationGuard` (Parent View only, AD-18); every read and write is scoped to `req.elevated.parentAccountId`, and another account's profile id is a 404, never a 403.
- A profile requires a display name and exactly one Grade Level; both are required on create, and a Grade Level may never become null.
- Only an **enabled** Grade Level is selectable for a create or a change; an already-stored Grade Level keeps resolving after it is disabled or renamed (Story 2.1 AC-3).
- Rename and Grade-Level change write the `student_profile` row and nothing else. No label is ever copied into another table.
- Archive is `archivedAt`; it removes the profile from the selectable list and from nothing else. The row, its id and its `createdAt` are untouched.
- No figure is a literal in the web app: the display-name bound ships through `GET /api/auth/policy` like every other.
- Every user-facing string lives in `apps/web/src/copy/parent.ts`; Parent View names a child in the third person, by name.

**Block If:**
- The taxonomy read cannot be reached from `identity` without a circular module import that `forwardRef` alone would paper over rather than resolve.

**Never:**
- No Account-Tier profile cap — that is Epic 9 (FR-31). Creation succeeds past any tier figure in this story.
- No deletion of a profile and no Student Profile detail screen with a destructive action — Epic 8 (FR-33).
- No device binding, no Student Mode selection UI, no mode switching — Story 1.4.
- No Practice Test, Attempt or Mastery model: none exists yet, and none is invented here to prove they survive.
- No display-name uniqueness rule, and no Subject on a profile — neither is a stated requirement.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | Elevated parent; `{displayName: "Noah", gradeLevelId: <enabled>}` | 201 with the profile, `archived: false`, resolved Grade Level name | No error expected |
| Create, blank name | `displayName: "   "` | Rejected before any write | 400, name-required message |
| Create, name too long | `displayName` past the bound | Rejected by the DTO | 400 |
| Create, no Grade Level | `gradeLevelId` absent | Rejected by the DTO | 400 |
| Create, unknown Grade Level | `gradeLevelId` not in `grade_level` | No profile written | 404, Grade Level not found |
| Create, disabled Grade Level | `gradeLevelId` exists, `enabled: false` | No profile written | 400, not selectable |
| Create past any tier figure | 6 profiles on a `Free` account | 201 — the cap is Epic 9 | No error expected |
| Rename | `PATCH {displayName: "Noa"}` | 200; same id, same `gradeLevelId`, same `createdAt` | No error expected |
| Change Grade Level | `PATCH {gradeLevelId: <other enabled>}` | 200; same id, same `displayName` | No error expected |
| Patch with no fields | `PATCH {}` | Rejected — a no-op write is a client bug | 400 |
| Grade Level renamed in Admin | Profile stored against it | Next read shows the new name; the profile row is not written (`updatedAt` unchanged) | No error expected |
| Grade Level disabled in Admin | Profile stored against it | Profile still reads and still lists; the id still resolves | No error expected |
| Archive | `POST .../archive` on an active profile | 204; row survives; drops out of `GET .../selectable`, stays in `GET /students` as `archived: true` | No error expected |
| Archive, already archived | Same call again | 204, idempotent, `archivedAt` unchanged | No error expected |
| Restore | `POST .../restore` on an archived profile | 204; `archivedAt` null; back in the selectable list | No error expected |
| Another account's profile | Elevated as parent B, id belongs to A | Nothing read, nothing written | 404 — never 403, which would confirm it exists |
| Session cookie only | No `Authorization: Bearer` | Rejected before the handler | 401 with `elevated: false` |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:88-142` -- the `identity` cluster comment and `ParentAccount`; `StudentProfile` is added here with `timezones`/`consents`-style back-relations. `Subject`/`GradeLevel` at `:27-56` are `admin`'s and gain only a back-relation field, not a writer. `SubjectGradeLevel:60-74` is the precedent for a cross-row FK with `onDelete: Restrict`.
- `apps/api/src/identity/parent-account.service.ts:98-107,160-175` -- the sole-writer doc comment, `ACCOUNT_FIELDS` select-list convention, `conflictOnDuplicateEmail` P2002 mapping, and `setTier(tx, ...)` as the cross-module write shape. `StudentProfileService` mirrors all of it.
- `apps/api/src/identity/parent-pin.controller.ts:29-90` -- controller conventions to copy exactly: `@Controller('parent')`, `@SkipThrottle({ login: true })`, `@UseGuards(ParentElevationGuard)`, `@HttpCode`, reading the principal off `req.elevated!`. The new controller is a second `@Controller('parent')`.
- `apps/api/src/identity/parent-elevation.guard.ts:12-24,110-118` -- `ElevatedPrincipal` / `ElevatedRequest`; `request.elevated.parentAccountId` is the only account id any handler may trust.
- `apps/api/src/identity/identity.module.ts:27-44` -- where the new controller and service register; note `exports: [ParentAccountService]` and that `AdminModule` already imports this module — which is why the taxonomy read cannot be `imports: [AdminModule]`.
- `apps/api/src/admin/taxonomy.service.ts:90-127` -- `listSelectableSubjects`, `resolveGradeLevel` (deliberately succeeds for a disabled row), `ITEM_FIELDS`. `listSelectableGradeLevels()` is added beside them. `normaliseName:32` is the NFKC/whitespace precedent for display names.
- `apps/api/src/admin/admin.module.ts:26-45` -- `AdminModule` imports `IdentityModule` and provides `AdminAuditService` + `TaxonomyService`; extracting those two into a `TaxonomyModule` both modules import is what breaks the cycle.
- `apps/api/src/identity/auth-policy.ts:58-83` -- `AuthPolicy` + `currentAuthPolicy()`; add `studentNameMaxLength` here so the web restates no figure.
- `apps/api/src/identity/dto/parent-pin.dto.ts` -- DTO conventions: `@Transform` trim, `class-validator`, cross-field validation.
- `apps/api/test/harness.ts:100-107,278-322` -- `resetParentAccounts` TRUNCATE list, `createSignedInParent`, `setPinFor`, `elevate`, `bearer`. A `createGradeLevel` fixture and a `createStudentProfile` helper go here.
- `apps/api/test/parent-pin.int-spec.ts:1-45` -- integration-spec shape: env before the dynamic imports, `server()`, per-test reset.
- `apps/web/src/lib/parent-api.ts:180-235` -- the parent-scoped call block; every new call takes the bearer explicitly through `elevated(token)`.
- `apps/web/src/app/parent/page.tsx:26-80` -- the elevation-gated page pattern to copy verbatim: token from `useElevation()`, `router.replace('/parent/pin')` with no token, `requestId` staleness guard, `ParentApiError` → clear-and-redirect.
- `apps/web/src/app/admin/_components/TaxonomyList.tsx:32-80` -- the list-with-inline-create/rename pattern, `withPending` per-row write lock, "clear the draft only on success".
- `apps/web/src/copy/parent.ts` -- every string; figures arrive as parameters (`pinShape(length)` is the precedent).
- `e2e/global-setup.ts:26-31` -- the TRUNCATE list gains `student_profile`; `e2e/fixtures.ts:60-66` (`uniqueParentEmail`) is where a Grade Level fixture belongs.
- `apps/api/src/generated/prisma/**` -- generated; never hand-edited.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add `StudentProfile` (`id`, `parentAccountId`, `displayName`, `gradeLevelId`, `archivedAt DateTime?`, `createdAt`, `updatedAt`), relations to `ParentAccount` and `GradeLevel` both `onDelete: Restrict`, back-relation fields on both, `@@index([parentAccountId, archivedAt])`, `@@map("student_profile")`; doc comments naming AD-17 and why archive is a nullable instant. Then `pnpm --filter api exec prisma migrate dev --name add_student_profile` and `prisma format`.
- `apps/api/src/identity/student-profile-policy.ts` -- new: `DISPLAY_NAME_MAX_LENGTH` (60), `normaliseDisplayName` (NFKC, collapse internal whitespace, trim), `isAcceptableDisplayName`. The single source of the name's shape.
- `apps/api/src/identity/auth-policy.ts` -- extend `AuthPolicy`/`currentAuthPolicy()` with `studentNameMaxLength`.
- `apps/api/src/admin/taxonomy.service.ts` -- add `listSelectableGradeLevels()` (enabled only, ordered by name). Read-only; no audit row.
- `apps/api/src/admin/taxonomy.module.ts` -- new: provides and exports `AdminAuditService` and `TaxonomyService`. `admin.module.ts` imports it and drops both from its own `providers`, re-exporting the module; `identity.module.ts` imports it too. This is what lets `identity` read the taxonomy without importing `AdminModule`, which already imports `IdentityModule`.
- `apps/api/src/identity/student-profile.service.ts` -- new, sole writer: `list(parentAccountId)`, `listSelectable(parentAccountId)`, `findOwned(parentAccountId, id)` (404 otherwise), `create`, `update`, `archive`, `restore`. Every Grade Level is validated through `TaxonomyService.resolveGradeLevel` plus an `enabled` check on write; every read resolves the current Grade Level name rather than storing one.
- `apps/api/src/identity/dto/student-profile.dto.ts` -- new: `CreateStudentProfileDto` (`displayName` trimmed, 1..`DISPLAY_NAME_MAX_LENGTH`; `gradeLevelId` a UUID, required), `UpdateStudentProfileDto` (both optional, at least one present or the DTO rejects).
- `apps/api/src/identity/student-profile.controller.ts` -- new, `@Controller('parent')`, every route `@UseGuards(ParentElevationGuard)` and `@SkipThrottle({ login: true })`: `GET students`, `GET students/selectable`, `POST students` (201), `PATCH students/:id`, `POST students/:id/archive` (204), `POST students/:id/restore` (204), `GET grade-levels`. No route runs argon2, so none carries `@ParentCredentialRoute()`.
- `apps/api/src/identity/identity.module.ts` -- import `TaxonomyModule`; register `StudentProfileController` and `StudentProfileService`; export the service for Story 1.4.
- `apps/api/src/identity/student-profile-policy.spec.ts` -- unit-test the name predicates: NFKC forms, collapsed internal whitespace, trim, empty after normalisation, the length boundary at exactly the bound and one past it.
- `apps/api/test/harness.ts` -- add `createGradeLevel(h, {name, enabled})` (through `TaxonomyService`, never a raw delegate) and `createStudentProfile(...)`; add `"student_profile"` explicitly to `resetParentAccounts`'s TRUNCATE list and note the `grade_level` cascade in `resetTaxonomy`.
- `apps/api/test/student-profile.int-spec.ts` -- new: every row of the I/O matrix over HTTP, including cross-account 404, the session cookie refused without a bearer, the Admin rename/disable cases asserting the profile row's `updatedAt` is unchanged, archive idempotency, and six profiles on a `Free` account.
- `apps/web/src/copy/parent.ts` -- add the `students` section: list/empty/create/rename/archive/restore titles, labels and confirmations; `nameMaximum(max)` parameterised; the Grade-Level-change note stating existing Practice Tests are unaffected; archive described as *hides from Student Mode, keeps history* and visibly distinct from delete. Plain and factual, third person by name.
- `apps/web/src/lib/parent-api.ts` -- add `students`, `selectableStudents`, `gradeLevels`, `createStudent`, `updateStudent`, `archiveStudent`, `restoreStudent`, each taking the bearer explicitly; export `StudentProfileView` and `TaxonomyItem` types.
- `apps/web/src/app/parent/students/page.tsx` -- new: the elevation-gated Students screen — list (name, Grade Level, archived state), create form (name + Grade Level select, both required, submit disabled until both are set), per-row rename and Grade-Level change, archive/restore. Copies `/parent/page.tsx`'s token-and-staleness pattern exactly; every change announced through a live region using the displayed copy; real controls only; `density.compact` with a 44px floor.
- `apps/web/src/app/parent/page.tsx` -- add the link to `/parent/students` (client-side `next/link`, so the provider holding the token is not unmounted).
- `apps/web/src/app/parent/students/page.spec.tsx` -- unit-test that a create is refused client-side without a Grade Level, that a superseded response is a no-op, and that the archive control's copy names what archiving does.
- `e2e/fixtures.ts`, `e2e/global-setup.ts` -- add a Grade Level fixture; add `"student_profile"` to the TRUNCATE list.
- `e2e/tests/parent-students.spec.ts` -- new: sign up → set PIN → Parent View → create a profile with a Grade Level → rename it → change its Grade Level → archive it → it is gone from the selectable list and still on the screen as archived → restore it; and a reload returns to the PIN gate rather than the Students screen.

**Acceptance Criteria:**

- Given an elevated parent and an Admin-configured Grade Level, when a Student Profile is created with a display name and that Grade Level, then it is persisted against the parent's account and reads back with the Grade Level's current name; and when either the name or the Grade Level is omitted or blank, then no row is written.
- Given a Student Profile stored against a Grade Level, when an Admin renames or disables that Grade Level, then the profile's id still resolves, the profile still reads with the Grade Level's current name, and the `student_profile` row was not written (its `updatedAt` is unchanged) — no consumer holds a copied label.
- Given an existing Student Profile, when it is renamed or its Grade Level is changed, then its id, its `createdAt` and every field it did not change are identical afterwards, and exactly one row in one table was written.
- Given an active Student Profile, when it is archived, then `GET /api/parent/students/selectable` no longer offers it while `GET /api/parent/students` still returns it as archived, the row and its `createdAt` are intact, and a restore puts it back in the selectable list unchanged.
- Given a parent elevated on account B, when any `/api/parent/students` route is called with an id belonging to account A, then the response is 404 and account A's row is neither read into the response nor written.
- Given a `Free` Parent Account, when more Student Profiles are created than any Account Tier figure allows, then every creation succeeds — the cap is Epic 9 and is not enforced here.
- Given `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` and `pnpm run build && pnpm run e2e` at the repo root, when run on a clean tree, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-09-23 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 2, low 9)
- defer: 5: (high 0, medium 1, low 4)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` The Students screen's `load()` ejected the parent to the PIN gate on any non-network API error - a 500, a 429, or a 400 from the unauthenticated policy read sharing its `Promise.all` - clearing the elevation token and forcing a PIN re-entry for a transient fault. An exported `endsParentView(cause)` now confines eviction to the elevation guard's own refusal (`notElevated` or 401); every other rejection renders the error with Retry.
  - `[medium]` `[patch]` The service claimed every write was scoped by `parentAccountId` in the same query, but `update`, `archive` and `restore` wrote `where: { id }` after a separate ownership read - a check-then-act whose vanished-row case surfaced as a Prisma P2025 500 rather than a 404. All three now write through `updateMany` carrying the account (archive/restore additionally compare-and-set on `archivedAt`), with a new test asserting a cross-account write leaves the row byte-identical, `updatedAt` included.
  - `[low]` `[patch]` `findOwned` had no route, no caller and no test; removed.
  - `[low]` `[patch]` The DTO repeated the service's `NOTHING_TO_CHANGE` sentence as a literal, and the synthetic `changes` carrier property became an accepted request field under `whitelist`/`forbidNonWhitelisted`; the constant is now imported and a body carrying `changes` is rejected, with a test that sends one.
  - `[low]` `[patch]` The same invalid name produced two different messages depending on which layer caught it; both rules now live in `student-profile-policy.ts` and one message serves the rule.
  - `[low]` `[patch]` The integration suite asserted failure messages by regex, so a reworded message failed nothing; assertions now use the exported constants.
  - `[low]` `[patch]` Five untested cases added: a non-UUID `:id` (400 at the pipe, asserted not to leak the not-found wording), a `PATCH` naming an unknown Grade Level (404, row untouched), a rename needing re-normalisation, `restore` on an already-active profile, and the list/selectable ordering contract over four rows.
  - `[low]` `[patch]` Three E2E assertions could not fail: `row()` matched substrings, so the rename step passed against a row still reading the old name; the archive-copy expectation lived inside a `page.once('dialog')` handler that simply never ran if no dialog fired; and `readStudentProfile` matched a name with no account scope and no cardinality check while duplicate names are deliberately legal. All three now assert what they claim.
  - `[low]` `[patch]` The E2E Grade Level fixture computed `nameKey` as a raw `toLowerCase()` while `TaxonomyService` owns an NFKC/collapse rule; the fixture now derives the key by the same rule.
  - `[low]` `[patch]` `gradeLevelEnabled` and the withdrawn-Grade-Level copy - the only reason the field is on the contract - were exercised at no surface; a new E2E case withdraws a Grade Level a profile already holds and asserts the row switches to the withdrawn sentence.
  - `[low]` `[patch]` Accessibility: every row's Grade-Level select carried the same accessible name while the sibling buttons named the child, and the live region never changed on a repeated identical action, so the repeat was not announced. Both fixed, both unit-tested.

### 2026-09-23 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[low]` `[patch]` The rename form's `TextField` had no `required` attribute, unlike the create form's name and Grade Level fields, so submitting a blank rename silently no-opped with no error shown. Added `required` to match the create form's convention.
  - `[low]` `[patch]` `update()`'s integration tests for a genuine rename and a genuine Grade-Level change asserted `id`, `displayName`/`gradeLevelId` and `createdAt`, but never that `updatedAt` actually advanced - only the no-op paths (`NOTHING_TO_CHANGE`, unknown Grade Level, cross-account write) asserted it stayed unchanged, so a regression that silently no-opped a real write would pass. Both tests now assert `updatedAt` changed against a `before` snapshot.

## Design Notes

**Why a `TaxonomyModule` rather than `forwardRef`.** `AdminModule` already imports `IdentityModule` (it writes tiers through `ParentAccountService`), so `identity` importing `AdminModule` for a taxonomy read closes a cycle. `forwardRef` would compile and hide it. Lifting the two providers `identity` actually needs — `TaxonomyService` and the `AdminAuditService` it depends on — into a module both import states the real shape: the taxonomy is a shared read, `admin` is still its only writer.

**Archive is a nullable instant, not a boolean.** "Preserves history" is satisfied by doing nothing destructive, and a timestamp additionally records *when*, which Epic 8's deletion path and Epic 9's active-count both want. Restore ships with it because an archive with no inverse makes a mistyped tap unrecoverable until Epic 8 lands a delete — and delete is the wrong repair for it.

**Nothing proves a Practice Test survives, because none exists.** The surface-anchored stand-in is the reference itself: the profile is held by id, no name or Grade-Level label is copied anywhere, and an Admin rename changes what the profile reads without writing the profile row. That is the same property the later epics will depend on, tested at the outermost surface that exists today.

**Selectable is its own endpoint.** Story 1.4's binding prompt needs exactly "the profiles Student Mode may bind to", and archiving's whole observable effect is that this list shrinks. Making it a route rather than a query flag means the archive AC observes an HTTP surface now, and 1.4 consumes it unchanged.

**A cross-account id is a 404.** A 403 would confirm the profile exists under some other account; the guard already knows the account authoritatively, so the scoped read simply finds nothing.

## Verification

**Commands:**
- `docker compose up -d postgres` -- expected: healthy container
- `pnpm --filter api exec prisma migrate dev --name add_student_profile` -- expected: one new migration directory, schema applied. On drift from an earlier attempt: `pnpm --filter api exec prisma migrate reset --force`, then regenerate.
- `pnpm --filter api exec prisma format` -- expected: no further changes to `schema.prisma`
- `pnpm run typecheck` -- expected: clean
- `pnpm run lint` -- expected: clean, or the pre-existing "eslint not installed" gap unchanged (recorded in Story 1.1; not a regression to fix here)
- `pnpm run test` -- expected: all unit + integration specs pass, including `student-profile-policy.spec.ts` and `student-profile.int-spec.ts`
- `pnpm run build` then `pnpm run e2e` -- expected: `parent-students.spec.ts` passes alongside the existing suites. `pnpm run e2e` does not go through turbo, so the build must run first or it tests a stale `apps/api/dist`.
- `pnpm prettier --write .` -- expected: no unformatted files remain

## Auto Run Result

Status: done

**Summary:** Follow-up review pass on the already-implemented Story 1.3 (Student Profile Management). No new intent gaps or spec defects; two small implementation issues found and patched, one edge case deferred.

**Files changed this pass:**
- `apps/web/src/app/parent/students/page.tsx` -- the rename form's `TextField` now carries `required`, matching the create form's convention, so a blank rename no longer silently no-ops with no error shown
- `apps/api/test/student-profile.int-spec.ts` -- the genuine-rename and genuine-Grade-Level-change tests now assert `updatedAt` actually advances, not only that it stays unchanged on the no-op paths

**Review findings breakdown:** 2 patches applied (0 high, 0 medium, 2 low), 1 deferred (low), 14 rejected, 0 intent gaps, 0 spec defects.

**Follow-up review recommended:** false. This pass's patched severities: high 0, medium 0, low 2; score = 3 × 0 + 1 × 2 = 2, below the threshold of 5.

**Verification performed:**
- `pnpm run typecheck` -- clean
- `pnpm run test` -- 344 passed across 28 files (286 api + 58 web), including the two updated integration tests and the unchanged `page.spec.tsx` suite (still 12/12 with `required` added)
- `pnpm prettier --write .` -- no unformatted files remaining
- `pnpm run lint` -- fails with the pre-existing "eslint not installed" gap recorded in Story 1.1; unchanged by this pass and not a regression
- `pnpm run build && pnpm run e2e` not re-run this pass: the two patches touch only a native HTML `required` attribute (no e2e scenario submits a blank rename) and a server-side test assertion (no product-code change); typecheck plus the full unit/integration suite cover both directly

**Residual risks:**
- The astral-plane/surrogate-pair display-name length edge case is newly deferred (frontmatter `deferred`); same class as the pre-existing zero-width/bidi-override item.
- The deferred items already in this spec's frontmatter remain open: no audit trail for parent-side mutations, unbounded profile creation, zero-width/bidi display-name characters, unbounded `listSelectableGradeLevels()`, and the web app's lack of a render-testing setup.

