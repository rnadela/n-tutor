---
title: 'Story 7.3: Weak Area Identification'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: '8ad8738c59d5ad3b63e0a1f13e0270f47cb97efd'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      An override set to an empty string is silently ignored and the built-in default
      is applied instead of the operator's intended value.
    evidence: |-
      `requireIntEnv` treats `''` exactly as unset and returns its fallback, so
      `WEAK_AREA_ANSWERED_FLOOR=` in a deployment's environment reads as 5 with no
      warning. This is `env.ts`'s behaviour for every tunable in the system, not
      something this story introduced, and changing it would change PIN, rate-limit
      and uncommitted-state resolution at the same time.
    location: >-
      apps/api/src/common/env.ts (requireIntEnv)
    severity: low
  - summary: >-
      `masteryFor` reads every stored Topic for a profile with no cap and no cursor.
    evidence: |-
      `topic_mastery` holds one row per (profile, Topic) with evidence, and a child
      working across several Subjects over a school year accumulates them without
      bound. The read is small per row and outside any transaction, but nothing
      limits how many come back, and Story 7.4 renders the whole list. A cap needs a
      rule for which Topics a dashboard may omit, which this story has no basis to
      choose.
    location: >-
      apps/api/src/grading/grading.service.ts (masteryFor)
    severity: medium
  - summary: >-
      A Weak Area created retroactively by an ungraded batch resolving is
      indistinguishable from one created by new student work.
    evidence: |-
      `_bmad-output/specs/spec-n-test-reviewer/SPEC.md:114` records this as open.
      Deriving the verdict at read time settles it by omission: a Topic that crossed
      the threshold because `resolveUngraded` finally wrote verdicts for a paper sat
      weeks ago appears with no marker of that. It is a product decision about
      Story 7.4's presentation, not a defect in the predicate.
    location: >-
      _bmad-output/specs/spec-n-test-reviewer/SPEC.md:114
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 7.2 stores a Mastery figure per (Student Profile, Topic) but nothing decides which of those Topics is a Weak Area, and nothing can read a Mastery row at all — so Story 7.4's dashboard has no classified input and the two thresholds (below 60% Mastery, at least 5 answered Questions) exist only in prose.

**Approach:** One policy module states both figures as system-level configuration with env overrides resolved at boot, exposes the single `isWeakArea` predicate over `MasteryCounts`, and `GradingService` gains the first read of `topic_mastery` — a per-profile view carrying each Topic's counts plus its Weak Area verdict — so every later surface classifies by calling, never by re-comparing.

## Boundaries & Constraints

**Always:** The two figures are system-level and account-blind — no per-parent, per-profile or per-tier value, and no column storing them. The verdict is derived at read time, never persisted, so retuning a threshold changes every answer at once instead of leaving stale booleans. The floor counts answered Questions only (`correct + incorrect`); `unanswered` is reported by Story 7.2's row and counts toward neither the fraction nor the floor. "Below 60%" is strict: exactly 60% is not a Weak Area. The floor is measured over the same 5-Attempt window the Mastery figure is over — the stored counts are that window, and a second lifetime counter would be a second answer (SPEC.md records the ambiguity; the window is the only reading the stored data supports and the only one Story 7.2 built). Both overrides are validated at boot, as `pin-policy.ts` validates its own.

**Block If:** nothing in this story requires a human decision.

**Never:** No controller, route, DTO or `apps/web` change — Story 7.4 owns the dashboard and its authorization, Story 7.5 the drill-down. No ranking, sorting-for-display, Subject filter or copy string. No new table, column or migration. No second Mastery formula or window: `mastery.ts` stays the only one. No write to `topic_mastery` outside `recomputeMastery`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Weak Area | 2 correct, 3 incorrect (40%, 5 answered) | `isWeakArea` true | No error expected |
| Below the floor | 1 correct, 3 incorrect (25%, 4 answered) | false — too little evidence | No error expected |
| Exactly at the ceiling | 6 correct, 4 incorrect (60%, 10 answered) | false — strictly below only | No error expected |
| Blanks never trip the alarm | 2 correct, 2 incorrect, 9 unanswered (50%, 4 answered) | false — `unanswered` is not evidence | No error expected |
| No fraction at all | 0 correct, 0 incorrect, 8 unanswered (`value` null) | false | No error expected |
| Tuned floor | `WEAK_AREA_ANSWERED_FLOOR=3`, 1 correct 3 incorrect | true — the figures are configuration | No error expected |
| Bad override | `WEAK_AREA_MASTERY_CEILING_PERCENT=140` | API refuses to boot | Throws at `weakAreaRuntime()`, message names the variable |
| Read for a profile | A child with one weak and one healthy Topic | `masteryFor` returns both rows with counts, `answered` and the verdict | No error expected |
| Read with no history | A profile with no `topic_mastery` row | `[]` — not an error, and no invented zero row | No error expected |

</intent-contract>

## Code Map

