---
title: 'Story 9.1: Account Tier Assignment Data Model & Effect'
type: 'feature'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
baseline_revision: '19009463710df4b46cd6240962281d0747a7de5a'
deferred:
  - summary: >-
      Nothing pins the new claim that `studentProfileLimit` is the tier's limit
      only and never moves with the account's live Student Profile count.
    evidence: |-
      `AccountConsumption.studentProfileLimit` is derived solely from
      `limitsFor(account.tier)`, so the property holds by construction today,
      but no test creates a Student Profile and asserts the reported limit is
      unchanged. A future change that folded a count into this field would ship
      green. Cheap to close, but it needs a Grade Level and Student Profile
      fixture in a spec file that has neither, and Story 9.2 will own the
      profile-count read anyway.
    location: >-
      apps/api/src/allowance/allowance.service.ts:24
    severity: low
  - summary: >-
      `studentProfileLimit`'s "limit only, never a live count" distinction
      lives only in a comment, not in the type system.
    evidence: |-
      `AccountConsumption.studentProfileLimit` is typed `number | null` --
      identical to a shape a live count would have. A future caller reading
      the field's type alone has no signal it can't be decremented or
      compared as a running count; only the comment says so.
    location: >-
      apps/api/src/allowance/allowance.service.ts:24
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Account Tier data model, its `Free` default and the Admin-only assignment path all landed with Story 2.2, but the story's three acceptance criteria are only observable at the Admin surface and at the `identity` service seam — nothing pins them at the outermost surface a tier actually originates from, the parent sign-up endpoint, so a sign-up that forwarded a client-supplied `tier` (or a schema default that drifted) would ship green.

**Approach:** Close the gap at the surface the intent names — account creation — by asserting, through `POST /api/parent/auth/sign-up`, that a real sign-up lands `Free` with the Free tier table's four figures behind it, and that a sign-up body carrying a `tier` field is refused with nothing written. Correct the one stale claim in `allowance` that says no Student Profile count exists yet. Add no new runtime behaviour: enforcement of every cap is Stories 9.2–9.6.

## Boundaries & Constraints

**Always:**
- Every tier figure is read from `src/allowance/tiers.ts` (itself transcription-tested against `tiers.md`). No test, copy string, DTO, migration or component restates a number.
- The only path that changes a tier stays `PATCH /api/admin/parent-accounts/:id/tier`, audited in the same transaction as the write.
- `identity` stays the sole writer of `parent_account` (AD-17); `allowance` keeps owning no entity and writing nothing.
- Allowance usage stays derived — no counter column, no period column, no reset job (AD-14).
- A refused sign-up writes no `parent_account`, `account_timezone` or `account_consent` row.

**Block If:** nothing. The intent is a data model that already exists plus its surface-level proof; no product decision is open.

