---
title: 'Story 9.2: Student Profile Limit Enforcement'
type: 'feature'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
baseline_revision: '7a94b63c958dd5e7a11cecd120679042e1fefa2d'
deferred:
  - summary: >-
      `restore` establishes ownership outside the transaction it now writes in,
      so a concurrent archive or delete makes its `updateMany` a silent no-op
      that still answers 204.
    evidence: |-
      `requireOwned` runs on `this.prisma`; the headroom guard and the
      `updateMany` then run inside `$transaction`. Between the two, a delete or
      an archive from another request leaves `updated.count === 0`, and `restore`
      returns void regardless, so the caller is told the child is active again
      when nothing was written. The shape predates this story -- `restore` was a
      bare `updateMany` with the same read before it -- but the new transaction
      was the natural place to have closed it.
    location: >-
      apps/api/src/identity/student-profile.service.ts:390
    severity: low
  - summary: >-
      Fixtures name tiers as literals (`'Plus'`, `'Family'`) across ten spec
      files while `tierAllowingProfiles` already derives the right tier from
      `TIER_LIMITS`, but is private to the harness.
    evidence: |-
      A recalibration that dropped `Plus.studentProfiles` to 1 -- which the epic
      schedules for after the first month of real accounts -- would redden a
      dozen suites that have nothing to do with tiers. Exporting the helper and
      having those fixtures ask for "a tier that allows N" would keep the one
      figures table authoritative. Not done now because it is a mechanical edit
      across ten files whose failure mode is a loud red test, not silent drift.
    location: >-
      apps/api/test/harness.ts:587
    severity: low
  - summary: >-
      The two-concurrent-creates case cannot fail deterministically: if the
      requests happen to serialise, `[201, 409]` holds even with the row lock
      removed.
    evidence: |-
      `Promise.all` over two supertest requests gives no guarantee the two
      database transactions overlap. The case is correct when it races and is
      worth keeping, but it is a weaker guard on `findByIdForUpdate` than its
      comment reads as. A deterministic version needs an injected barrier
      between the count and the insert.
    location: >-
      apps/api/test/student-profile.int-spec.ts:421
    severity: low
  - summary: >-
      `create` and `restore` use `prisma.$transaction` where the rest of the
      codebase uses `prisma.withTransaction`, which is also the only place a
      transaction timeout can be set -- and both now block on a row lock.
    evidence: |-
      `admin`, `deletion`, `grading`, `practicetest` and `sourcetest` all go
      through `withTransaction`. With `SELECT ... FOR UPDATE` on the account row,
      Prisma's default 5s interactive-transaction budget (P2028) becomes a
      reachable failure mode that nothing handles or documents. `create` already
      used `$transaction` before this story, so the idiom drift is pre-existing;
      the lock is what makes the timeout matter.
    location: >-
      apps/api/src/identity/student-profile.service.ts:184
    severity: low
  - summary: >-
      `apps/api/test/practice-test.int-spec.ts` is flaky at baseline: a full-file
      run fails 0-6 tests with 404s and 401s raised inside its fixtures, and the
      failing set never repeats.
    evidence: |-
      Measured at `7a94b63` with this story's changes stashed: one full-file run
      passed 202/202, a second failed 2 ("credits nothing to a value that merely
      starts with the right digits", "answers the one shared 404 for a foreign
      Attempt"). With this story applied: one full-suite run passed 1699/1699,
      later full-file runs failed 3 and 5, always inside `setPinFor`, `elevate`,
      `checkLegibility` or an enqueue -- never on a `ConflictException` and never
      in a cap assertion. Every spec this story touched passes; the flake is a
      pre-existing fixture/teardown race in that one file.
    location: >-
      apps/api/test/practice-test.int-spec.ts
    severity: medium
  - summary: >-
      The Students screen's refused-create wiring is still not revert-detectable:
      re-inlining `cause.message` in `onCreate` orphans a tested rule but leaves
      the web suite green.
    evidence: |-
      `createRefusal` is now exported and asserted, which pins the decision
      itself, but `page.spec.tsx` is a node-env file with `renderToStaticMarkup`
      only and no `@testing-library`, so nothing can invoke `onCreate`. Closing
      the gap means introducing a DOM test environment to that file, which is a
      larger change than this story. The user-visible half of the story is
      therefore guarded by a rule plus a reading of one call site.
    location: >-
      apps/web/src/app/parent/students/page.tsx:358
    severity: medium
  - summary: >-
      `create` locks `parent_account` and then inserts `student_profile`, while
      account deletion walks the rows inward-out and reaches `parent_account`
      last -- opposite lock orders on the same two tables.
    evidence: |-
      `account-deletion.service.ts` takes no explicit lock on the account row, so
      the orders differ rather than conflict by design. Postgres would detect the
      cycle and abort one transaction (40P01), which surfaces as a 500 on one of
      the two requests. It needs the same parent to be creating a child and
      deleting their account at the same instant, so it is remote, but nothing
      documents the ordering either way.
    location: >-
      apps/api/src/deletion/account-deletion.service.ts:150
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Account Tier carries a Student Profile limit (`limitsFor(tier).studentProfiles`) that nothing reads. `StudentProfileService` says so in its own class comment — "Nothing here enforces an Account-Tier cap: that is Epic 9 (FR-31)" — so a Free account can create unlimited children today, and FR-3's "active-profile count is bounded by Account Tier" is false.

**Approach:** Enforce the bound inside `identity`, at every path that raises the account's **active** profile count — `create` and `restore` — with the account row locked for the transaction that writes, so the check and the write cannot be raced apart. Refuse with a 409 whose sentence names the tier and the limit, written once in `student-profile-policy.ts`, and let the parent screen show the server's own sentence instead of its generic one.

## Boundaries & Constraints

**Always:**
- Every figure is read from `src/allowance/tiers.ts` via `limitsFor`. No test, copy string, DTO or component restates a number, and the web app names no tier — the sentence originates in the API, exactly as `NO_GENERATION_ALLOWANCE` does.
- `studentProfiles: null` (Internal) is unlimited and never a sentinel: no count is even taken.
- The bound is on **active** profiles (`archivedAt: null`), per FR-3. An archived child does not occupy a slot.
- The cap check, the active count and the write share **one transaction**, with `ParentAccountService.findByIdForUpdate(tx, id)` holding the account row — so two concurrent creates serialise, and a concurrent Admin tier change cannot interleave.
- A refusal writes nothing and deletes nothing. An account over its limit after a downgrade keeps every profile.
- `identity` stays the sole writer and reader of `student_profile` (AD-17); `allowance` keeps owning no entity and is reached only through the pure `tiers.ts` module — never by injecting `AllowanceService`, which would close a cycle.
- Fixture accounts that legitimately need more than one active profile get an explicit tier with headroom. The cap is never weakened, disabled in test, or bypassed by writing through a Prisma delegate.

**Block If:** nothing.

**Never:**
- Never add a parent-facing tier, limit or counter **read** — that is Story 9.6's Allowances surface. The parent learns the limit only by meeting it.
- Never gate `update` (rename / Grade-Level change) or `archive`: neither raises the active count.
- Never delete, archive or otherwise touch a profile because a tier moved below the count.
- Never enforce the three monthly allowances here (Stories 9.3–9.5), and never add a counter column, period column or reset job (AD-14).
- Never surface an allowance or tier figure on a student-scoped endpoint (AD-26).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under the limit | Free account, 0 active profiles, `POST /api/parent/students` | 201, the profile is created | No error expected |
| At the limit | Free account, 1 active profile, same POST | 409 whose message is `cannotAddStudentProfile('Free', 1)`; the account still has exactly 1 profile | `ConflictException` from the service, inside the transaction |
| Archived does not occupy a slot | Free account, 1 archived profile, 0 active, same POST | 201 — the archived child keeps its history and its row | No error expected |
| Downgraded below the count | Family account with 3 active profiles, Admin sets `Free`, same POST | 409 naming `Free` and `1`; all 3 profiles still exist and none is archived | As above |
| Restore would exceed | Free account, 1 active + 1 archived, `POST /api/parent/students/:id/restore` | 409 whose message is `cannotRestoreStudentProfile('Free', 1)`; the profile stays archived with its original instant | As above |
| Unlimited tier | Internal account, several active profiles, same POST | 201 every time; no limit is consulted | No error expected |
| The parent reads the reason | The 409 above reaching `apps/web` `onCreate` | The screen's alert shows the server's sentence, not `students.failed` | `refusalText` |

</intent-contract>

## Code Map

- `apps/api/src/identity/student-profile.service.ts:44-59` -- the class comment ending "Nothing here enforces an Account-Tier cap: that is Epic 9 (FR-31)" — **the claim this story makes false**; rewrite it. `create` (line 150) already opens a `$transaction` and counts active profiles *after* the insert to compute `isFirst`; the guard goes in the same transaction, before the insert, and `isFirst` becomes `activeBefore === 0`. `restore` (line 224) is a bare `updateMany` and needs the same transaction. `update` (175), `archive` (212), `removeOwned` (254), `removeAllOwned` (276), `countOwned` (289) are untouched — none raises the active count.
- `apps/api/src/identity/parent-account.service.ts:132-151` -- `findByIdForUpdate(tx, id)`: `SELECT … FOR UPDATE` on `parent_account`, already used by the Admin tier change for exactly this reason (READ COMMITTED would let two transactions read the same tier). **Reuse it; write no second row-lock idiom.** `ParentAccountService` and `StudentProfileService` are both providers of `IdentityModule` (`identity.module.ts:52-63`), so injecting it is intra-module and closes no cycle.
- `apps/api/src/allowance/tiers.ts` -- `limitsFor(tier).studentProfiles`, `null` for Internal. Pure module, no Nest dependency; `explanation-payload.spec.ts:3` already imports it across modules. Read-only.
- `apps/api/src/identity/student-profile-policy.ts` -- the file that holds every shape rule and its sentence (`NAME_SHAPE`, `NOTHING_TO_CHANGE`). **Where both new sentences go.** Currently import-free; an `import type { AccountTier }` is type-only and adds no runtime edge.
- `apps/api/src/practicetest/practice-test-policy.ts:196-203` + `apps/api/src/explanation/explanation-policy.ts:29` -- the established at-cap idiom: one sentence per refusal, in the owning module's policy file, thrown as `ConflictException`. Model the two new sentences on these. Note neither names a tier, because both are read by a **student**; this story's reader is a parent and its AC requires the tier named.
- `apps/web/src/lib/parent-api.ts:1098-1114, 1153-1200` -- 409 is the status the API refuses on a rule with; its body `message` is carried as `ParentApiError.reason`. `messageFor` has no 409 arm, so `error.message` is the caller's generic fallback — which is why `onCreate` must read `reason`.
- `apps/web/src/app/parent/students/page.tsx:335-356` -- `onCreate`'s catch does `setError(cause instanceof Error ? cause.message : …)` and so **drops the server's sentence**. `write()` (line 232) already does the right thing via `refusalText` (line 253), so archive/restore/delete refusals already surface; `refusalText` is imported and re-exported at lines 35/67. Alert at line 375 is `role="alert"` — announced already, no new live region.
- `apps/web/src/app/parent/students/page.spec.tsx:212-236` -- the `describe('what a refused delete puts on the screen')` block: this file is `node`-env with `renderToStaticMarkup` only (no `@testing-library`), so refusal wiring is pinned by testing the rule function. Add the create counterpart in that idiom.
- `apps/api/test/harness.ts:461-482` (`createParentAccount`, already takes `tier`), `546-557` (`createStudentProfile` -> `h.students.create`, so **every fixture profile now goes through the cap**), `605-641` (`createCredentialedParent` / `createSignedInParent`, which sign up and therefore land `Free`). `h.identity` is `ParentAccountService`, `h.prisma` is available: a tier bump is `h.prisma.$transaction((tx) => h.identity.setTier(tx, id, tier))`.
- `apps/api/test/student-profile.int-spec.ts:115-215` -- the Create block and its idioms: `elevatedParent()`, `messagesOf(response)`, "writes nothing" assertions via `studentProfile.count()`. **Where the new HTTP cases go.**
- Fixtures that create a second active profile under one account and therefore need headroom: `analytics:83,86` · `explanation-suppression:97,100` · `grade-dispute:104,107` · `parent-explanation-review:89,92` · `student-explanation-flag:94,97` · `weak-area:58,311` · `uncommitted-state:327,354,385,388` · `student-mode:167,171,215,219` (plus its HTTP second-create cases) · `practice-test:133,3099,3552,3763,3945,5315,5652,5688` · `student-profile-deletion:137,574` · `source-test:116,884`. Treat the list as a starting map, not a contract: the suite is the authority on which accounts actually need it.
- `apps/api/test/parent-account.int-spec.ts:146,189-190,205` -- the existing `studentProfileLimit` assertions (Free, per-tier, Internal-null), all read through `limitsFor`. **Closes DW-282** (which names Story 9.2 as its owner): this story has the Grade Level and profile fixtures that spec file lacked.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/identity/student-profile-policy.ts` -- add `cannotAddStudentProfile(tier, limit)` and `cannotRestoreStudentProfile(tier, limit)`, sharing one private head that states the tier and the limit (singular/plural on the limit) and differing only in the action their tail names. Both sentences live here for the reason `NAME_SHAPE` does: a refusal written at its throw site is a refusal the next edit rewords.
- `apps/api/src/identity/student-profile-policy.spec.ts` -- unit-cover both sentences: each names its tier and its limit read from `TIER_LIMITS` (never a literal), reads singular at 1 and plural above it, and names no figure other than the limit. Pin the typographic-apostrophe/one-sentence conventions only if the existing cases already do.
- `apps/api/src/identity/student-profile.service.ts` -- inject `ParentAccountService`; add one private guard that, given a transaction client and the account id, locks the account with `findByIdForUpdate`, returns immediately when `limitsFor(tier).studentProfiles` is `null`, counts `archivedAt: null` profiles in the same transaction and throws `ConflictException` with the caller's sentence when the count has reached the limit. Call it from `create` (before the insert; derive `isFirst` from the pre-insert count) and from `restore` (which becomes a transaction). Rewrite the class comment: the cap is enforced here now, and say which paths it does *not* gate and why.
- `apps/api/test/harness.ts` -- accept `tier?: AccountTier` on `createCredentialedParent` and `createSignedInParent`, applied after sign-up through `identity.setTier` in a transaction (the sign-up DTO refuses a `tier`, per Story 9.1), and export `setAccountTier(h, parentAccountId, tier)` for accounts already created. Document that a fixture asking for headroom is opting into a tier, not out of the cap.
- `apps/api/test/student-profile.int-spec.ts` -- add the I/O matrix's HTTP cases to the Create block, plus a Restore case: at-limit create, archived-slot-freed create, post-downgrade create with all profiles intact, at-limit restore leaving the profile archived, and unlimited-tier repeat creates. Assert each refusal's message against the exported sentence built from `limitsFor`, never a regex or a literal.
- `apps/api/test/*.int-spec.ts` (the fixtures mapped above) -- give each account that needs more than one active profile an explicit tier with headroom via the new `tier` option or `setAccountTier`. Change no assertion and weaken no cap; a spec that fails because its Free account wanted two children is the cap working.
- `apps/api/test/parent-account.int-spec.ts` -- closes DW-282: after creating a Student Profile on an account, the Admin consumption payload's `studentProfileLimit` still equals `limitsFor(tier).studentProfiles`, unmoved by the live count.
- `apps/web/src/app/parent/students/page.tsx` -- `onCreate`'s catch shows `refusalText(cause, parentCopy.students.failed)`, so the API's tier-and-limit sentence reaches the parent instead of "That change could not be saved."
- `apps/web/src/app/parent/students/page.spec.tsx` -- add a refused-create block mirroring the refused-delete one: a 409 carrying a reason renders that reason, a non-409 falls back, and the refusal does not end Parent View.

**Acceptance Criteria:**
- Given the whole API suite, when it runs, then no profile figure appears as a literal anywhere — every expected limit is read through `limitsFor` — and no cap is enforced or asserted outside `identity`.
- Given an account whose tier allows N active profiles and which already has N, when any path that would raise the active count is called over HTTP, then it is refused 409 with a sentence naming that tier and N, and the account's profile rows are byte-for-byte unchanged.
- Given two creates racing against the last free slot on one account, when both run, then exactly one succeeds and the other is refused — the account row lock, not an application-level clamp, is what makes that true.
- Given the parent screen, when a create is refused at the limit, then the alert shows the API's own sentence, and the web app still contains no tier name and no limit figure of its own.

## Spec Change Log

## Review Triage Log

### 2026-09-30 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 16: (high 0, medium 0, low 16)
- addressed_findings:
  - `[low]` `[patch]` `restore` had no test proving the Account-Tier cap is not consulted for an unlimited (`Internal`) tier — only `create` had that case. Added `consults no limit for an unlimited tier on restore either` in `apps/api/test/student-profile.int-spec.ts`, mirroring the existing `create` case: fills an Internal account past every capped tier's figure, archives all of them, restores all of them, and asserts every one lands active.

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 7: (high 0, medium 2, low 5)
- reject: 19: (high 0, medium 0, low 19)
- addressed_findings:
  - `[medium]` `[patch]` The one production line changed in `apps/web` was untested: the new spec block called the unchanged shared helpers `refusalText`/`endsParentView` directly, so reverting `onCreate`'s catch left the suite green. The catch's decision is now an exported rule, `createRefusal(cause)`, asserted for a 409 carrying a reason, a non-409 `Error` and a non-`Error` throw.
  - `[medium]` `[patch]` The refusal copy called the Account Tier a "plan", a noun the domain uses nowhere else. Both sentences now say "Account Tier", matching `apps/web/src/copy/admin.ts`.
  - `[low]` `[patch]` The web spec's fixture hardcoded the API's whole sentence — restating a tier name and a limit figure inside `apps/web`, which the spec's Always clause forbids — and compared the fixture against itself. It is now an opaque sentinel reason naming neither.
  - `[low]` `[patch]` `setAccountTier`'s docstring claimed it writes "exactly as the Admin tier change does"; it takes no row lock and writes no audit row. It now says plainly that it is a fixture-only tier write. `createStudentProfileWithHeadroom` now warns that the account is left over its own limit, so a later plain create on it throws the tier's 409 and will read as an unrelated refusal.
  - `[low]` `[patch]` `student-profile.controller.ts` documented neither new refusal. `create` and `restore` now name the 409 at the Account Tier's active-profile limit.

## Design Notes

**Why `identity` and not `allowance`.** The Student Profile limit is not an allowance: nothing is charged, no period applies, and the figure it compares against is a live count of rows `identity` already owns. Reaching for `AllowanceService` would inject a module that depends on `identity` back into `identity` — a cycle bought for a number that `tiers.ts` hands over as a pure function. `allowance` keeps owning no entity and knows nothing about this check.

**Why the row lock rather than a re-count.** `explanation`'s charging seam documents a known gap: under READ COMMITTED two transactions read the same pre-charge usage, so its in-transaction re-count narrows the race without closing it. Here the race *can* be closed, because `findByIdForUpdate` already exists for the tier change and one account's profile creates are exactly what should serialise. Shape:

```ts
private async requireProfileHeadroom(
  tx: TransactionClient,
  parentAccountId: string,
  sentence: (tier: AccountTier, limit: number) => string,
): Promise<number> {
  const account = await this.accounts.findByIdForUpdate(tx, parentAccountId);
  const limit = limitsFor(account.tier).studentProfiles;
  const active = await tx.studentProfile.count({ where: { parentAccountId, archivedAt: null } });
  if (limit !== null && active >= limit) throw new ConflictException(sentence(account.tier, limit));
  return active;
}
```

`create` uses the returned count for `isFirst` (`active === 0`), which removes its post-insert count rather than adding a second query.

**Why `restore` is in scope though the AC names creation.** FR-3 states the bound as "active-profile count is bounded by Account Tier". Restoring an archived child raises that count, so leaving it ungated would make the invariant false through a route a parent can reach in two taps — a Free account with one active and one archived child would sit at two active. It is the same guard and the same transaction; the only difference is the tail of the sentence. Nothing is taken away: the profile stays archived and restorable once a slot is free.

**Why the fixtures change rather than the cap.** Every fixture profile is created through `h.students.create`, so the cap now applies to them, and a spec about page expiry or mastery that wants two children is a spec whose account needs a tier that allows two. Raising the tier states that in the test; a fixture that wrote around the service would state nothing and would quietly stop exercising the write path production uses.

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass, with the fixture tiers raised where needed. Needs Postgres (`pnpm db:up`); the api package runs unit and integration specs in one vitest project.
- `pnpm --filter web test` -- expected: the students-screen specs pass, including the refused-create cases.
- `pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --check .` -- expected: no unformatted files. (`pnpm lint` is known-broken repo-wide: `Command "eslint" not found`.)

## Auto Run Result

**Summary:** Follow-up review pass (fresh review of an already-`done` story, per dispatch). Enforces the Account Tier's active Student Profile limit at `create` and `restore`, inside one row-locked transaction (`ParentAccountService.findByIdForUpdate`), refusing with a 409 whose sentence names the tier and the limit; the parent screen now shows that sentence instead of its generic fallback. One coverage gap found and patched; every other finding was reject or duplicate of an already-logged deferred item.

**Files changed this pass:**
- `apps/api/test/student-profile.int-spec.ts` -- added one test: `consults no limit for an unlimited tier on restore either`, mirroring the existing `create`-side unlimited-tier case.

**Review findings breakdown:** patch 1 (low, applied), defer 0, reject 16 (see Review Triage Log above for the full breakdown across two review passes).

**Verification performed:**
- `pnpm exec vitest run test/student-profile.int-spec.ts` (apps/api) -- 37/37 passed, including the new case.
- `pnpm --filter api test` -- 1698-1700/1700 across two runs; the only failures were in `practice-test.int-spec.ts`, a different failing pair each run, matching this spec's own pre-existing baseline-flake deferred item exactly (never a cap assertion, never `student-profile.int-spec.ts` twice in a row). No cap-related test failed in either run.
- `pnpm --filter web test` -- 1430/1430 passed.
- `pnpm typecheck` -- clean.
- `pnpm exec prettier --check .` -- clean.

**Residual risks:** None new. The pre-existing `practice-test.int-spec.ts` full-suite flake (deferred, medium) remains open and unrelated to this story's code.

