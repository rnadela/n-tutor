---
title: 'Story 8.2: Early Image Deletion'
type: 'feature'
created: '2026-09-29'
baseline_revision: '7769f1fee0d07a9fa76df35e30af7712e605a665'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      There is no Source Test list anywhere in the product, so a parent can only reach an
      upload by a link that happens to point at its id.
    evidence: |-
      The API exposes `@Get('subjects')` and `@Get(':id')` and no list route
      (`source-test.controller.ts:177,182`), and the only links carrying a source test id are
      capture's `proceedToGenerate` and the weak-area drill-down. The UX validation report
      already records this ("there is no entry point for FR-33's early image deletion"), and
      the PRD's surface map names a Parent View -> Source Tests surface that does not exist.
      This story places its control on the one id-keyed route that does exist; the missing
      list surface is larger than this story and is where 8.3/8.4's Data & deletion entry
      point will also have to land.
    location: >-
      apps/api/src/sourcetest/source-test.controller.ts:177
    severity: medium
  - summary: >-
      Nothing proves a page's bytes endpoint answers cleanly rather than failing once a row
      is Deleted with a null storagePath.
    evidence: |-
      `readPageBytes()` filters to `state: 'Ready'` so the deleted row is simply absent, and
      the integration suite proves generation still works, but no test calls a per-page read
      path after deletion. The exposure is 8.1's and pre-dates this story; the early trigger
      only makes it reachable minutes after upload instead of after ninety days.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts:986
    severity: low
  - summary: >-
      The web tier verifies screen wiring by substring-matching the component file's own
      source text, so a behaviour regression that preserves the wording passes.
    evidence: |-
      `apps/web/vitest.config.ts` runs `environment: 'node'` with no DOM, so the established
      idiom (`PAGE_SOURCE = readFileSync(page.tsx)` then `expect(PAGE_SOURCE).toContain(...)`)
      is used by the capture screen's spec and now by the generate screen's. Three of four
      review layers independently flagged it: renaming a local breaks the tests while breaking
      the wiring passes them. Pre-existing convention, not introduced here, and changing it is
      a tier-wide decision about how `apps/web` is tested.
    location: >-
      apps/web/vitest.config.ts
    severity: medium
  - summary: >-
      A Source Test whose Extraction job reaches a terminal, non-retryable Failed state without
      ever persisting a row has no path forward: `hasPersistedExtraction` stays false forever, so
      the early-deletion gate refuses indefinitely.
    evidence: |-
      `deletePageImages` refuses with `EXTRACTION_NOT_PERSISTED` whenever
      `ExtractionService.hasPersistedExtraction` answers false, and that method only reads
      whether an `extraction` row exists — it cannot distinguish "still running" from
      "permanently failed with no retry queued". This is a pre-existing gap in the extraction
      job's own retry/recovery policy, not something this story's gate introduced, and the
      90-day sweep is unaffected since it never checks extraction status. A parent in this state
      keeps the photos until the sweep, not forever.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts:501
    severity: low
---

<intent-contract>

## Intent

**Problem:** FR-33 promises a parent can remove a Source Test's photographs before the 90-day clock runs out; today the only thing that deletes a committed page's bytes is Story 8.1's schedule, so a parent who wants the photos of their child's work gone must wait three months.

**Approach:** Add one parent-initiated trigger onto Story 8.1's existing deletion path — `DELETE /parent/source-tests/:id/pages` calls the same unlink-then-mark routine the sweep calls, for one Source Test instead of a due batch — and offer it on the Source Test the parent is already looking at, behind a confirmation that names how many photographs go and states that everything built from them stays. No password: nothing derived is lost.

## Boundaries & Constraints

**Always:**
- Early deletion and the 90-day sweep share one routine that unlinks first and marks the row second; a second copy of that sequence is the defect this story exists to avoid (8.1 → 8.2 dependency).
- Outcome is indistinguishable from expiry: `state: 'Deleted'`, `bytesDeletedAt` set, `storagePath: null`, bytes gone, and the row retained for its ordinal and caption.
- Only a `Submitted` Source Test whose Extraction is persisted may be emptied early — that persisted Extraction is the whole reason the deletion costs the parent nothing. A draft, a queued/running/failed extraction: refuse with a message the parent can act on.
- Ownership is proved with `SourceTestService.requireReadable` (never `requireLive`: a submitted Source Test outlives the 72h draft `expiresAt`), and a foreign or unknown id answers the same 404 every other route answers.
- Idempotent: a Source Test whose pages are already `Deleted` succeeds and removes nothing.
- Storage paths never appear in a response body or a log line (AD-15, AD-20).
- No password and no PIN re-prompt on this action; the parent-elevation guard already in front of the route is the whole authorization.