**Never:**
- Never add enforcement: no cap check, no hard block, no profile-count check anywhere. Stories 9.2 (profile limit), 9.3–9.5 (three allowances) and 9.6 (surface + reset) own that.
- Never add a parent-facing tier or allowance read — that is Story 9.6's surface.
- Never add a self-serve tier path, and never widen `SignUpDto`.
- Never remove the `tier?` input on `ParentAccountService.create`: seeds, fixtures and the Admin-assignment integration cases create non-Free accounts through it, and no HTTP surface reaches it.
- Never restate a tier figure as a literal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-up defaults to Free | Valid sign-up body, no tier field | 201 with a session cookie; the stored account reads `tier: 'Free'`, and its Admin consumption payload reads the Free row's profile limit and three caps | No error expected |
| Self-serve tier attempt | Valid sign-up body plus `tier: 'Internal'` | 400 from the global validation pipe before any transaction opens; no account, timezone or consent row exists for that email | Rejected by `forbidNonWhitelisted`; the tier never reaches `create` |
| Admin assignment still the one write path | Signed-up Free account, admin token, `{ tier: 'Plus' }` | 200, tier is `Plus`, exactly one `parentAccount.tierChange` audit row | Existing coverage; not re-asserted here |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:109-127` -- `enum AccountTier` (`Free|Plus|Family|Internal`) and `ParentAccount.tier AccountTier @default(Free)`. The DB-level default is real: `prisma/migrations/20260923035131_add_identity_parent_account/migration.sql:9` emits `"tier" "account_tier" NOT NULL DEFAULT 'Free'`. Read-only for this story.
- `apps/api/src/allowance/tiers.ts` -- the one transcription of the tier table; `limitsFor(tier)` returns `{ studentProfiles, upload, generation, explanation }` with `null` for unlimited. Read-only; read every expected figure from here.
- `apps/api/src/allowance/tiers.spec.ts` -- parses `_bmad-output/specs/spec-n-test-reviewer/tiers.md` and compares row for row, so AC3's "the tier table" is already pinned against its source. No change.
- `apps/api/src/allowance/allowance.service.ts:24` -- **stale comment** on `studentProfileLimit`: "No profile count exists yet (Epic 1)". Epic 1 shipped `StudentProfile`; the limit is unenforced (Story 9.2), which is a different statement. One-line comment fix, no behaviour change. `consumptionFor` (line 174) already derives tier + `studentProfileLimit` + the three caps from `limitsFor`, which is AC3's effect.
- `apps/api/src/identity/parent-account.service.ts:178-240` -- `setTier(tx, …)` (the only tier write, called only by `admin`) and `create({ tier?, … })`, whose comment already states `tier` is left to the schema default unless a caller states one. Read-only.
- `apps/api/src/identity/parent-auth.service.ts:138-157` -- sign-up calls `accounts.create({ email, timezone, effectiveFrom, passwordHash, consent })` and passes **no** `tier`. This is the invariant the new tests pin.
- `apps/api/src/identity/dto/sign-up.dto.ts` -- five whitelisted fields, no `tier`. With `app-setup.ts:22`'s `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` an extra `tier` key is a 400 before the handler runs.
- `apps/api/src/admin/parent-account.controller.ts:33-40` + `apps/api/src/admin/parent-account-admin.service.ts:53-73` -- the only tier write surface, audited in one transaction. Read-only.
- `apps/api/test/parent-auth.int-spec.ts:29-37` -- `signUpBody(overrides)` helper plus the sign-up block (`it('creates the account, its first timezone entry and its consent row in one go')` at line 82, and the write-nothing cases at 131/143/151/159 which show the established "writes nothing" assertion idiom). **Where both new tests go.**
- `apps/api/test/harness.ts` -- `createHarness` (upserts the operator and sets `h.operatorId`), `resetParentAccounts`, `adminToken(jwt, operatorId)`, `h.identity`, `h.prisma`, `h.jwt`. Already imported by `parent-auth.int-spec.ts`; `adminToken` and the operator id are not yet — see Design Notes for how the Free-caps assertion reaches the Admin read.
- `apps/api/test/parent-account.int-spec.ts:110-205, 254-384` -- existing coverage that must not be duplicated: service-level `Free` default, per-tier caps and profile limits, assignment + audit, and 401 for a parent-style token and for no token on the tier route. AC2's "never self-serve" is already proven there for the Admin route; the new work is the sign-up surface only.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/allowance/allowance.service.ts` -- replace the `studentProfileLimit` comment "No profile count exists yet (Epic 1)" with one stating it is the tier's limit and that enforcing it against the live profile count is Story 9.2 -- the old claim is false since Epic 1 and misdirects the next reader of this field.
- `apps/api/test/parent-auth.int-spec.ts` -- add two cases to the sign-up block: (1) a valid sign-up stores `tier: 'Free'` and its Admin consumption payload reports the Free row's `studentProfiles`, `upload`, `generation` and `explanation` figures read from `limitsFor('Free')`; (2) a sign-up body with an extra `tier: 'Internal'` is refused 400 and leaves no `parent_account`, `account_timezone` or `account_consent` row for that email -- the story's ACs are about account creation, and this is the only surface that creates an account.

**Acceptance Criteria:**
- Given a clean database, when a parent signs up over HTTP with a valid body, then the created account's tier is `Free` and its four entitlement figures equal the Free row of the one tier table, with no figure restated as a literal in the test.
- Given a sign-up body that also carries a `tier` field, when it is posted, then the request is refused with 400 and no account, timezone or consent row exists for that email afterwards.
- Given the whole API suite, when it runs, then no new cap check, hard block, counter column, period column or reset job has been introduced, and the Admin tier route remains the only surface that writes a tier.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 13: (high 0, medium 2, low 11)
- addressed_findings:
  - `[low]` `[patch]` The tier-refusal test proved its 400 by status code alone, so an unrelated validation failure (a changed password bound, a broken email rule) would have passed it. It now asserts the validation message names the rejected `tier` property.
  - `[low]` `[patch]` Nothing asserted that a refused self-serve tier attempt signs nobody in. It now asserts the 400 response carries no parent session cookie, via the existing `sessionCookieFrom` helper.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1: (high 0, medium 0, low 1)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - none