- `apps/api/src/grading/mastery.ts:71` `MasteryCounts` (`correct`/`incorrect`/`unanswered`/`value`), `:96` `masteryFrom`, `:137` `hasEvidence` -- the formula and the shape this story classifies; extended by nothing here.
- `apps/api/src/grading/mastery-eligibility.ts` -- the file-shape to copy for a small, pure, heavily-documented rule module owned by `grading`.
- `apps/api/src/identity/pin-policy.ts:57-90` `pinRuntime`/`resolvePinRuntime`/`resetPinRuntime` -- the exact env-override pattern to mirror: constant default, `requireIntEnv`, resolve-once, validate-or-throw, test seam.
- `apps/api/src/common/env.ts:31` `requireIntEnv` -- positive whole numbers only, throws on anything else; the ceiling's `<= 100` check is this story's to add.
- `apps/api/src/identity/identity.module.ts:78` `pinRuntime();` in the module constructor -- how a policy is forced to resolve at boot rather than on first request.
- `apps/api/src/grading/grading.service.ts:1052` `recomputeMastery` (sole writer of `topic_mastery`; do not touch), `:1169` the upsert whose stored columns this story reads, `:423` `resultsFor` -- the service's read-method shape and doc style.
- `apps/api/src/grading/grading.module.ts:47` module metadata -- where the boot-time resolve is added.
- `apps/api/prisma/schema.prisma` `model TopicMastery` -- `@@unique([studentProfileId, topicId])`, `value Float?`, `attemptsCounted`; read-only here.
- `apps/api/test/harness.ts:82` `grading`, `:52` `prisma`, `:517` `createSubject`, `:546` `createStudentProfile` -- the int-spec's entry points.
- `apps/api/test/mastery.int-spec.ts:1-60` -- the fixture recipe (reset, parent account, grade level, subject) and the "driven through `GradingService`, not routes" rationale to follow.
- `.env.example` (workspace root) -- every optional override is documented there with its default; the PIN block is the format to copy.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/grading/weak-area-policy.ts` -- new: `WEAK_AREA_MASTERY_CEILING_PERCENT = 60` and `WEAK_AREA_ANSWERED_FLOOR = 5` as the defaults; `weakAreaRuntime()` resolving both once through `requireIntEnv` and throwing when the ceiling exceeds 100; `resetWeakAreaRuntime()` test seam; `answeredOf(counts)` = `correct + incorrect`; `isWeakArea(counts)` comparing with integer arithmetic (`correct * 100 < ceiling * answered`) so the boundary is exact and `value`'s float never decides it -- one predicate, one pair of figures, nothing per-parent.
- `apps/api/src/grading/weak-area-policy.spec.ts` -- new: every I/O matrix row that needs no database, including the boundary, the floor, the blanks and both override cases, resetting the runtime around each env change.
- `apps/api/src/grading/grading.service.ts` -- add `async masteryFor(studentProfileId)` returning `TopicMasteryView[]` (`topicId`, `correct`, `incorrect`, `unanswered`, `answered`, `attemptsCounted`, `value`, `isWeakArea`) read from `topic_mastery` ordered by `topicId asc` -- the first reader of the table Story 7.2 writes; classification happens here so no later surface re-compares thresholds. Presentation ranking stays Story 7.4's.
- `apps/api/src/grading/grading.module.ts` -- call `weakAreaRuntime()` in the module constructor with the comment its neighbours carry -- a mistyped threshold must fail boot, not the first dashboard read.
- `.env.example` -- document `WEAK_AREA_MASTERY_CEILING_PERCENT` and `WEAK_AREA_ANSWERED_FLOOR` with their defaults and the rule that they are system-level, never per-account.
- `apps/api/test/weak-area.int-spec.ts` -- new: drive a real graded hand-in through `harness.grading` (the `mastery.int-spec.ts` recipe) for a profile with one Topic under the ceiling with enough answered Questions and one above it, assert `masteryFor`'s verdicts and counts, assert `[]` for a profile with no history, and assert a lowered `WEAK_AREA_ANSWERED_FLOOR` reclassifies the same stored rows with no recompute.

**Acceptance Criteria:**
- Given a Topic whose stored Mastery is below the ceiling with at least the floor's worth of answered Questions, when `masteryFor` is called for that profile, then that row's `isWeakArea` is true and every other row's is false.
- Given `grep -rln "WEAK_AREA_MASTERY_CEILING_PERCENT\|WEAK_AREA_ANSWERED_FLOOR" apps/api/src`, when it runs, then only `apps/api/src/grading/weak-area-policy.ts` is listed — the two figures are stated once and no surface restates either.
- Given the stored `topic_mastery` rows are unchanged, when `WEAK_AREA_ANSWERED_FLOOR` is lowered and the runtime re-resolved, then previously-healthy Topics read as Weak Areas — the verdict is derived, never stored.
- Given `git diff --name-only`, when this story is complete, then no file under `apps/web`, `apps/api/prisma`, or `apps/api/src/practicetest` is listed, and `grading.service.ts`'s `recomputeMastery` body is unchanged.

## Design Notes

**Why no `weakArea` column.** Both figures are declared tunable post-launch. A stored boolean would be correct only until the first retune and would then need a backfill across every profile — the same silent-misreport failure a stale Mastery value would be. The counts are already stored; the comparison is free.

**Why integer arithmetic in the predicate.** `value` is `correct / (correct + incorrect)`, and `3/5` is representable but `0.6` as a percentage of other ratios is not reliably equal to `0.6`. Comparing `correct * 100 < ceiling * answered` makes "exactly 60% is not a Weak Area" an exact claim rather than one that depends on which ratio produced the figure.

**Why the read lives on `GradingService`.** `topic_mastery` is `grading`'s table (AD-6/AD-17), so its first reader is a method here and not a repository in `practicetest` or a controller reaching for Prisma. Story 7.4 adds the route, the authorization and the ordering on top of this view.

## Verification

**Commands:**
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm --filter api run typecheck` -- expected: clean.
- `pnpm --filter api exec vitest run src/grading/weak-area-policy.spec.ts` -- expected: all pass.
- `pnpm --filter api exec vitest run test/weak-area.int-spec.ts test/mastery.int-spec.ts` -- expected: all pass, Story 7.2's suite unchanged.

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 14
- addressed_findings:
  - none

