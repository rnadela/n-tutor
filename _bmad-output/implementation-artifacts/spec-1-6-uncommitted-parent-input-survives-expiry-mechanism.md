---
title: 'Story 1.6: Uncommitted Parent Input Survives Expiry (mechanism)'
type: 'feature'
created: '2026-09-24'
baseline_revision: '35ebdb6502f28ed14309938043c5a47b192cac37'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Nothing caps how many uncommitted-state slots one account can hold, so an elevated parent
      can grow the store without bound for the full 72-hour window.
    evidence: |-
      `scope` is a free-form caller-supplied string and every distinct (kind, scope) pair opens a
      new row holding up to the payload ceiling. There is no per-account row count, no byte
      budget, and the routes skip the credential throttler bucket because none of them runs
      argon2. The read is now page-capped, which bounds the response but not the store. A cap is
      a product decision that belongs with Epic 9's allowance work rather than with the mechanism.
    location: >-
      apps/api/src/identity/uncommitted-state.service.ts
    severity: medium
  - summary: >-
      The 72-hour sweep runs opportunistically on each save rather than as the pg-boss schedule
      AD-33 states, so an account that never saves again keeps expired rows on disk.
    evidence: |-
      This repo has no pg-boss, no worker entrypoint and no job table; standing all three up
      belongs to the story that first needs background work (Epic 3's orphaned-capture sweep).
      Reads filter on `expiresAt`, so an expired row is invisible the instant the clock passes
      regardless — but the bytes are only deleted when some later save on any account triggers
      `sweepExpired()`. The scheduled job, when it lands, calls that same method unchanged.
    location: >-
      apps/api/src/identity/uncommitted-state.service.ts
    severity: medium
  - summary: >-
      The hand-rolled "names no storage API" source scan now exists twice, with two independently
      drifting comment-stripping regexes.
    evidence: |-
      `apps/web/src/lib/elevation.spec.tsx` and `apps/web/src/lib/parent-api.spec.ts` each carry
      their own copy. Both strip comments with a line-start-only filter that misses trailing
      comments, and both match literal identifiers only, so an indirection such as
      `globalThis['local' + 'Storage']` passes either. Both files now also assert at runtime with
      storage spies, which is the real guard; unifying the scan means editing a Story 1.4 file
      this story had no other reason to touch.
    location: >-
      apps/web/src/lib/parent-api.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 1.5 made Parent View expire silently, and AD-18 makes a reload destroy the elevation token — so anything a parent had half-typed dies with no warning and no chance to save it. Nothing in the system holds uncommitted parent input at all: there is no row, no TTL, no read path, and no rule keeping it away from a child in Student Mode.

**Approach:** Ship the one server-side uncommitted-state mechanism AD-16 describes, and nothing that consumes it. An `UncommittedState` row is owned by the Parent Account, keyed additionally to the Student Profile it was created under, carries an opaque JSON payload under a declared `kind`, and lives 72 hours from creation. It is written and read only behind `ParentElevationGuard`, which is what makes "restoration happens strictly after PIN verification" true by construction rather than by convention. Epics 3, 4 and 6 add a `kind` and a payload shape; they do not rebuild this.

## Boundaries & Constraints

**Always:**
- The state is server-side only. Nothing about it is written to `localStorage`, `sessionStorage`, a cookie, or IndexedDB — the same prohibition `elevation.spec.tsx` already pins for the token.
- Every read and every write is behind `ParentElevationGuard`. The session cookie alone, the Student Mode cookie, and no credential at all are all refused identically — a device sitting in Student Mode can reach none of it.
- The account comes from `req.elevated`, never from the path or the payload (the rule every `/parent` route already follows).
- A row is keyed to the Parent Account **and** the Student Profile it was created under (AD-33). A read naming a different profile — or an archived one, or one belonging to another account — finds nothing: a 404, never a 403, which would confirm the row exists.
- TTL is 72 hours **from row creation**, never extended by an update (AD-16). An expired row is never returned and is deleted outright, leaving no tombstone.
- The payload is opaque JSON with a declared size ceiling. It carries no bytes: Page Images are `PageImage` rows under AD-15, referenced by id when Epic 3 lands.
- No payload content is ever logged, and no error message quotes it (AD-20).
- `identity` is the sole writer, through `UncommittedStateService`. No other module touches the delegate (AD-17).
- Both figures the mechanism owns — the TTL and the payload ceiling — live once, in an `uncommitted-state-policy.ts` beside `pin-policy.ts`, with env overrides resolved at boot by the same `requireIntEnv` pattern.

**Block If:**
- The intent would require changing the elevation TTL, the 8-hour ceiling, the PIN cool-down, or the shape of any existing credential.

**Never:**
- No consumer. No Parent View screen is wired to save or restore anything, no draft-edit / grade-override / partial-upload payload shape is invented, and no React hook is written for a caller that does not exist. Story 1.6 is the mechanism; the epic says so explicitly.
- No pg-boss, no worker entrypoint, no scheduler dependency — see Design Notes for how the delete actually happens now and why that is the whole of what this story owes.
- No restoration of *position* (which screen, which question). AD-16's row models work, not location; the reconcile pass records location restore as an open gap, not as this story's job.
- No change to the idle clock, `ParentIdleExpiry`, or any Story 1.5 behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save, then expiry, then re-entry | A row saved with elevation; Parent View expires; the PIN is crossed again | The read returns the payload byte-identical, with the original `createdAt` and `expiresAt` | No error expected |
| Save twice into one slot | A second `PUT` for the same account + profile + kind + scope | One row, the newer payload, `expiresAt` **unchanged** from the first save | No error expected |
| Device in Student Mode | Any read or write carrying only the session cookie and/or the Student Mode cookie | 401 `elevated: false` | The elevation guard is the only door; there is no second one |
| Cross-profile read | A row saved under profile A; the read names profile B (same account) | 404 — nothing is returned and nothing is rebound | `PROFILE_NOT_FOUND`-shaped message; never a 403 |
| Archived profile | A row saved under a profile that is then archived | 404 on the read; the row itself is left alone | Archiving's whole effect is that the profile leaves the list a read may name |
| Another account's profile id | A read naming a profile id owned by a different account | 404, indistinguishable from an unknown id | No cross-account existence signal |
| TTL elapsed | A row whose `expiresAt` is in the past | Never returned by any read, and deleted | Treated exactly as "no row" |
| Save onto an expired slot | A `PUT` into a slot whose existing row has expired | The expired row is replaced by a fresh one with a fresh 72-hour window | The dead row never resurrects |
| Oversized payload | A payload above the declared serialized ceiling | 400, stating the limit and nothing about the content | The message quotes no payload text |
| Unknown kind | A `kind` outside the declared enum | 400 from validation | The extension point is a declared list, not a free string |
| Discard after commit | `DELETE` of a row id on this account | 204; a second `DELETE` of the same id is also 204 | Idempotent, scoped by account in the delete statement itself |
| Account or profile removed | Epic 8 deletes the account or the profile | The rows go with it, cascaded, leaving nothing | No tombstone: nothing was ever charged |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:100-170` -- the `identity` cluster: `AccountTier` shows the Prisma enum + `@@map` convention; `ParentAccount` (relation list at the end) and `StudentProfile` are the two parents the new row hangs off. `AccountConsent`/`PasswordReset` are the `onDelete: Cascade` precedent to copy; `StudentProfile`'s own `Restrict` is deliberately *not* the precedent here.
- `apps/api/prisma/migrations/` -- six migrations, newest `20260923130909_add_student_profile`. The new one joins them; `pnpm run db:up` first, since `prisma migrate dev` needs the database.
- `apps/api/src/identity/pin-policy.ts:1-30,60-105` -- the exact shape to mirror for `uncommitted-state-policy.ts`: exported constants, a `*Runtime()` resolved once at boot via `requireIntEnv`, a `reset*Runtime()` test seam, and one message per rejection with no code and no exclamation mark.
- `apps/api/src/identity/identity.module.ts:20-70` -- where the new controller, service and the boot-time runtime check are registered. `IdentityModule`'s constructor already calls `pinRuntime()` for exactly this reason.
- `apps/api/src/identity/student-profile.controller.ts:33-60,116-135` -- the class-level `@UseGuards(ParentElevationGuard)` + `@SkipThrottle({ login: true })` pattern, `req.elevated!.parentAccountId`, `ParseUUIDPipe` on a path id, and the 404-not-403 rule stated in its own words. The new controller is this file's shape.
- `apps/api/src/identity/student-profile.service.ts:40-95` -- `findSelectable(parentAccountId, id)` is the cross-profile and archived check, already written: the read path calls it rather than re-deriving ownership. Also the "every write is scoped by `parentAccountId` in the same statement" rule.
- `apps/api/src/identity/parent-elevation.guard.ts:80-116` -- what "behind the gate" means concretely; nothing new is needed from it.
- `apps/api/src/identity/dto/parent-pin.dto.ts:44-90` -- DTO conventions: `class-validator`, `@Transform(trim)`, a custom `registerDecorator` validator for a rule that spans fields (the payload-size check is one of these).
- `apps/api/src/app-setup.ts:6-12` -- `whitelist: true, forbidNonWhitelisted: true`: an unknown body field is already a 400, so the DTO is the whole of the input contract.
- `apps/api/src/prisma/prisma.service.ts:10-35` -- `TransactionClient` and `withTransaction`, for the replace-an-expired-slot write.
- `apps/api/test/harness.ts:330-386` -- `createCredentialedParent`/`setPinFor`/`elevate`/`bearer`/`elevationTokenWithClaims` and `studentCookieFrom`. Everything the integration spec needs already exists; no harness change is expected beyond a profile fixture it already has.
- `apps/api/test/student-profile.int-spec.ts` + `apps/api/test/parent-pin.int-spec.ts` -- the two nearest integration specs; the new one matches their structure (per-suite harness, real Postgres, supertest).
- `apps/web/src/lib/parent-api.ts:200-320` -- the `parentApi` object and the `elevated(token)` header helper. The three new calls go here, each taking the bearer as a parameter; the module deliberately holds no token of its own.
- `apps/web/src/lib/parent-api.spec.ts` -- the existing fetch-stub style the new calls' specs follow.
- `apps/web/src/lib/elevation.spec.tsx:60-78` -- the "names no storage API" source assertion; the same kind of assertion covers the new calls, because server-side-only is this story's central constraint.
- `e2e/tests/parent-idle-expiry.spec.ts:1-110` -- `handOverTheDevice`, `enterParentViewOnAFakeClock`, `parentViewHeading`, `WINDOW_MS`/`PAST_THE_WINDOW` read from the same env expression `playwright.config.ts` states. The new E2E reuses all of it verbatim.
- `e2e/fixtures.ts` -- `createGradeLevelFixture`, `uniqueParentEmail`.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add enum `UncommittedStateKind` (`DraftEdit`, `GradeOverride`, `PartialUpload` — the three the epic names as plugging in later) and model `UncommittedState`: `id`, `parentAccountId`, `studentProfileId` (**not null** — AD-33 keys every row to a profile), `kind`, `scope String @default('')` (an opaque caller-supplied discriminator, e.g. a Practice Test id, so one kind can hold more than one slot), `payload Json`, `createdAt`, `updatedAt`, `expiresAt`. `@@unique([parentAccountId, studentProfileId, kind, scope])` is the slot; `@@index([expiresAt])` is the sweep. Both relations `onDelete: Cascade` — an uncommitted row never blocks a deletion and leaves no tombstone (AD-15/16). Back-relations on `ParentAccount` and `StudentProfile`.
- `apps/api/prisma/migrations/<timestamp>_add_uncommitted_state/` -- generated, not hand-written (`pnpm run db:up` then `prisma migrate dev`).
- `apps/api/src/identity/uncommitted-state-policy.ts` -- new: `UNCOMMITTED_STATE_TTL_MS` (72 h) and `UNCOMMITTED_PAYLOAD_MAX_BYTES`, an `uncommittedStateRuntime()` reading `UNCOMMITTED_STATE_TTL_MS` / `UNCOMMITTED_PAYLOAD_MAX_BYTES` through `requireIntEnv` and resolved once, a `resetUncommittedStateRuntime()` seam, pure `expiryFrom(createdAt)` / `isExpired(row, now)` / `payloadByteLength(payload)` / `isWithinPayloadLimit(payload)`, and the rejection messages. No second definition of 72 hours exists anywhere.
- `apps/api/src/identity/uncommitted-state-policy.spec.ts` -- new: expiry is created-at plus the TTL and is exclusive at the instant (matching `isWithinCeiling`'s boundary rule); a payload at the ceiling passes and one byte over fails; the byte length is measured on the serialized form, not on key count.
- `apps/api/src/identity/uncommitted-state.service.ts` -- new, sole writer. `save()` upserts the slot in one transaction: an existing **unexpired** row keeps its `createdAt`/`expiresAt` and takes the new payload; an existing **expired** row is deleted and replaced with a fresh window. `restorableFor(parentAccountId, studentProfileId)` returns the unexpired rows for that profile, newest first, after `StudentProfileService.findSelectable` has confirmed the profile — a refusal there is what makes the cross-profile and archived cases 404. `discard(parentAccountId, id)` is a `deleteMany` scoped by account. `sweepExpired(now)` deletes every row past its `expiresAt` and returns the count; reads filter on `expiresAt` too, so a row is invisible the instant it dies whether or not a sweep has run.
- `apps/api/src/identity/dto/uncommitted-state.dto.ts` -- new: `SaveUncommittedStateDto` with `@IsUUID()` `studentProfileId`, `@IsEnum` `kind`, optional trimmed `scope` (max length, default `''`), and `payload` as a plain object validated by a `registerDecorator` size rule quoting the limit and never the content. A query DTO for `GET` carrying `studentProfileId`.
- `apps/api/src/identity/uncommitted-state.controller.ts` -- new, `@Controller('parent')`, class-level `@UseGuards(ParentElevationGuard)` + `@SkipThrottle({ login: true })`, no `@ParentCredentialRoute()` (nothing here runs argon2): `PUT uncommitted` (save, 200, returns the view), `GET uncommitted` (the restorable rows for the named profile), `DELETE uncommitted/:id` (204, `ParseUUIDPipe`).
- `apps/api/src/identity/identity.module.ts` -- register the controller and service; call `uncommittedStateRuntime()` in the constructor beside `pinRuntime()` so a mistyped override fails at boot.
- `apps/api/test/uncommitted-state.int-spec.ts` -- new: every I/O matrix row over real HTTP — the save/expire/re-elevate round trip; the second save keeping the first `expiresAt`; 401 for the session cookie alone, for the Student Mode cookie, and for no credential; 404 for another profile, an archived profile, and another account's profile id; an expired row invisible and swept (drive it by writing `expiresAt` into the past through the harness's Prisma, or by a short `UNCOMMITTED_STATE_TTL_MS`); a save onto an expired slot getting a fresh window; 400 for an oversized payload and for an unknown kind; `DELETE` idempotent; and a cascade check that removing the profile removes the rows.
- `apps/web/src/lib/parent-api.ts` -- add `saveUncommittedState(token, input)`, `uncommittedState(token, studentProfileId)`, `discardUncommittedState(token, id)`, each carrying the bearer through the existing `elevated()` helper and nothing else. No module-level state, no storage call.
- `apps/web/src/lib/parent-api.spec.ts` -- extend: each new call sends the bearer and the expected method/path, a 401 `elevated: false` surfaces as `ParentApiError.notElevated`, and the module still names no storage API anywhere in its source.
- `e2e/tests/parent-uncommitted-state.spec.ts` -- new. Reuse `handOverTheDevice` / `enterParentViewOnAFakeClock`; `page.request` shares the browser's session cookie, so the test crosses the PIN over HTTP for its own bearer and drives the mechanism through the real API while the browser drives the real expiry: save a payload under the bound profile, fast-forward past the idle window, land on Student Mode, assert `localStorage`/`sessionStorage` hold no trace of the payload and that a read with no bearer is 401, then re-enter and read the payload back unchanged. A second case saves under profile A and reads naming profile B and asserts 404.

**Acceptance Criteria:**

- Given uncommitted parent state saved while elevated, when Parent View expires silently, then the state is still held server-side afterwards with its original creation-based TTL, and nothing of it was ever written to client storage.
- Given a device that has fallen back to Student Mode, when anything on it attempts a read of retained state, then it is refused before the PIN is crossed — the elevation bearer is the only credential any of these routes accepts.
- Given retained state and a fresh PIN crossing, when the parent re-enters and reads it, then the payload comes back exactly as saved.
- Given the whole mechanism, when a payload shape for a draft edit, grade override, or partial upload is looked for, then none exists — this story ships the mechanism and no consumer.
- Given `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` and `pnpm run build && pnpm run e2e` at the repo root, when run on a clean tree, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 1, medium 5, low 8)
- defer: 3: (high 0, medium 2, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[high]` `[patch]` The cross-profile refusal the matrix and the story's third AC both require was
    not expressible: the only read was the by-profile list, so asking for a sibling profile simply
    returned its own empty list at 200, and the integration test titled "answers 404 for a sibling
    profile" asserted exactly that while taking its 404 from an unrelated unknown-profile save.
    Added `GET /parent/uncommitted/:id` with a required `studentProfileId`, refusing with one
    indistinguishable 404 whenever the row's own profile is not the named one — plus the by-id
    cross-profile cases at the integration and E2E layers, and the misnamed test renamed to what it
    actually asserts.
  - `[medium]` `[patch]` Two concurrent saves into one empty slot could both take the create branch
    and turn a `P2002` into a 500 on the write whose whole purpose is not losing work — the write
    now retries once on the slot's unique violation, with the overstated comment corrected and both
    a race case and deterministic unit cases covering it.
  - `[medium]` `[patch]` The E2E's profile-keying case never asserted its own save had landed, so a
    400 there would have left the downstream "the sibling sees nothing" assertion trivially true.
  - `[medium]` `[patch]` The client half's central constraint was pinned only by a source-text grep
    that executes nothing; the four calls now run against spied `localStorage`, `sessionStorage`,
    `document.cookie` and `indexedDB`, matching the precedent `elevation.spec.tsx` already set.
  - `[medium]` `[patch]` `sweepExpired()` was an unbounded cross-account delete run inside one
    parent's request — now a capped batch, with the service's "every statement is account-scoped"
    doc amended to state the sweep as its deliberate exception.
  - `[medium]` `[patch]` The E2E's storage dump omitted IndexedDB, which the Always list names
    explicitly and which `elevation.spec.tsx` stubs for that reason.
  - `[low]` `[patch]` Neither new env override appeared in `.env.example`, though the module now
    refuses to boot on a bad value for either.
  - `[low]` `[patch]` `SCOPE_MAX_LENGTH` was a third owned figure living outside the policy file and
    untested — moved, and covered by an over-cap 400 and a trim-addresses-one-slot case.
  - `[low]` `[patch]` `UNCOMMITTED_STATE_NOT_FOUND` was dead and `isExpired()` was used only by its
    own spec while the queries restated the boundary inline; the by-id read now consumes the
    message, and `expiredAt`/`liveAt` filter builders put every query on the policy's one boundary.
  - `[low]` `[patch]` Deleting the `uncommittedStateRuntime()` call from `IdentityModule`'s
    constructor broke no test; the module spec now pins both overrides failing construction.
  - `[low]` `[patch]` "Newest first" was documented but asserted only order-insensitively.
  - `[low]` `[patch]` The swallowed sweep failure — the rule that housekeeping never fails a
    parent's save — was unreachable from the integration suite and is now a service unit spec.
  - `[low]` `[patch]` Two unbounded edges: the restore read had no page cap, and the payload ceiling
    was unrelated to Express's body limit, so an override above it would have yielded a framework
    413 instead of the policy's own 400. Both bounded, the second refused at boot.
  - `[low]` `[patch]` Nits in one pass: one clock threaded through the save; `updatedAt` movement
    asserted; `payloadByteLength`'s doc corrected to say it measures the serialized request object;
    `ParentAccount`'s back-relation given the cascade comment its sibling already had; both harness
    reset docs updated for the new table.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `save()`'s unique-violation retry only covered a two-way race: a third
    concurrent save colliding with the retry itself would have propagated the P2002 unhandled
    instead of resolving, turning a write whose stated purpose is not losing work into a bare 500.
    The single retry is now a bounded loop of `SLOT_WRITE_MAX_ATTEMPTS` (3) attempts, with a
    deterministic test pinning the exhaustion path.
  - `[low]` `[patch]` If the named profile was archived or removed in the window between
    `findSelectable`'s up-front check and the write landing, the resulting foreign-key violation
    propagated as a bare 500 instead of the 404 every other refusal in this mechanism gives. `save()`
    now catches the P2003 and answers `PROFILE_NOT_FOUND`, with a test pinning it.

## Design Notes

**Why the TTL is enforced on read as well as by deletion.** AD-33 puts the 72-hour sweep on a pg-boss schedule, and this repo has no pg-boss, no worker entrypoint and no job table — standing all three up is a dependency that belongs to the story that first needs background work (Epic 3's orphaned-capture sweep), not to this one. The rule AD-16 actually states is that an expired row is not restorable and is deleted outright. Filtering every read on `expiresAt` makes the first half true the instant the clock passes, independent of any scheduler; `sweepExpired()` makes the second half true and is called opportunistically on each save, so an abandoned slot's bytes do not outlive their window by more than the next write. When the worker lands, the schedule calls the same method — nothing about this mechanism changes.

**Why the row is keyed to a profile and the read names one.** A row that were merely account-scoped would satisfy "keyed to the Parent Account" and still strand one child's draft on a device a sibling is now operating, which is the exact exposure FR-4 forbids and AD-33 closes. Making `studentProfileId` non-null and routing the read through the existing `findSelectable` gets three refusals from one check: a different profile, an archived profile, and another account's profile are all simply "no such profile", and none of them distinguishes itself from the others.

**Why the TTL does not move on update.** AD-16 says it plainly — measured from row creation, not extended by activity — and the reason matters: the alternative turns an actively re-saved slot into an indefinite store of children's schoolwork that no clock reaches, which is precisely what the PRD added the TTL to prevent.

**Why `kind` is an enum and `scope` a free string.** The enum is the extension point the epic describes: a later epic adds one value and one AC. `scope` is deliberately opaque and untyped by this story, because "which Practice Test" and "which Attempt" are that epic's facts, not this one's — and a non-null default of `''` keeps the slot's unique index total, where a nullable column would let two rows silently occupy one slot.

## Verification

**Commands:**
- `docker compose up -d postgres` -- expected: healthy container
- `pnpm --filter api exec prisma migrate dev --name add_uncommitted_state` -- expected: one new migration directory, schema applied
- `pnpm run typecheck` -- expected: clean
- `pnpm run lint` -- expected: clean, or the pre-existing "eslint not installed" gap unchanged (recorded in Story 1.1; not a regression to fix here)
- `pnpm run test` -- expected: all unit + integration specs pass, including `uncommitted-state-policy.spec.ts`, `uncommitted-state.int-spec.ts` and the extended `parent-api.spec.ts`
- `pnpm run build` then `pnpm run e2e` -- expected: `parent-uncommitted-state.spec.ts` passes alongside the existing suites. `pnpm run e2e` does not go through turbo, so the build must run first or it tests a stale `apps/api/dist`.
- `pnpm prettier --write .` -- expected: no unformatted files remain

**Manual checks (if no CLI):**
- `git grep -n "localStorage\|sessionStorage\|indexedDB" apps/web/src/lib/parent-api.ts` -- expected: no matches.
- `git grep -n "72\|259200" apps/api/src --  ':!*uncommitted-state-policy.ts'` -- expected: no second statement of the TTL.

## Auto Run Result

Fresh follow-up review pass over the existing `done` implementation (no new feature work; see `## Review Triage Log` above for this pass's findings and the implementation pass's).

**Summary of implemented change (this pass):** Reviewed the diff against baseline `35ebdb6502f28ed14309938043c5a47b192cac37` with four parallel reviewers (blind hunter, edge-case hunter, verification-gap, intent-alignment). Found and patched two real races in `UncommittedStateService.save()`; everything else raised was by-design, already tracked, out of scope for the mechanism-only story, or not exploitable.

**Files changed with one-line descriptions:**
- `apps/api/src/identity/uncommitted-state.service.ts` -- `save()`'s unique-violation retry is now a bounded loop (`SLOT_WRITE_MAX_ATTEMPTS = 3`) instead of one retry, and a foreign-key violation from the profile being removed between the check and the write now answers `PROFILE_NOT_FOUND` (404) instead of a bare 500.
- `apps/api/src/identity/uncommitted-state.service.spec.ts` -- added a deterministic test for the bounded-retry exhaustion path and one for the foreign-key-to-404 path.

**Review findings breakdown:** patches applied: 2 (medium 1, low 1); items deferred: 0; items rejected: 11.

**Follow-up review recommendation:** `false`. This pass's patched findings only: no high severity; `3 x 1 medium + 1 x 1 low = 4`, below the 5 threshold.

**Verification performed:**
- `pnpm run typecheck` -- clean.
- `pnpm run lint` -- `eslint` not installed (pre-existing gap from Story 1.1, unchanged; not a regression).
- `pnpm --filter api exec vitest run` -- 27 files, 368 tests, all passed, including the two new unit cases and the full `uncommitted-state.int-spec.ts` integration suite against real Postgres.
- Web and e2e suites not re-run this pass: no file under `apps/web` or `e2e/` was touched.

**Residual risks:** The 11 rejected findings included some real but low-probability or already-acknowledged tradeoffs: `REQUEST_BODY_LIMIT_BYTES` is a hard-coded restatement of Express's default body limit that would go stale if that default ever changed (currently verified correct); the unbounded per-account slot count is already tracked as a deferred item from the implementation pass. Neither met the bar for a new patch or deferred entry this pass.