## Design Notes

**Why this story is mostly tests.** Story 2.2 built the tier column, the `Free` default, the Admin-only assignment path with its audit row, the frozen tier table and the transcription test against `tiers.md`. AC1 ("account creation defaults to Free") is currently asserted through `createParentAccount(h.identity, …)` — a service call — and AC2 ("only via Admin assignment") through the Admin route's own guard cases. Neither touches the endpoint a real account is born at. That is the surface the acceptance criteria observe, so that is where the proof belongs; anything more would be Story 9.2–9.6 work landing early.

**Reading the Free caps through the Admin detail route** keeps the assertion at a surface rather than at `AllowanceService`, and reuses the payload Story 2.2 already ships. Shape, following the file's existing idiom:

```ts
const signUp = await server().post('/api/parent/auth/sign-up').send(signUpBody()).expect(201);
const stored = await h.prisma.parentAccount.findUniqueOrThrow({ where: { email: 'ada@example.test' } });
expect(stored.tier).toBe('Free');

const token = await adminToken(h.jwt, h.operatorId);
const { body } = await server().get(`/api/admin/parent-accounts/${stored.id}`).set({ authorization: `Bearer ${token}` }).expect(200);
const free = limitsFor('Free');
expect(body.consumption.studentProfileLimit).toBe(free.studentProfiles);
expect(body.consumption.allowances).toEqual({
  upload: { used: 0, limit: free.upload },
  generation: { used: 0, limit: free.generation },
  explanation: { used: 0, limit: free.explanation },
});
```

`h.operatorId` is the upserted operator row `createHarness` already provides, and `adminToken` is the same minting helper `parent-account.int-spec.ts` uses — no second idiom.

**The refusal test asserts absence three ways** (`parentAccount`, `accountTimezone`, `accountConsent` counts for that email are zero), matching the existing "rejects a stale consent version and writes nothing" case — a 400 that had already opened the transaction would otherwise pass on the status code alone.

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass, including the two new sign-up cases. Needs Postgres (`pnpm db:up`), per the known api-tier constraint that unit and integration specs share one vitest project.
- `pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --check .` -- expected: no unformatted files. (`pnpm lint` is known-broken repo-wide: `Command "eslint" not found`.)

## Auto Run Result

**Summary:** Pinned Story 2.2's Account Tier data model at the surface a tier actually originates from — the parent sign-up endpoint — with two new integration tests, and corrected a stale comment in `allowance.service.ts`. No runtime behaviour added.

**Files changed:**
- `apps/api/src/allowance/allowance.service.ts` -- comment fix: `studentProfileLimit` is the tier's limit only, never a live count; enforcing it is Story 9.2.
- `apps/api/test/parent-auth.int-spec.ts` -- two new cases: a real sign-up lands `Free` with the Free row's four figures behind it (read via the Admin consumption payload); a sign-up body carrying `tier` is refused 400 with no `parent_account`, `account_timezone` or `account_consent` row for that email.
- `_bmad-output/implementation-artifacts/epic-9-context.md` -- new, compiled epic context cache (step-01 context-strategy artifact, not story content).

**Review findings breakdown (this pass):** 0 patched, 1 deferred (low), 12 rejected (low). See `## Review Triage Log` for both this pass and the prior pass (2 patched then).

**Follow-up review recommendation:** `false`. This pass triaged 0 patch findings, so the score is 0 (no high-severity patch, `3×0 + 1×0 = 0` < 5).

**Verification performed:**
- `pnpm --filter api exec vitest run parent-auth.int-spec.ts` -- 32 passed, including both new sign-up cases.
- `pnpm typecheck` -- clean (cache hit, both packages).
- `pnpm exec prettier --check .` -- clean.

**Residual risks:** None caused by this story. The one deferred item (`studentProfileLimit`'s limit-only/never-a-count distinction living only in a comment) is a pre-existing design choice, not a defect introduced here.