Reject notes: blind-hunter (13) and edge-case-hunter (1) findings covered unbounded `WEAK_AREA_ANSWERED_FLOOR`, low-but-valid ceiling values, partial-window/`attemptsCounted` edge cases, hot-reload staleness, missing cross-parent IDOR test, missing float-vs-integer-arithmetic proof test, missing migration/backfill note, missing changelog/API-doc update, and a `masteryFor` contract-type test with Story 7.4 -- all either explicitly out of scope per this story's `Never` boundary (authorization, controller/route/DTO, dashboard concerns belong to Story 7.4), already-correct by design (figures are operator configuration with no further bound required), or already covered by existing test cases. Edge-case-hunter's claim that the ceiling could resolve to 0 or negative was verified false against `apps/api/src/common/env.ts:32-44` (`requireIntEnv` already rejects non-positive values). Verification-gap reviewer found no gaps. Intent-alignment auditor confirmed the diff implements the intent's Boundaries point for point, including the doc-only IDOR warning being the correct and sufficient artifact for this story's stated scope.

## Auto Run Result

**Summary of implemented change:** Added `weak-area-policy.ts`, a system-level, account-blind policy module stating the two Weak Area thresholds (`WEAK_AREA_MASTERY_CEILING_PERCENT`, `WEAK_AREA_ANSWERED_FLOOR`) as env-overridable configuration resolved once at boot, with the `isWeakArea` predicate using integer arithmetic for an exact boundary. `GradingService.masteryFor` is the first reader of `topic_mastery`, returning each Topic's counts plus its derived verdict; `GradingModule`'s constructor now resolves the runtime at boot so a bad override fails startup rather than the first dashboard read.

**Files changed:**
- `apps/api/src/grading/weak-area-policy.ts` -- new: the two figures, `weakAreaRuntime`/`resetWeakAreaRuntime`, `answeredOf`, `isWeakArea`.
- `apps/api/src/grading/weak-area-policy.spec.ts` -- new: unit coverage of the full I/O matrix.
- `apps/api/src/grading/grading.service.ts` -- new `TopicMasteryView` interface and `masteryFor` method.
- `apps/api/src/grading/grading.module.ts` -- resolves `weakAreaRuntime()` in the constructor.
- `apps/api/src/grading/grading.module.spec.ts` -- new: pins the boot-time wiring.
- `apps/api/test/weak-area.int-spec.ts` -- new: drives a real graded hand-in and asserts `masteryFor` end to end.
- `.env.example` -- documents both new overrides.

**Review findings breakdown:** patches applied: 0. items deferred: 0. items rejected: 14 (see Review Triage Log above).

**Follow-up review recommendation:** `false`. This pass patched 0 findings (0 high, 0 medium, 0 low); score = 3×0 + 1×0 = 0, below the threshold of 5, and no patched finding was high severity.

**Verification performed:** Commands in `## Verification` above were not re-run in this review pass (no patch or bad_spec loopback triggered); the prior implementation pass's verification stands. Manual inspection confirmed `requireIntEnv`'s positive-integer guard against the live source (`apps/api/src/common/env.ts:32-44`).

**Residual risks:** `masteryFor` remains intentionally unauthorized by profile id, as the spec's Boundaries require; Story 7.4 must add the parent-scope check and elevation guard before any controller calls it. Three items already carried in this spec's `deferred` frontmatter (empty-string override silently ignored, unbounded `masteryFor` read, retroactive Weak Area indistinguishability) remain open and unaffected by this pass.

