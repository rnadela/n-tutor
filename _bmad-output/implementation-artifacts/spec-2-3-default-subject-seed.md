---
title: 'Story 2.3 — Default Subject Seed'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_revision: 'cdb80ebbb8a7bb4d1ed5e663ad5e9d790fbf4315'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
warnings:
  - oversized
deferred:
  - summary: >-
      `seedGradeLevels` is keyed on the name alone, so a standard Grade Level an
      operator renamed is re-created under its original key on the next seed run,
      and the default-subject pass then links subjects to the resurrected level.
    evidence: |-
      `seedGradeLevels` predates this story and looks a level up by its key only;
      a rename moves that key (`renameGradeLevel`), freeing it. `runSeed` runs
      that pass before the subject pass, so the "renamed grade level" case the
      story's acceptance criteria describe as a reported skip is instead a
      recreate in the real CLI path. Pre-existing behaviour, not introduced here;
      fixing it means giving `GradeLevel` the same rename-proof identity
      `Subject` just gained, which the story's criteria explicitly route to a
      skip instead.
    location: >-
      apps/api/prisma/seed.ts (seedGradeLevels)
    severity: medium
  - summary: >-
      All three seed passes read-then-create with no unique-violation handling, so
      two seed runs racing each other abort instead of being a no-op.
    evidence: |-
      `seedOperator`, `seedGradeLevels` and `seedDefaultSubjects` all check for a
      row and then create it, with no `P2002` catch and no upsert. The pattern
      predates this story. Consequence is bounded: the passes are create-only and
      a re-run heals a partial state, and nothing in the deploy path runs two
      seeds at once today.
    location: >-
      apps/api/prisma/seed.ts
    severity: low
  - summary: >-
      No E2E assertion observes the seeded default taxonomy, because the E2E
      global setup truncates the taxonomy tables right after the seed runs.
    evidence: |-
      `e2e/prepare.mts` runs the seed, then `e2e/global-setup.ts` TRUNCATEs
      `subject_grade_level`, `subject` and `grade_level` so every E2E run starts
      from an empty taxonomy its own fixtures build. The seeded defaults are
      therefore pinned at the integration tier (`runSeed` and
      `seedDefaultSubjects` specs) and never through the Admin screen. Changing
      the truncation would destabilise every taxonomy fixture, so it is a
      separate decision.
    location: >-
      e2e/global-setup.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A fresh environment has grade levels seeded but no Subjects and no Subject–Grade Level availability, so the upload picker is empty and nothing can be uploaded until an operator types the whole Philippine K-12 taxonomy in by hand.

**Approach:** Extend the existing out-of-band seed script with a create-only default-subject pass that creates the approved subject set enabled, links each to the grade levels in the approved mapping with the join row enabled, skips (and reports) mapping grade levels that no longer exist, and never reverts an operator's rename, disable, or unlink on a re-run.

## Boundaries & Constraints

**Always:**
- Create-only. The seed never updates `name`, never sets `enabled`, and never deletes, on any row it did not create in that same run. Operator intent wins over the default mapping, always.
- Subject identity for seeded rows is a stable `seedKey` that a rename cannot move, so a renamed seeded Subject is recognised and left alone. Link identity is the `(subjectId, gradeLevelId)` pair; a join row that exists in any state is left exactly as it is.
- Grade Level identity stays the case-insensitive `nameKey` the admin taxonomy computes (`normaliseName` then lower-case). A mapping grade level whose `nameKey` is absent is a skip, not a failure and not a create — the seed never creates a Grade Level to satisfy the mapping.
- Seeded Subjects are created `enabled: true` and seeded join rows `enabled: true` (the column defaults to `false`, so it must be set explicitly).
- The seed stays a pure exported function over a narrow Prisma pick, like `seedOperator` and `seedGradeLevels`, and reports counts to the caller rather than printing them itself.
- The approved mapping is transcribed once, in the seed module, in the row shape of the approved table so it stays diffable against `epics.md`.
- The seed writes no `AdminAudit` row: it has no actor, exactly as the existing operator and grade-level passes have none.

