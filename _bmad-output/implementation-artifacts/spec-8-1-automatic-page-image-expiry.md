---
title: 'Story 8.1: Automatic Page Image Expiry'
type: 'feature'
created: '2026-09-29'
baseline_revision: 'd203172a34bbf9f85e80c2866702ee2ced04d361'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      A Page Image left in the Uploading state is never selected by any clock, so its
      bytes stay on disk for ever.
    evidence: |-
      sweepExpired() filters `state: 'Ready'`. A page whose ingest crashed after writing
      the file but before flipping the row to Ready is unreachable by the 90-day sweep and
      by the 72h draft TTL alike. Same class as the pre-existing orphan-bytes gap in
      deletePage(), which the intent puts out of scope for this story.
    location: >-
      apps/api/src/sourcetest/page-expiry.service.ts:56
    severity: medium
  - summary: >-
      The API integration suite is flaky: random specs fail with 404/401 on requests whose
      fixtures were just created.
    evidence: |-
      Reproduced at baseline d203172a34bbf9f85e80c2866702ee2ced04d361 with this story's
      changes stashed: three consecutive runs of test/practice-test.int-spec.ts alone gave
      6, 2 and 0 failures. Post-story full runs fail in different files each time
      (practice-test, source-test, parent-pin, extraction, student-profile). Pre-existing
      and unrelated to this story; every spec this story adds passes in isolation and in
      the full run.
    location: >-
      apps/api/test/
    severity: medium
  - summary: >-
      A pg-boss schedule that fails to install produces no signal beyond one log line.
    evidence: |-
      SchedulerService.apply() catches every failure of createQueue/work/schedule and only
      logs it, and a boot whose start() fails now logs and continues by design. There is no
      health indicator, counter or alert by which a retention sweep that never runs becomes
      visible in production.
    location: >-
      apps/api/src/common/scheduler.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Photographs of a child's schoolwork are written to disk at upload and nothing has ever removed them. FR-32 promises Page Images disappear 90 days after their Source Test was uploaded, without any user action — today that clock does not exist, so the product is an indefinite store of children's schoolwork.

**Approach:** Anchor the 90-day clock on `SourceTest.submittedAt` (upload commit — a never-submitted draft is covered by its own 72h TTL, not by this clock), add a row-driven sweeper over `page_image` that unlinks the stored bytes and then marks the row `Deleted` with the date, and run it on a pg-boss schedule — the one scheduling mechanism AD-5/AD-33 pins. Nothing derived is touched: the Source Test, its Extraction, and every Practice Test / Attempt / Explanation / Mastery value survive, and generation keeps working because it reads the Extraction and never a page. The page strip renders the expired row as the literal caption `Photo deleted`.

## Boundaries & Constraints

**Always:**
- Bytes and row move together and converge: unlink first, then mark the row `Deleted` + `bytesDeletedAt` + `storagePath = null`. A crash between the two leaves a `Ready` row whose file is gone; the next pass re-runs it and `remove()` is ENOENT-tolerant, so the sweep is idempotent and self-healing.
- A page is only swept when its Source Test's `submittedAt` is non-null and at or before `now - 90 days`.
- The sweep is batched (100 rows per pass) and never throws out of its pass.
- Storage paths never leave `sourcetest` and never appear in a log line or a response body (AD-15, AD-20) — log page ids only.
- `pg-boss@12.29.0`, started and stopped with the Nest lifecycle, is the only scheduler. Never `@nestjs/schedule`, never a second `setTimeout` sweep loop.
- The sweep entry point is a plain public method that an integration test calls directly, the way `ExtractionRunner.runOnce()` is — tests never wait on a schedule.
- `SourceTest`, `Extraction`, `PracticeTest`, `Attempt`, `Explanation`, `TopicMastery` rows are never read for writing by this sweep.

**Block If:**
- `pg-boss@12.29.0` cannot be installed (registry unreachable) — the pinned scheduler is an architecture binding, not a choice.