**Block If:**
- Nothing. Every decision is settled by Story 8.1's shipped code and the epic's cross-story rule.

**Never:**
- Never delete or alter the `SourceTest` row, its Extraction, or any Practice Test, Attempt, Explanation or Mastery value.
- Never delete a single page's bytes selectively — the unit is the Source Test's whole page set, as the sweep's unit is.
- Never touch `deletePage()` (draft page management, which removes the row itself), the 72h draft TTL, or the pre-existing orphan-bytes gap.
- Do not build the Settings → Data & deletion surface, Student Profile deletion (8.3) or Parent Account deletion (8.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Early delete | Submitted test, Extraction persisted, 3 `Ready` pages | Files unlinked; all three rows `Deleted` + `bytesDeletedAt` + `storagePath` null; 200 with the re-read view | No error expected |
| Derived survive | Same, with Practice Tests/Attempts/Mastery | `SourceTest`, Extraction and every derived row unchanged; generation still succeeds | No error expected |
| Already deleted | Every page `Deleted` | 200, nothing unlinked, no second mark | No error expected |
| Still a draft | `status: 'Draft'` | 409 `SOURCE_TEST_NOT_SUBMITTED` | Refused before any unlink |
| Extraction not persisted | Submitted, job `Queued`/`Running`/`Failed` | 409 `EXTRACTION_NOT_PERSISTED` | Refused before any unlink |
| Another account's test | Valid id, wrong `parentAccountId` | 404 `SOURCE_TEST_NOT_FOUND` | Same answer as unknown id |
| Unlink fails | One page's unlink errors | That row stays `Ready` and is left to the sweep; the others are marked; 200 | Logged by page id, never thrown |

</intent-contract>

## Code Map

- `apps/api/src/sourcetest/page-expiry.service.ts:47` — `sweepExpired(now)`: select `Ready` + `submittedAt <= cutoff`, `ingest.remove()` each, `updateMany` the ones that came away. Its unlink-then-mark body (`:66-98`) is what early deletion must reuse, not re-type.
- `apps/api/src/sourcetest/source-test.service.ts:1286` `requireReadable()` (the submitted-safe ownership check), `:311` `read()` (returns the view), `:208-227` constructor (already holds `extraction` via `forwardRef`), `:411` `deletePage()` — the draft-only per-page delete this story must not disturb.
- `apps/api/src/sourcetest/source-test.controller.ts:245` — `@Delete(':id/pages/:pageId')`; the new `@Delete(':id/pages')` sits beside it (distinct path depth, no route-order hazard) and answers 200 with a view rather than 204.
- `apps/api/src/sourcetest/source-test.module.ts:70-76` — `PageExpiryService` is already a provider and an export; injecting it into `SourceTestService` adds no cycle (it depends only on Prisma + `PageIngestService`).
- `apps/api/src/extraction/extraction.service.ts:316` `statusFor()` — shows the `extraction` delegate read; `:404` `readForGeneration()` — the "is there a persisted Extraction" question, but it loads every question, so add a narrow existence check rather than calling it.
- `apps/api/src/sourcetest/source-test-policy.ts:155-237` — message constants (`SOURCE_TEST_NOT_FOUND`, `SOURCE_TEST_NOT_DRAFT`); `:99-138` the retention clock and batch size.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` — **the Source Test detail surface, and the only durable one.** It is the sole route keyed by a Source Test id, it is deep-linkable, and it is reached both from capture's `proceedToGenerate` (`capture/page.tsx:670`) and, sessions later, from the weak-area drill-down (`analytics/topics/[topicId]/page.tsx:348`). It reads generation state only (`:177-195`) and does not yet read the Source Test itself — `parentApi.sourceTest` (`requireReadable`, so a submitted upload resolves) is what gives it the page set.
- `apps/web/src/app/parent/capture/page.tsx:194-229` `openDraft()` — why the capture screen cannot host this control: it acquires its Source Test only through `POST /parent/source-tests`, which opens or resumes a **Draft**, and both inbound links (`parent/page.tsx:112`, `analytics/.../page.tsx:348`) point at the bare path with no id. A submitted Source Test sits in that screen's state only for the minutes after `submit()` in the same session, so a control mounted there is unreachable for the 90-day window this story exists to shorten. `:388` `write()` is still the mutation-path shape to copy: it locks the surface and announces from the returned view.
- `apps/web/src/app/parent/capture/PageStrip.tsx:54-185` — the read-only strip, already rendering the `Photo deleted` caption for a `Deleted` row (8.1). Reusable as-is with `editable={false}`; a second renderer of a page row would be a second expired state.
- `apps/web/src/lib/parent-api.ts:1110` `messageFor()` — how a response status becomes a sentence a parent reads; the two new 409s need a home here or they render as the generic failure line.
- `apps/web/src/components/Dialog.tsx:110-200` — `DestructiveConfirmDialog` (password-gated, for 8.3/8.4); `AppDialog` + `DestructiveActions` are the parts a passwordless variant composes.
- `apps/web/src/copy/common.ts:11-23` `commonCopy.destructive`; `apps/web/src/copy/parent.ts:281-305` `parentCopy.capture` incl. `photoDeleted`/`photoDeletedOn`.
- `apps/web/src/lib/parent-api.ts:1722` `deleteSourceTestPage` — the client-call shape to copy.
- `apps/api/test/page-image-expiry.int-spec.ts` — the real-Postgres exemplar with pages, bytes on disk and derived rows already set up; `apps/web/src/app/parent/capture/page.spec.tsx` — renders components to a string, so anything asserted must be in a component, not only in the page.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/sourcetest/page-expiry.service.ts` -- extract the unlink-then-mark body of `sweepExpired()` into a private `removeAndMark(pageIds, now)` and add `expireNow(sourceTestId, now): Promise<number>` selecting that test's `Ready` pages (no cutoff, no batch cap — a Source Test holds at most `MAX_PAGES`) -- one routine, two triggers, as the epic requires.
- `apps/api/src/extraction/extraction.service.ts` -- add `hasPersistedExtraction(sourceTestId): Promise<boolean>`, a single `extraction.findUnique` existence read -- `sourcetest` must never read an extraction table itself (AD-17), and `readForGeneration()` would load every question to answer a yes/no.
- `apps/api/src/sourcetest/source-test-policy.ts` -- add `SOURCE_TEST_NOT_SUBMITTED` and `EXTRACTION_NOT_PERSISTED` message constants -- one place holds every refusal sentence.
- `apps/api/src/sourcetest/source-test.service.ts` -- inject `PageExpiryService`; add `deletePageImages(parentAccountId, sourceTestId): Promise<SourceTestView>` = `requireReadable` → refuse a `Draft` (409) → refuse when no persisted Extraction (409) → `expireNow(id, new Date())` → `read()` -- the gates live with the ownership check, so the expiry service stays a pure deletion routine.
- `apps/api/src/sourcetest/source-test.controller.ts` -- add `@Delete(':id/pages')` (200, `SourceTestView`) behind the existing elevation guard -- the parent already proved elevation; no password (the epic's one exception).
- `apps/api/src/sourcetest/page-expiry.service.spec.ts` -- cover `expireNow`: all-ready, already-deleted no-op, partial unlink failure, and that it never widens past its own `sourceTestId` -- the matrix is the contract.
- `apps/api/test/page-image-expiry.int-spec.ts` -- add early-deletion cases over the route: bytes gone + rows/date/path, derived rows and generation intact, second call a no-op, draft refused, unextracted test refused, other account 404 -- concurrency and byte removal belong in the real-Postgres tier.
- `apps/web/src/components/Dialog.tsx` -- add `ConfirmDestructiveDialog` (title, body, destructive confirm, cancel; no password field) composing `AppDialog` -- 8.2 is the one destructive action that re-authenticates with nothing, and reusing the password dialog would ask for one.
- `apps/web/src/copy/common.ts` -- add the passwordless confirm's shared labels if the existing `confirm`/`cancel` do not fit as-is -- every visible string lives in a copy file.
- `apps/web/src/copy/parent.ts` -- add `parentCopy.capture.deletePhotos`, `deletePhotosTitle`, `deletePhotosBody(count)` (names the photo count and states the practice built from them is untouched and this cannot be undone), and `photosDeleted(count)` for the announcement -- the confirmation names what goes.
- `apps/web/src/lib/parent-api.ts` -- add `deleteSourceTestPageImages(token, id)` returning `SourceTestView` -- the view the server returns is the only account of what is left.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` -- read the Source Test with `parentApi.sourceTest`, render its pages read-only through the existing `PageStrip` (`editable={false}`), and offer the delete-photos control there, opening `ConfirmDestructiveDialog` and announcing from the returned view -- this is the one surface a parent can reach a submitted upload from after the session that created it, and rendering the pages is what makes the expired state visible where the upload actually lives.
- `apps/web/src/app/parent/capture/page.tsx` -- leave the page management surface alone: no delete-photos control here -- the screen only ever holds a Draft except in the minutes after submit, so a control here would be unreachable exactly when it is wanted.
- `apps/web/src/lib/parent-api.ts` -- give the two new 409 refusals (`SOURCE_TEST_NOT_SUBMITTED`, `EXTRACTION_NOT_PERSISTED`) a parent-readable sentence rather than the generic failure line -- a refusal a parent cannot act on is the same as no message.
- `apps/web/src/components/Dialog.spec.tsx` -- cover the passwordless dialog: body renders, confirm is enabled with no password typed, no password field exists -- the absent field is the requirement.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx` -- assert the control's presence for a submitted test with live pages, its absence once every page is `Deleted`, and that the pages render with the expired caption -- the AC is about what the surface offers.
- `apps/web/src/lib/parent-api.spec.ts` -- cover `deleteSourceTestPageImages`: the verb, the path and the elevated header, beside the existing `deleteSourceTestPage` case -- a client wired to a path the server does not serve fails only in front of a parent.

**Acceptance Criteria:**
- Given a submitted Source Test with a persisted Extraction and pages on disk, when the parent confirms early deletion, then every page row reads `state: 'Deleted'` with `bytesDeletedAt` set and `storagePath` null, no file remains at any of their storage paths, and the response is the re-read Source Test.
- Given that deletion, when the Source Test, its Extraction and every derived Practice Test, Attempt, Explanation and Mastery row are re-read, then all are unchanged, and a Practice Test generated afterwards still succeeds.
- Given the same Source Test after deletion, when the parent returns to it by its own link in a later session, then each page shows its ordinal and the dated `Photo deleted` caption — the same rendering an expired page gets — and the delete-photos control is no longer offered.
- Given the confirmation dialog, when it is open, then it states how many photographs will be removed and that what was built from them stays, offers a cancel, and asks for no password and no PIN.
- Given the codebase after this story, when the unlink-then-mark sequence is searched for, then it exists in exactly one place, called by both the schedule and the route.

## Spec Change Log

### 2026-09-29 — Surface repointed to the Source Test detail route

**Triggering finding.** `[high]` The delete-photos control was specified onto `apps/web/src/app/parent/capture/page.tsx`. That screen acquires its Source Test only through `POST /parent/source-tests`, which opens or resumes a **Draft**, and every inbound link points at the bare `/parent/capture` with no id. A `Submitted` Source Test therefore occupies that screen only for the minutes after `submit()` in the same session — so the control existed but was unreachable for exactly the 90-day window the story exists to shorten, and the parent-facing goal ("delete ahead of the 90-day expiry") could not be met at all.

**What was amended.** Code Map and Tasks now place the control, the read-only page render and its tests on `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` — the only route keyed by a Source Test id, deep-linkable and reachable in a later session from the weak-area drill-down. The capture screen is explicitly left alone. Two further tasks were added: parent-readable copy for the two new 409 refusals, and a `parent-api.spec.ts` case for the new client call. The third Acceptance Criterion now says "returns to it by its own link in a later session" rather than "opens it".

**Known-bad state avoided.** A shipped, fully tested destructive control that no parent can reach after the session that created the upload — green suites over a feature that does not exist from the outside.

**KEEP — these survived review and must survive re-derivation.**
- `PageExpiryService`: `sweepExpired` and `expireNow` both delegating to one private `removeAndMark`, with `state: 'Ready'` in both the select and the update's own `where`. One routine, two triggers, exactly as the epic requires — do not re-split it.
- `SourceTestService.deletePageImages`: `requireReadable` (never `requireLive`), 409 on `Draft`, 409 on no persisted Extraction, then `expireNow`, then a view re-read through `requireReadable` + `viewOf`. `read()` is wrong here because it uses `requireLive`, which 404s a submitted upload past its 72h draft `expiresAt`.
- `ExtractionService.hasPersistedExtraction` as a narrow `findUnique` existence read rather than calling `readForGeneration`.
- `ConfirmDestructiveDialog` as a **separate component** rather than a `requirePassword=false` flag on `DestructiveConfirmDialog` — the flag would be passable by mistake to 8.3/8.4, where the password is the safeguard.
- The integration cases in `apps/api/test/page-image-expiry.int-spec.ts`, all eighteen: they drive the real route against real Postgres and real files, and prove derived-data survival by regenerating a Practice Test after the bytes are gone.
- `@Delete(':id/pages')` answering 200 with the re-read view, behind the existing elevation guard and asking for no password.

**Also fix while re-deriving (review findings that outlived the loopback).**
- `apps/web/src/components/Dialog.spec.tsx` gained a verbatim duplicate of the existing "draws no shadow of its own" case — do not reintroduce it.
- The confirmation closed itself *before* calling `onConfirm`, which made `ConfirmDestructiveDialog`'s `busy`/`firing` lock unreachable and its "in flight" test an assertion about a state the product never enters. Keep the dialog open until the write settles, or drop the lock — not both.
- `onConfirm(count)` handed back a count the screen then recomputed and ignored; and the control was gated twice, by `!isDraft` and by a `submitted` prop, for a two-member enum. One predicate, one signature.
- The success announcement was `before - after`, which can be `0` on an idempotent second delete and has no zero case in the copy.
- `removeAndMark`'s log line lost the trigger it came from, so a parent-requested deletion and a scheduled sweep now emit the identical sentence. Name the trigger.
- `hasPersistedExtraction` had no unit test, and the new `expireNow` unit cases asserted the update with `toMatchObject` loose enough to miss the `state: 'Ready'` guard.

## Review Triage Log

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 1: (high 1, medium 0, low 0)
- patch: 0
- defer: 2: (high 0, medium 1, low 1)
- reject: 14: (high 0, medium 4, low 10)
- addressed_findings:
  - `[high]` `[bad_spec]` The delete-photos control was specified onto the capture screen, which only ever holds a Draft outside the minutes after submit, making the story's one parent-facing action unreachable in every later session — spec amended to place it on the Source Test detail route (`parent/generate/[sourceTestId]`), and the code reverted for re-derivation.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 1, medium 2, low 6)
- defer: 1: (medium 1)
- reject: 16: (high 0, medium 5, low 11)
- addressed_findings:
  - `[high]` `[patch]` `SourceTestService.read()` proved ownership with `requireLive`, which 404s any row past its `expiresAt` — the *draft's* 72h TTL, which submit never clears. The generate screen's new `parentApi.sourceTest` read sits un-caught in its mount `Promise.all`, so every committed upload older than three days made the whole screen fail to load and the delete control unreachable — a regression to a shipped screen as well as to this story. `read()` now uses `requireReadable` (an expired draft still 404s), with two integration cases over a backdated `expiresAt`; reverting the change was confirmed to fail them.
  - `[medium]` `[patch]` The new Source Test read had no `.catch` in the mount `Promise.all`, so any transient failure of an optional read took down a screen that previously loaded without it — it now degrades to `null` and hides the strip and the control, rethrowing only `endsParentView` causes.
  - `[medium]` `[patch]` `deletePhotos()` bumped the request counter shared with the allowance read and the generation-status poll, so confirming a deletion discarded an in-flight poll result and froze the progress line — the delete now carries its own token/ref pair.
  - `[low]` `[patch]` A 200 whose view holds zero `Deleted` pages (every unlink failed) announced "0 photos" — a sentence the copy has no form for and which is false, since the photographs are still there. It is now treated as a failure.
  - `[low]` `[patch]` The cross-account case asserted only the 404 status while the message was asserted on the unknown-id request; indistinguishability is a claim about the two bodies, so both are now asserted and compared to each other.
  - `[low]` `[patch]` `expect(markup).not.toContain('disabled')` also matched `aria-disabled` and MUI's `Mui-disabled` class; it now matches the confirm control itself.
  - `[low]` `[patch]` An assertion encoded an exact newline plus four spaces, so any reflow would have made it vacuously true; it now flattens whitespace and checks ordering.
  - `[low]` `[patch]` `readForGeneration`'s doc block had been orphaned above `hasPersistedExtraction`, leaving one method with two unrelated blocks and the other undocumented.
  - `[low]` `[patch]` Reverted a gratuitous move of `CONFLICT_STATUS` across `messageFor`, so the `parent-api.ts` diff is the new call alone.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1: (low 1)
- reject: 19: (high 0, medium 0, low 19)
- addressed_findings:
  - none

## Design Notes

**Why the Extraction gate.** The epic's safety argument for deleting a child's photographs is that the Extraction is persisted separately and regeneration reads it. Before the job succeeds that argument does not hold: a parent deleting images of a `Queued` upload would destroy the only input the extraction has, and a `Failed` retryable job could never be retried. The 90-day sweep never meets this case; the early trigger does, so it is the only place the gate belongs.

**Why the whole page set.** Selective per-page early deletion would be a second unit of deletion, a second set of ACs, and a strip mixing live and removed photographs by parent choice rather than by the clock. The requirement is "delete its Page Images", so the Source Test is the unit — matching the sweep, which also empties the test it reaches.

```ts
// page-expiry.service.ts — one routine, two triggers.
async expireNow(sourceTestId: string, now: Date): Promise<number> {
  const due = await this.prisma.pageImage.findMany({
    where: { sourceTestId, state: 'Ready' },
    select: { id: true },
  });
  return this.removeAndMark(due, now); // the body sweepExpired() already runs
}
```

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and integration specs pass, including the new `expireNow` and early-deletion cases.
- `pnpm --filter web test` -- expected: the dialog and capture-page specs pass.
- `pnpm lint && pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --write .` -- expected: no unformatted files remain.

## Auto Run Result

Status: done

**Summary of implemented change.** Story 8.2 (FR-33): a parent can now remove a committed Source Test's photographs ahead of the 90-day retention sweep. `DELETE /parent/source-tests/:id/pages` reuses Story 8.1's unlink-then-mark routine (`PageExpiryService.expireNow`, delegating to the same private `removeAndMark` as `sweepExpired`) for one Source Test instead of a due batch, gated on `Submitted` status and a persisted Extraction, and surfaces the control on the Source Test detail route (`parent/generate/[sourceTestId]`) behind a passwordless confirmation.

**Files changed:**
- `apps/api/src/sourcetest/page-expiry.service.ts` -- adds `expireNow`, extracts `removeAndMark`, names the trigger in its log lines.
- `apps/api/src/extraction/extraction.service.ts` -- adds `hasPersistedExtraction`, a narrow existence read.
- `apps/api/src/sourcetest/source-test-policy.ts` -- adds `SOURCE_TEST_NOT_SUBMITTED` and `EXTRACTION_NOT_PERSISTED` message constants.
- `apps/api/src/sourcetest/source-test.service.ts` -- adds `deletePageImages`; `read()` moves from `requireLive` to `requireReadable`.
- `apps/api/src/sourcetest/source-test.controller.ts` -- adds `@Delete(':id/pages')`.
- `apps/api/src/sourcetest/page-expiry.service.spec.ts`, `apps/api/test/page-image-expiry.int-spec.ts`, `apps/api/src/extraction/extraction.service.spec.ts` -- unit and real-Postgres coverage of the above.
- `apps/web/src/components/Dialog.tsx` -- adds `ConfirmDestructiveDialog` (no password field).
- `apps/web/src/copy/parent.ts` -- adds the early-deletion copy.
- `apps/web/src/lib/parent-api.ts` -- adds `deleteSourceTestPageImages`.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` -- reads the Source Test, renders its pages read-only via `PageStrip`, offers the delete control and confirmation.
- `apps/web/src/components/Dialog.spec.tsx`, `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx`, `apps/web/src/lib/parent-api.spec.ts` -- coverage of the above.

**Review findings breakdown (this pass):** 0 patched, 1 deferred (low), 19 rejected. No `intent_gap`, no `bad_spec`. Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) ran against the full diff since baseline; every finding that survived triage either restated ground already covered by the two prior review passes (recorded above) or an item already carried in `deferred`, was speculative without a demonstrated reachable path, or was an explicit, commented design decision consistent with the intent contract. The one new deferred item: a Source Test whose Extraction job reaches a terminal, non-retryable `Failed` state without ever persisting a row cannot be early-deleted (the gate stays refused indefinitely) — a pre-existing gap in the extraction job's own retry policy, not introduced by this story; the photos still reach the 90-day sweep regardless, since the sweep never checks extraction status.

**Follow-up review recommendation:** `false`. This pass patched 0 findings (score: `3 × 0 + 1 × 0 = 0`, and no high-severity patch).

**Verification performed:** No code changed in this pass, so the commands in `## Verification` were not re-run; their outcomes from the prior (patch) pass stand. This pass's work was read-only review and frontmatter/triage-log bookkeeping.

**Residual risks:** The one deferred item above (low). The three pre-existing deferred items carried from earlier passes remain open and unaffected by this pass.