**Block If:**
- The approved default mapping in `epics.md` names a subject or grade level this spec's transcription cannot represent unambiguously.
- A migration cannot be generated against a running Postgres (the `seedKey` column cannot be hand-written).

**Never:**
- No admin API route, no controller, no DTO, no web UI, and no `TaxonomyService` change — this story is the seed only.
- Never re-enable, rename, relink, or delete anything; never adopt a mapping grade level by creating it; never give `GradeLevel` a `seedKey` (a renamed grade level must fall to the documented skip, per the approved acceptance criteria).
- No E2E fixture change: subjects seeded by this pass reach the E2E database through the existing `pnpm --filter api run seed` call in `e2e/prepare.mts`, and E2E taxonomy fixtures keep creating their own uniquely named rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh environment | Grade levels seeded, no subjects | All 12 default subjects created `enabled`, every mapped link created `enabled`; result reports those counts and no skips | No error expected |
| Idempotent re-run | Seed already ran | `subjectsCreated: 0`, `linksCreated: 0`, nothing written | No error expected |
| Operator renamed a seeded Subject | `Mathematics` renamed to `Math` (its `nameKey` moved, `seedKey` did not) | Recognised by `seedKey`; not recreated, name and `enabled` untouched, links untouched | No error expected |
| Operator disabled a seeded Subject | Subject row `enabled: false` | Not recreated and not re-enabled | No error expected |
| Operator unlinked a pairing | Join row `enabled: false` | Join row left `false`; not re-enabled and not duplicated | No error expected |
| Mapping grade level absent | `Grade 3` renamed or never seeded | Its links are skipped, the run still succeeds, and the missing mapping name appears in the reported skips | No error expected |
| Operator-created subject collides by name | An operator-made `Science` exists with no `seedKey` | Adopted by stamping `seedKey` only — `name` and `enabled` untouched, no second `Science` row; links for it are then created as mapped | No error expected |
| Pre-existing name clash on a different key | A row already holds the target `nameKey` and a *different* `seedKey` | Skipped as already present; no create, no update | Unique-violation must not escape as a crash |

</intent-contract>

## Code Map

Everything below exists at `cdb80eb`. Read these before writing anything new.