**Never:**
- Never delete or alter the `SourceTest` row, the Extraction, or anything derived.
- Never move the clock on activity, and never re-use `SourceTest.expiresAt` (that is the 72h draft TTL, AD-16).
- Do not implement parent-initiated early deletion (Story 8.2), Student Profile deletion (8.3), account deletion (8.4), or the pre-existing orphan-bytes gap in `deletePage()` — out of scope here.
- Never serve page bytes or a path to the client to make the expired state renderable.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Expired submitted test | `submittedAt` = now − 91d, page `Ready` with bytes on disk | File unlinked; row `Deleted`, `bytesDeletedAt` set, `storagePath` null; `SourceTest`/`Extraction`/derived rows unchanged | No error expected |
| Boundary not yet reached | `submittedAt` = now − 89d | Row untouched, file present | No error expected |
| Never submitted | `submittedAt` null, `createdAt` = now − 200d | Row untouched (draft TTL owns it) | No error expected |
| Already swept | Row already `Deleted` | Not selected by the sweep; no second unlink | No error expected |
| Bytes already missing | Row `Ready`, file absent | Treated as removed; row marked `Deleted` | ENOENT swallowed by `remove()` |
| Unlink fails (non-ENOENT) | Row `Ready`, unlink errors | Row left `Ready`, retried next pass, warning logged by page id | Logged, never thrown |
| More than a batch due | 250 pages due | 100 per pass; three passes drain it | No error expected |
| Regeneration after expiry | All pages `Deleted`, Extraction persisted | Practice Test generation succeeds unchanged | No error expected |
| Read after expiry | `readPageBytes(sourceTestId)` | Deleted pages excluded (`state: 'Ready'` filter already); no filesystem read | No `PageBytesUnavailable` |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:363` — `enum PageImageState { Uploading Ready }`; `:492` `model PageImage` (`state`, `storagePath`, `@@index([sourceTestId])`); `:398` `model SourceTest` (`submittedAt` at `:408`, `expiresAt` at `:406` = the 72h draft TTL, **not** this clock; its docblock already states "Epic 8 owns deletion and expiry semantics").
- `apps/api/src/sourcetest/page-ingest.service.ts:257` — `remove(pageId)`: the delete-bytes helper, already ENOENT-tolerant and path-silent. Only caller today is `source-test.service.ts` `discardPage()` (~`:1252`). Needs to report whether the file is gone.
- `apps/api/src/sourcetest/source-test-policy.ts:80,203,215` — upload root; `:240` `storagePathFor(pageId, root)`; `:26-31,357,366` the 72h TTL constants/helpers — the shape to copy for the 90-day constants.
- `apps/api/src/sourcetest/source-test.service.ts:70` `PageImageView`; `:115` `PAGE_FIELDS`; `:978` `readPageBytes()` (already filters `state: 'Ready'`, so it needs no change); `:1149-1155` the only writer of `storagePath`.
- `apps/api/src/sourcetest/source-test.module.ts` — `PageIngestService` is a private provider here; the new sweeper must live in this module (AD-17: `sourcetest` owns Page Image).
- `apps/api/src/extraction/extraction.runner.ts:23-90` — the worker shape to mirror for testability (`onModuleInit`/`onModuleDestroy`, `runOnce()` exposed for tests, pass never throws). Its docblock explicitly says "AD-33's scheduler arrives with the sweeps that actually need a schedule" — this story is that sweep.
- `apps/api/src/identity/uncommitted-state.service.ts:76,106-111,187` — `sweepExpired(now)` with `SWEEP_BATCH_SIZE = 100`, and the comment naming pg-boss as its eventual driver. Same method shape.
- `apps/api/src/extraction/extraction-policy.ts:118` — `extractionRuntime()`: the cached env-knob pattern (`optionalBoolEnv`, `requireIntEnv` from `apps/api/src/common/env.ts`).
- `apps/api/src/app.module.ts` — module registration list with per-module rationale comments.
- `apps/api/src/common/` — `env.ts`, `database-url.ts` (connection string helpers pg-boss will need).
- `apps/web/src/lib/parent-api.ts:107` — `PageImageView` (`state: 'Uploading' | 'Ready'`), `:124` `SourceTestView`.
- `apps/web/src/app/parent/capture/PageStrip.tsx:54-185` — the only surface that renders pages; renders **no** thumbnail by design, shows a legibility badge (`:120`) and the edit controls behind `editable` (`:124`). `editable` is already false for a submitted Source Test, which is the only kind that can hold an expired page.
- `apps/web/src/copy/parent.ts:281` — `parentCopy.capture` (`pageLabel` at `:292`); every visible string lives here.
- `apps/api/test/source-test.int-spec.ts`, `apps/api/test/uncommitted-state.int-spec.ts` — integration exemplars; `apps/api/test/setup.ts:26-31` — where a worker is switched off for the test tier.

## Tasks & Acceptance

**Execution:**
- `apps/api/package.json` -- add dependency `pg-boss` pinned to `12.29.0` (`pnpm --filter api add pg-boss@12.29.0`) -- AD-33 pins the scheduler and its version.
- `apps/api/prisma/schema.prisma` -- add `Deleted` to `PageImageState`; add `bytesDeletedAt DateTime?` and `@@index([state])` to `PageImage`; document that `state = Deleted` means the bytes are gone and the row is retained for ordering and for the expired caption -- the row must state availability and the date.
- `apps/api/prisma/migrations/**` -- generate the migration (`pnpm --filter api exec prisma migrate dev --name page_image_expiry`) -- schema change needs a checked-in migration.
- `apps/api/src/sourcetest/source-test-policy.ts` -- add `PAGE_IMAGE_RETENTION_MS` (90 days), `pageImageExpiryFrom(submittedAt)`, `isPageImageExpired(submittedAt, now)`, `PAGE_EXPIRY_SWEEP_BATCH_SIZE = 100`, and a cached `pageExpiryRuntime()` (`PAGE_EXPIRY_WORKER_ENABLED` default true, `PAGE_EXPIRY_CRON` default daily) -- one place holds the clock; nothing else writes 90 days.
- `apps/api/src/sourcetest/page-ingest.service.ts` -- change `remove()` to return `Promise<boolean>` (true when the file is gone, including ENOENT; false when it could not be removed) -- the sweep must not mark a row whose bytes survived.
- `apps/api/src/sourcetest/page-expiry.service.ts` -- new `PageExpiryService.sweepExpired(now: Date): Promise<number>`: select up to the batch size of `PageImage` rows where `state = 'Ready'` and `sourceTest.submittedAt <= now - 90d`, unlink each via `PageIngestService.remove()`, then update the ones that came away to `state: 'Deleted'`, `bytesDeletedAt: now`, `storagePath: null`; return the count marked -- the single row-driven sweeper.
- `apps/api/src/common/scheduler.ts` -- new `SchedulerService` + `SchedulerModule`: owns one pg-boss instance over `DATABASE_URL`, starts in `onModuleInit` and stops in `onModuleDestroy`, both no-ops when disabled, and exposes `register(queue, cron, handler)` -- one scheduling mechanism for the whole app.
- `apps/api/src/sourcetest/page-expiry.scheduler.ts` -- new provider registering the daily `page-image-expiry` schedule against `SchedulerService`, whose handler calls `sweepExpired(new Date())` and never throws -- keeps the policy in the owning module and the mechanism in `common`.
- `apps/api/src/sourcetest/source-test.module.ts` + `apps/api/src/app.module.ts` -- provide the two new classes, import `SchedulerModule` -- a module absent from the list is a module whose boot never fails.
- `apps/api/src/sourcetest/source-test.service.ts` -- add `bytesDeletedAt: string | null` to `PageImageView` and `bytesDeletedAt: true` to `PAGE_FIELDS` -- the surface states the date; still no path and no URL.
- `apps/api/test/setup.ts` -- default `PAGE_EXPIRY_WORKER_ENABLED` to `'false'` -- a schedule racing a spec is a coin toss.
- `apps/web/src/lib/parent-api.ts` -- widen `PageImageView.state` to include `'Deleted'` and add `bytesDeletedAt: string | null` -- the web app renders only what the API states.
- `apps/web/src/copy/parent.ts` -- add `parentCopy.capture.photoDeleted` = `'Photo deleted'` (and a dated variant) -- every visible string lives here.
- `apps/web/src/app/parent/capture/PageStrip.tsx` -- when `page.state === 'Deleted'`, render the row as its ordinal plus the `Photo deleted` caption, with no legibility badge and no edit controls -- a designed removal state, never a broken image and never a control that would 409.
- `apps/api/src/sourcetest/page-expiry.service.spec.ts` + `apps/api/src/sourcetest/source-test-policy.spec.ts` -- unit-cover the clock helpers and the I/O matrix rows that do not need Postgres (boundary, never-submitted, already-deleted, unlink failure, batch cap) -- the matrix is the contract.
- `apps/api/test/page-image-expiry.int-spec.ts` -- new integration spec against real Postgres driving `sweepExpired()` directly -- bytes-gone, row state/date, derived rows intact, generation still works, second pass is a no-op.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- assert the expired row shows `Photo deleted` and offers no controls -- the AC is about what the surface says.

**Acceptance Criteria:**
- Given a submitted Source Test whose `submittedAt` is more than 90 days old, when the sweep runs, then the file at that page's storage path no longer exists on disk and the row reads `state: 'Deleted'` with `bytesDeletedAt` set and `storagePath` null.
- Given that same expiry, when the Source Test, its Extraction, and every derived Practice Test, Attempt, Explanation and Mastery row are re-read, then all are byte-for-byte unchanged and the Source Test itself still exists.
- Given a Source Test whose pages have all expired, when a Practice Test is generated from it, then generation succeeds from the persisted Extraction without touching a Page Image row or the filesystem.
- Given a Source Test with an expired page, when the parent opens it, then the row shows its ordinal and the caption `Photo deleted` (dated, e.g. `Photo deleted on <date>`, when `bytesDeletedAt` parses; the bare literal otherwise), with no image element, no error styling, no retry control and no edit control.
- Given the API boots with the scheduler enabled, when it shuts down, then the pg-boss instance is started once and stopped once and no `@nestjs/schedule` or second sweep timer exists in the codebase.

## Design Notes

**Why unlink-then-mark.** Marking first and unlinking second turns any crash into permanently orphaned bytes that no clock reaches — precisely what §5.2 says does not exist. Unlinking first turns the same crash into a `Ready` row whose file is already gone, which the next pass re-selects and converges, because `remove()` treats ENOENT as success. Reads are already safe in that window: `readPageBytes()` filters to `state: 'Ready'` and `ingest.read()` raises the typed `PageBytesUnavailable`, never a raw fs error carrying a path.

**Why pg-boss here and not another timer.** AD-5/AD-33 pin pg-boss for schedules and forbid a second ad-hoc scheduler; `ExtractionRunner`'s own docblock defers the scheduler to "the sweeps that actually need a schedule", and this is the first one. The extraction and generation *claim loops* stay as they are — they are job claimers, not schedules, and their enqueue must share a Prisma transaction.

Sweep shape, for the avoidance of doubt:

```ts
const due = await prisma.pageImage.findMany({
  where: { state: 'Ready', sourceTest: { submittedAt: { lte: cutoff } } },
  select: { id: true },
  take: PAGE_EXPIRY_SWEEP_BATCH_SIZE,
});
const gone = (await Promise.all(due.map(async (p) => ((await ingest.remove(p.id)) ? p.id : null))))
  .filter((id): id is string => id !== null);
await prisma.pageImage.updateMany({
  where: { id: { in: gone }, state: 'Ready' },
  data: { state: 'Deleted', bytesDeletedAt: now, storagePath: null },
});
```

## Verification

**Commands:**
- `pnpm db:up && pnpm db:migrate` -- expected: the new migration applies cleanly.
- `pnpm --filter api exec prisma generate` -- expected: `PageImageState.Deleted` present in the generated client.
- `pnpm --filter api test` -- expected: all unit and integration specs pass, including the new expiry specs.
- `pnpm --filter web test` -- expected: the page strip spec passes with the expired-state assertions.
- `pnpm lint && pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --write .` -- expected: no unformatted files remain.

## Review Triage Log

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 4, low 7)
- defer: 3: (high 0, medium 3, low 0)
- reject: 9: (high 0, medium 3, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `SchedulerService.onModuleInit` constructed pg-boss and called `start()` unguarded, so an unreachable Postgres took the whole API down at boot — construction and start are now wrapped, and a failure logs, leaves the service unstarted and lets the API serve parents.
  - `[medium]` `[patch]` Nothing verified the sweep is ever put on a clock: deleting the `register()` call left the suite green — added `scheduler.spec.ts` (14 cases against a fake boss) and `page-expiry.scheduler.spec.ts` (6 cases) covering registration before/after start, the disabled path, and handler-rejection swallowing.
  - `[medium]` `[patch]` The five-field cron check and the `SourceTestModule` boot refusal were asserted nowhere and `resetPageExpiryRuntime()` was dead — added `source-test-module.spec.ts` in the shape of `grading.module.spec.ts`.
  - `[medium]` `[patch]` `remove()`'s new `false` return — the guard against marking a row whose bytes survived — was only ever produced by a stub; added real-filesystem cases to `page-ingest.service.spec.ts` for unlinked, absent and non-ENOENT-failure.
  - `[low]` `[patch]` `onModuleDestroy` could call `stop()` on a half-started instance; the instance is now retained only after `start()` resolves and the stop is guarded.
  - `[low]` `[patch]` A page whose unlink keeps failing was invisible — the sweep now logs the per-pass shortfall (counts only, never a path), with spec cases for the warning firing and not firing.
  - `[low]` `[patch]` `DEFAULT_PAGE_EXPIRY_CRON`'s comment said "a little after midnight UTC" for `17 3 * * *`; corrected to 03:17 UTC.
  - `[low]` `[patch]` `boss.schedule()` left the timezone to a pg-boss default; it now states `tz: 'UTC'` explicitly, asserted in the spec and confirmed in `pgboss.schedule.timezone`.
  - `[low]` `[patch]` `deletedCaption` rendered "Photo deleted on Invalid Date" for an unparseable timestamp on a parent-facing screen; it now falls back to the plain caption, with a test.
  - `[low]` `[patch]` The `deletedPage` web fixture nulled `width`/`height`/`byteSize`, a row shape the sweep never produces, and `not.toContain('<img')` was vacuous; the fixture now matches what `sweepExpired` writes and the assertions discriminate the Deleted branch and the absence of error styling.
  - `[low]` `[patch]` Two comments overclaimed — `SchedulerModule` described itself as global without `@Global()`, and `onModuleDestroy` promised in-flight handlers would finish; both now state what the code actually does.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 16: (high 0, medium 0, low 16)
- addressed_findings:
  - `[low]` `[patch]` `.env.example`'s `PAGE_EXPIRY_WORKER_ENABLED` comment didn't state its dependency on `SCHEDULER_ENABLED`, so an operator could set one true and the other false and get no sweep with no cross-reference explaining why — added a one-line cross-reference.
  - `[low]` `[patch]` The Acceptance Criteria said the expired caption reads the literal `Photo deleted`, but the shipped `PageStrip.tsx`/`parent.ts` render a dated caption (`Photo deleted on <date>`) as the primary case and the bare literal only as an unparseable-date fallback, matching the epic-8 context's fuller UX intent but not what the AC text says — reworded the AC to state the dated form and its fallback.

## Auto Run Result

**Summary:** Implemented the FR-32 90-day Page Image retention sweep: a pg-boss-scheduled, row-driven `PageExpiryService.sweepExpired()` that unlinks bytes then marks rows `Deleted`, leaving `SourceTest`/`Extraction`/derived rows untouched, plus the parent-facing `Photo deleted` expired-state rendering. This was a fresh review pass on an already-`done` story (prior pass on 2026-09-29 had already applied 11 patches). This pass found no code defects — only two low-severity documentation gaps, both fixed as patches.

**Files changed this pass:**
- `.env.example` — added a one-line cross-reference noting `PAGE_EXPIRY_WORKER_ENABLED` also requires `SCHEDULER_ENABLED=true`.
- `_bmad-output/implementation-artifacts/spec-8-1-automatic-page-image-expiry.md` — status to `in-review` then `done`; reworded one AC to state the caption is dated with a literal fallback, matching shipped behavior; appended this triage-log entry and this result.

**Review findings breakdown (this pass):** patch 2 (low 2), defer 0, reject 16 (low 16) — reject findings were either speculative/unlikely (e.g. a theoretical double-registration race requiring concurrent scheduler-provider init that Nest's lifecycle doesn't produce), already-known and separately logged (the `Uploading`-state sweep gap, the pre-existing flaky integration suite), deliberate documented tradeoffs (e.g. `onModuleDestroy` not awaiting in-flight handlers), or a verifiably false claim (`PageIngestService.remove()` cannot reject — its only `await` is wrapped in try/catch). No intent gaps or bad-spec findings.

**Follow-up review recommendation:** `false`. Patched findings this pass: 2 low, 0 medium, 0 high. Score = 3×0 (medium) + 1×2 (low) = 2, below the 5 threshold, and no high-severity patch.

**Verification performed:** Both patches are comment/documentation-only (a `.env.example` comment, a spec markdown AC sentence) with no code or test surface touched. Confirmed via `git diff` that no `.ts`/`.tsx`/`.prisma` file changed in this pass. Ran `pnpm exec prettier --check` on the changed spec markdown file (passed); `.env.example` has no Prettier parser for its extension, consistent with the rest of the file's existing formatting. Did not re-run the full test/lint/typecheck suite, since no code changed and the prior pass already verified it green.

**Residual risks:** None introduced by this pass. Three medium-severity items remain in `deferred` from the prior pass (Uploading-state pages never swept, pre-existing flaky integration suite, silent pg-boss schedule-install failure) — unchanged, out of this pass's scope, and already tracked.