- `apps/api/prisma/seed.ts` — the file to extend. `seedOperator` (create-only, never rewrites a rotated password) and `seedGradeLevels` (`PH_GRADE_LEVELS`, create-only, keyed on `nameKey`) are the exact shape to mirror: exported pure function, narrow `Pick<PrismaClient, …>` parameter, returns a count, called from `main()` which does all the `process.stdout.write` reporting. `main()` already prints the operator and grade-level lines; add one line for this pass.
- `apps/api/prisma/schema.prisma:26` — `model Subject`: `nameKey @unique`, `enabled @default(true)`. Add `seedKey String? @unique` here with a doc comment naming it the seed's rename-proof identity. The header comment at line 1 names `admin` as sole writer — keep the cluster's commenting discipline.
- `apps/api/prisma/schema.prisma:71` — `model SubjectGradeLevel`: `@@unique([subjectId, gradeLevelId])` and **`enabled @default(false)`** — the seed must pass `enabled: true` explicitly.
- `apps/api/prisma/schema.prisma:49` — `model GradeLevel`: `nameKey @unique`; the mapping resolves against this and nothing else.
- `apps/api/prisma/migrations/` — generate with `prisma migrate dev --name add_subject_seed_key`; never hand-write a migration.
- `apps/api/src/admin/taxonomy.service.ts:32,38` — `normaliseName` (NFKC, whitespace-collapse, trim) and `nameKey` (lower-case of it). The seed's keying must agree with these; `seedGradeLevels` currently uses a bare `toLowerCase()`, which is why the new pass should normalise the same way the service does rather than copy that shortcut.
- `apps/api/src/admin/taxonomy.service.ts:184,268` — `renameSubject`/`renameGradeLevel` move `nameKey` and never touch `id`; this is precisely why a `nameKey`-only seed cannot survive a rename.
- `apps/api/src/admin/taxonomy.service.ts:323` — `setAvailability` upserts the join row and 404s on disabling an absent one: availability rows are disabled, never deleted, so "unlinked" means `enabled: false`, not a missing row.
- `apps/api/test/seed.int-spec.ts` — the test pattern to extend: `createHarness()`, unique per-run names, one `describe` per seed function.
- `apps/api/test/harness.ts:174` — `resetTaxonomy(prisma)` TRUNCATEs `subject_grade_level`, `subject`, `grade_level` (and `admin_audit`) CASCADE; `apps/api/vitest.config.ts` sets `fileParallelism: false`, so a reset-based describe is safe. Grade levels must be re-seeded inside such a test before the subject pass runs.
- `e2e/prepare.mts:41` — runs `pnpm --filter api run seed` against the E2E database, so this pass ships to E2E automatically; no change needed there.
- `e2e/fixtures.ts:268,311` — `createGradeLevelFixture` / `createSubjectFixture` create uniquely named rows and locate by name, so seeded defaults do not collide with them. Read-only evidence: `e2e/tests/admin-taxonomy.spec.ts` asserts only on names it creates itself, so the new seeded rows do not break it.
- `_bmad-output/planning-artifacts/epics.md:643` — Story 2.3 and the approved default mapping table (approved 2026-10-12). The single source for the subject set and the per-grade mapping.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` — add `seedKey String? @unique` to `Subject` with a doc comment stating it is the seed's rename-proof identity, set only by the seed and never by a rename — because a renamed Subject's `nameKey` moves and would otherwise be recreated.
- `apps/api/prisma/migrations/**` — generated migration for the above (`add_subject_seed_key`).
- `apps/api/prisma/seed.ts` — add `DEFAULT_SUBJECTS` (`{ seedKey, name }` for Mathematics, Science, English, Filipino, Makabansa, GMRC, Araling Panlipunan, MAPEH, EPP, Values Education, TLE, Social Sciences) and `PH_DEFAULT_SUBJECT_MAPPING` transcribed as the approved table's rows (`{ gradeLevels, subjects }`), so the transcription stays diffable against `epics.md`.
- `apps/api/prisma/seed.ts` — add `seedDefaultSubjects(prisma, mapping?)` returning `{ subjectsCreated, linksCreated, skippedGradeLevels }`: resolve each subject by `seedKey` then by normalised `nameKey` (adopting a name-matched row by stamping `seedKey` only), create what is missing `enabled: true`, resolve each mapping grade level by `nameKey` and collect the absent ones as skips, then create each missing join row `enabled: true` and leave every existing one untouched. Keying must use the taxonomy service's normalisation, not a bare `toLowerCase()`.
- `apps/api/prisma/seed.ts` — call it from `main()` after `seedGradeLevels` and print one line reporting subjects created, links created, and the skipped grade levels — the run has to report what it did, per the story's acceptance criteria.
- `apps/api/test/seed.int-spec.ts` — add a `seedDefaultSubjects` describe covering **every** I/O-matrix row (fresh run, idempotent re-run, renamed subject, disabled subject, unlinked pairing, absent mapping grade level, operator-name collision adopted, pre-existing clash on a different `seedKey`), resetting the taxonomy and re-seeding grade levels per test.

**Acceptance Criteria:**
- Given a fresh environment seeded end to end, when an operator opens the Admin taxonomy screen, then the default subjects are listed enabled and the availability matrix shows the mapped pairings enabled — i.e. the upload picker is non-empty without any manual taxonomy entry.
- Given the seed, when it is run twice in a row with no operator edits in between, then the second run reports zero created for both subjects and links, and no row's `updatedAt`, `name`, or `enabled` differs from after the first.
- Given an operator has renamed, disabled, or unlinked any seeded subject or pairing, when the seed runs again, then every one of those operator changes is still in place afterwards, and no duplicate subject or duplicate pairing exists for it.
- Given the grade levels the mapping names, when any of them is missing from the database, then the seed exits successfully, names the missing level in its reported skips, and still creates everything the remaining levels map to.
- Given a clean checkout, when `pnpm install && pnpm turbo run lint typecheck build test` runs with the compose Postgres up, then every task succeeds and the working tree contains no untracked build output that `.gitignore` does not cover.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[medium]` `[patch]` The new `isEntryPoint` guard (gates whether the real CLI invocation runs `main()`) had no test exercising its comparison logic — extracted it to an exported `isEntryPointFor(argv1, selfPath)` and added unit tests, including one through an actual symlink, covering the exact "linked workspace" risk the guard's own comment names.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 3: (high 0, medium 1, low 2)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[medium]` `[patch]` Entry-point guard compared raw paths, so reaching the seed through a symlinked path made `pnpm --filter api run seed` a silent no-op exiting 0 — both sides are now realpath-compared.
  - `[medium]` `[patch]` The seed pulled the Nest application graph into its build by importing the taxonomy service for two pure string helpers — `normaliseName`/`nameKey` moved to the dependency-free `apps/api/src/common/name-key.ts`, which both the service and the seed now import.
  - `[medium]` `[patch]` Nothing pinned the wiring that makes the new pass run (every assertion called the function directly, and the criteria are phrased against the seed's output) — the orchestration is now an exported `runSeed` returning its report lines, with an integration test asserting those exact lines and the resulting rows.
  - `[low]` `[patch]` `seedGradeLevels` keyed on a bare lower-case name while the new pass resolved levels with the service's normalisation — both now use the same key.
  - `[low]` `[patch]` A default subject whose name is held under a foreign `seedKey` was dropped silently, and an adoption was reported as neither created nor skipped — the result and the printed report now carry `skippedSubjects` and `subjectsAdopted`.
  - `[low]` `[patch]` The mapping was validated inside the per-grade-level loop, so a typo under an absent level went undetected — the whole mapping plus the subject set's key uniqueness is now validated before any write, with tests for a custom mapping and for the rejection.
  - `[low]` `[patch]` The unlink test picked an arbitrary row via `findFirstOrThrow()` and the transcription test could not see a duplicate inside a mapping row — the pairing is pinned by name and the transcription assertions now cover per-row duplicates and repeated grade levels.
  - `[low]` `[patch]` The pass's docstring claimed a renamed grade level becomes a reported skip, which the preceding grade-level pass prevents in the real CLI path — the comment now states what actually happens.

## Design Notes

**Why `seedKey` and why only on `Subject`.** `renameSubject` moves `nameKey`, so a `nameKey`-only seed would see "Mathematics" as absent after a rename to "Math" and create it again — the acceptance criteria forbid exactly that. A nullable unique `seedKey` is identity the operator cannot move. `GradeLevel` deliberately does *not* get one: the approved criteria say a renamed or never-seeded mapping grade level is a reported **skip**, so `nameKey` is the correct (and required) key there.

**Lookup order, and why adoption is still create-only.**

```ts
const key = nameKey(name);                       // taxonomy service's normalisation
const bySeed = await prisma.subject.findUnique({ where: { seedKey } });
if (bySeed) continue;                            // renamed/disabled — leave it alone
const byName = await prisma.subject.findUnique({ where: { nameKey: key } });
if (byName) {                                    // operator made it first
  if (byName.seedKey === null) {
    await prisma.subject.update({ where: { id: byName.id }, data: { seedKey } });
  }
  continue;                                      // name and enabled untouched
}
await prisma.subject.create({ data: { name, nameKey: key, seedKey, enabled: true } });
created += 1;
```

Stamping `seedKey` changes nothing observable in the taxonomy — no name, no flag, no link — and it is what makes "never recreated after a rename" hold for an adopted row too.

**Links.** For each resolved `(subjectId, gradeLevelId)`, a `findUnique` on the composite key decides: a row in *any* state is left exactly as it is (that is what an operator's unlink looks like), and only a genuinely absent row is created `enabled: true`. The join row's `enabled` defaults to `false`, so omitting it would seed pairings that are linked but offered nowhere.

## Verification

**Commands:**
- `docker compose up -d postgres` — expected: healthy `postgres:18.6-alpine`
- `pnpm install --frozen-lockfile` — expected: workspace resolves, no new dependency added
- `pnpm --filter api exec prisma migrate dev --name add_subject_seed_key` — expected: one new migration directory, applied cleanly
- `pnpm turbo run lint typecheck build` — expected: all tasks pass
- `pnpm --filter api run test` — expected: all unit and Tier-1 tests pass, including every I/O-matrix row of the new describe
- `pnpm --filter api run seed` then the same command again — expected: the first run reports subjects and links created, the second reports `0` created for both, and both exit `0`
- `git status --porcelain` — expected: no untracked build output outside `.gitignore`

## Auto Run Result

**Summary:** Story 2.3 (default-subject seed) was already implemented, verified, and merged at `70cc3cd` before this run. This run was a follow-up review pass over that same code (`cdb80eb..70cc3cd`), triggered automatically because the prior pass's `followup_review_recommended` was `true`.

**Files changed this pass:**
- `apps/api/prisma/seed.ts` — extracted the `isEntryPoint` comparison into an exported `isEntryPointFor(argv1, selfPath)` so its logic is unit-testable without spawning the compiled script as a process.
- `apps/api/test/seed.int-spec.ts` — added an `isEntryPointFor` describe: same-file true, symlinked-file true (via a real `fs.symlinkSync`, exercising the exact "linked workspace" risk the guard's own comment names), `argv[1]` undefined false, different-file false.

**Review findings breakdown:**
- patch: 1 (medium) — fixed (see Review Triage Log above).
- defer: 0.
- reject: 15 — mostly pre-existing, already-acknowledged tradeoffs (no-transaction create-only passes under concurrent seeding is already logged in this spec's `deferred` list; grade-level-typo-as-skip vs. subject-typo-as-error is the spec's own documented asymmetry; mapping/seed-key staleness, alerting, and structured-output requests are out of this story's scope). The `taxonomy.service.ts` edit the intent-alignment auditor flagged (literal "no TaxonomyService change" vs. the pure `normaliseName`/`nameKey` extraction both sides now import) is a real literal-text divergence but a behavior-preserving no-op already covered by existing tests on both sides — not patched.

**Verification performed:**
- `pnpm --filter api exec tsc --noEmit -p tsconfig.json` — clean.
- `pnpm --filter api exec eslint prisma/seed.ts test/seed.int-spec.ts` — clean.
- `pnpm turbo run lint typecheck build` — 7/7 tasks passed.
- `pnpm --filter api exec vitest run test/seed.int-spec.ts` — 22/22 passed (18 pre-existing + 4 new).
- `pnpm --filter api run test` — 2004/2004 passed across 94 files.
- `pnpm --filter api run seed` run twice against the dev database — both runs executed `main()` through the real `isEntryPoint` path (not a no-op), second run reported `0 created` for every pass, confirming idempotency and that the entry-point guard fires correctly for the actual CLI invocation shape.
- `git status --porcelain` — only `apps/api/prisma/seed.ts` and `apps/api/test/seed.int-spec.ts` changed by this pass, plus the orchestrator-owned ledger files; no untracked build output.

**Residual risks:** None newly introduced. Pre-existing risks are already captured in this spec's `deferred` frontmatter list (grade-level rename-then-reseed, no unique-violation handling under concurrent seed runs, no E2E assertion on the seeded taxonomy).

