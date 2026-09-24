---
title: 'Story 3.2 — Page Management Before Submit'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: 'b38a8047308c8bba1f06478917cb6dd6db24c665'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The api integration suite is flaky under a full-suite run, failing a different
      spec on each run with unrelated 404s or 60s timeouts.
    evidence: |-
      Reproduced on HEAD (b38a804) with this story's changes stashed: a full
      `pnpm --filter api run test` failed `uncommitted-state.int-spec.ts` with
      "expected 200 OK, got 404 Not Found". Three runs with the story applied failed
      `student-mode.int-spec.ts`, then `parent-auth.int-spec.ts`, then
      `taxonomy.int-spec.ts`; each of those files passes when run alone. The suite
      declares `fileParallelism: false`, so this is cross-file state or resource
      leakage between Nest apps rather than parallelism.
    location: >-
      apps/api/vitest.config.ts, apps/api/test/harness.ts
    severity: medium
  - summary: >-
      Two password-reset E2E tests fail on a strict-mode violation because a second
      role="status" region exists on the page.
    evidence: |-
      `e2e/tests/parent-auth.spec.ts` uses `getByRole('status')`, which now matches
      both the page's own region and the global AnnouncementRegion that ThemeRegistry
      mounted in Story 1.7. Both ThemeRegistry.tsx and the reset-confirm page are
      unmodified at HEAD, and the failure artifacts were already in the working tree
      when this run started.
    location: >-
      e2e/tests/parent-auth.spec.ts
    severity: medium
  - summary: >-
      The in-flight "adding a page" indicator and the blocked-state reasons
      (page-limit, submit-blocked) render as plain text with no live-region
      wiring, so a screen-reader user only learns of those state changes on
      the next unrelated announcement.
    evidence: |-
      `apps/web/src/app/parent/capture/page.tsx`: the `data-testid="adding"`
      span, `parentCopy.capture.limitReached(maxPages)`, and
      `parentCopy.capture.submitBlocked` are all plain `Typography` with no
      `role="status"` and no `useAnnounce()` call, unlike every completed
      add/move/delete/retake action, which is announced.
    location: >-
      apps/web/src/app/parent/capture/page.tsx
    severity: low
  - summary: >-
      page.tsx's own gating and orchestration logic (isDraft, addable,
      submittable, the ordinal lookups in retakePage/deletePage) is exercised
      in page.spec.tsx only by grepping the component's source text for
      literal substrings, not by running it.
    evidence: |-
      `apps/web/src/app/parent/capture/page.spec.tsx` asserts things like
      `expect(PAGE_SOURCE).toContain('const isDraft = sourceTest !== null')`.
      These assertions execute nothing: a differently-phrased but equally
      buggy implementation would pass, and a correct implementation phrased
      differently would fail. Real behavioral coverage of this logic exists
      only in `e2e/tests/parent-capture.spec.ts`, which is a full-stack
      Playwright suite rather than a colocated, DOM-free spec on an exported
      function -- the shape the story's own "pure functions with colocated
      specs" language points at. `apps/web/src/lib/page-order.ts` already
      extracts the narrower ordering/count rules the story's own task list
      names; this is about the rest of the screen's decision logic that
      stayed inline.
    location: >-
      apps/web/src/app/parent/capture/page.tsx, apps/web/src/app/parent/capture/page.spec.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent photographing a paper test has no way to fix a bad capture: there is no Source Test, no Page Image, and no surface on which pages can be reordered, retaken, or deleted, so a mis-ordered or unreadable batch would be submitted as-is.

**Approach:** Introduce the `sourcetest` module — `SourceTest` and `PageImage` rows with contiguous ordinals and mandatory ingest normalization — and a parent-facing page-management surface that shows the explicit page order, moves a page up or down, retakes one page, deletes a page (renumbering the rest without touching their bytes), and refuses submission while zero pages remain.

## Boundaries & Constraints

**Always:**
- A `PageImage` row is INSERTed in state `Uploading` **before any byte is written**; its storage path is derived from the row id alone, never from client input (AD-15).
- Format is decided by byte-sniffing with `file-type` against the allowed set, never from the client-declared type; `sharp(...).rotate()` re-encodes to JPEG q85 **before** the row leaves `Uploading` (AD-28). Never crop.
- Ordinals are contiguous `1..N` per Source Test at every committed transaction boundary. Reorder and delete rewrite ordinals inside one transaction; page bytes are never re-read or re-processed by either.
- The parent account comes from `req.elevated.parentAccountId`, never from the path or body (AD-18). Every read and write is scoped by it; a foreign or unknown id yields 404, never 403.
- Submission is refused server-side when zero pages remain. The disabled button is a courtesy, not the control.
- One TTL: a draft Source Test lives 72 hours from `createdAt`, never extended by activity, reusing the existing constant rather than declaring a second one (AD-16).
- No log line, error body, or exception message carries image bytes, a filename, or a storage path — identifiers only (AD-20).
- User-facing strings live in `src/copy/parent.ts`; no hardcoded literal in a component. Web logic is exported as pure functions with colocated specs (the web suite has no DOM).

**Block If:**
- `sharp` cannot be installed or loaded on this platform, leaving no way to honor AD-28's mandatory normalization.

**Never:**
- Do not build the camera viewfinder, continuous-capture loop, photo-library permission guidance, or the HEIC-specific conversion path — those are Story 3.1's acceptance criteria. A plain file input is the only page-add affordance here, and it exists so page management is exercisable.
- Do not implement the batch legibility check, the Upload Allowance charge, or the commit confirmation copy (Story 3.4); Subject / Grade Level assignment and its submit gate (Story 3.3); Extraction (Story 3.5); or the orphan sweeper / expiry deletion (Epic 8). Expired drafts are filtered out of reads, not swept.
- Do not add drag-and-drop reordering. Do not serve stored image bytes as static files.
- Do not touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reorder to an explicit permutation | Draft with pages `[A,B,C]`, `PUT .../pages/order` body `{ pageIds: [C,A,B] }` | 200; pages come back ordinals `1,2,3` as `C,A,B`; no byte is re-read | No error expected |
| Reorder with a non-permutation | Body omits a page id, repeats one, or names a foreign id | 400 `PAGE_ORDER_MISMATCH`; stored order unchanged | Whole request rejected, never partially applied |
| Move first page up / last page down | Client-side `movedOrder(ids, id, 'up')` at index 0 | Returns the same order; control is disabled at the ends | No request issued |
| Delete a middle page | Pages `1,2,3`, delete the page at ordinal 2 | 204; survivors renumber to `1,2`; their `storagePath`, `mimeType` and dimensions are byte-identical to before | No error expected |
| Delete the last remaining page | One page, delete it | 204; zero pages; submit control disabled with the reason shown | No error expected |
| Submit with zero pages | Draft with no pages, `POST .../submit` | 400 `NO_PAGES_TO_SUBMIT`; status stays `Draft` | Client shows the stated reason |
| Submit with at least one page | Draft with 1–10 pages | 200; status `Submitted`, `submittedAt` set | No error expected |
| Add an 11th page | Draft already holding 10 pages | 409 `PAGE_LIMIT_REACHED`; no row created, no byte written | Add control disabled client-side at 10 |
| Add a file whose bytes are not an allowed image | `.txt` bytes sent with `content-type: image/jpeg` | 415 `UNSUPPORTED_IMAGE_FORMAT`; no `Ready` row survives | The `Uploading` row is removed in the same failure path |
| Retake one page | `PUT .../pages/:pageId` with new bytes | 200; that page's ordinal is unchanged, its bytes replaced; sibling rows untouched | 404 for a page on another account's Source Test |
| Act on a non-draft or expired Source Test | Status `Submitted`, or `expiresAt` in the past | 404 `SOURCE_TEST_NOT_FOUND` for expired; 409 `SOURCE_TEST_NOT_DRAFT` for submitted | Client returns the parent to the start of the flow |
| Unelevated request | Valid session cookie, no elevation bearer | 401 `{ elevated: false }` from the existing guard | Client routes to `/parent/pin` |

</intent-contract>

## Code Map

**Patterns to follow (read-only anchors):**
- `apps/api/src/identity/student-profile.controller.ts:47-58` -- the canonical parent controller: `@Controller('parent')`, `@SkipThrottle({ login: true })`, `@UseGuards(ParentElevationGuard)`, account from `req.elevated`.
- `apps/api/src/identity/student-profile.service.ts:135` -- `this.prisma.$transaction(async (tx) => …)` usage; exported `*_NOT_FOUND` message constants and a `…View` return interface with ISO-string dates.
- `apps/api/src/identity/uncommitted-state-policy.ts` -- the policy-module shape: exported constants, `requireIntEnv` override resolved once, pure helpers. Exports `UNCOMMITTED_STATE_TTL_MS` (72h) — **import it**, do not restate the figure.
- `apps/api/src/identity/parent-elevation.guard.ts:66` -- `ParentElevationGuard`, `ElevatedRequest`, `ElevatedPrincipal { parentAccountId, … }`.
- `apps/api/src/prisma/prisma.service.ts` -- `@Global()` `PrismaService`, `TransactionClient`, `withTransaction`.
- `apps/api/src/common/env.ts` -- `requireEnv` / `optionalEnv` / `requireIntEnv`; the only env reader.
- `apps/api/src/app.module.ts` -- where `SourceTestModule` is registered.
- `apps/api/test/harness.ts` -- `createHarness`, `createSignedInParent`, `elevate`, `bearer`, `createStudentProfile`, `createGradeLevel`, and the hand-maintained TRUNCATE table list that must gain `source_test` / `page_image`.
- `apps/api/test/student-profile.int-spec.ts` -- int-spec shape: top-level `await import(...)`, `beforeAll` harness, `beforeEach` truncate, `const server = () => request(h.app.getHttpServer())`.
- `apps/web/src/app/parent/students/page.tsx:52,91,139-171` -- the parent client-page pattern: `useElevation()`, redirect on null token, `load()` in `useCallback`, `applyIfCurrent` staleness guard, `endsParentView(cause)` error routing, `announcedText`.
- `apps/web/src/lib/parent-api.ts:198,243,433` -- private `call<T>`, the `parentApi` thunk object, the `elevated(token)` header builder.
- `apps/web/src/components/` -- `PrimaryButton` / `DestructiveButton` (`Button.tsx:16,26`), `Screen.tsx:14`, `useAnnounce()` (`LiveRegion.tsx:116`).
- `apps/web/src/theme/tokens.ts:40,87,89` -- `density.tapTarget = 44`, `rounded.control`, `focusRing`. There are **no** inverted-surface tokens; do not invent any (the viewfinder that needs them is Story 3.1).
- `apps/web/src/components/primitives.spec.tsx:32-38` -- `renderToStaticMarkup` + source-text assertions; the web suite runs `environment: 'node'`.
- `e2e/fixtures.ts`, `e2e/tests/parent-students.spec.ts` -- E2E fixture helpers and the sign-in + PIN-elevation flow to reuse.
- `playwright.config.ts:webServer[0].env` -- where the E2E API environment is declared wholesale; a new env var must be added here or it is absent under E2E.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/mockups/key-capture.html` -- State 2 is the reference for this surface. Its DOM uses `<div class="iconbtn">`; build real `<button>`s instead — EXPERIENCE.md line 24 says the spine wins where mock and spine disagree.

**Files to create:**
- `apps/api/src/sourcetest/source-test-policy.ts`, `.spec.ts` -- pure rules and message constants.
- `apps/api/src/sourcetest/page-ingest.service.ts` -- sniff → rotate → JPEG q85 → write; path derived from row id.
- `apps/api/src/sourcetest/source-test.service.ts`, `source-test.controller.ts`, `source-test.module.ts`, `dto/source-test.dto.ts`.
- `apps/api/test/source-test.int-spec.ts`.
- `apps/web/src/lib/page-order.ts`, `.spec.ts` -- `movedOrder`, `canSubmitPages`, `canAddPage`.
- `apps/web/src/app/parent/capture/page.tsx`.
- `e2e/tests/parent-capture.spec.ts`.

**Files to change:**
- `apps/api/prisma/schema.prisma` (+ a new migration directory), `apps/api/package.json`, `apps/api/src/app.module.ts`, `apps/api/test/harness.ts`, `apps/api/test/setup.ts`, `.env.example`, `playwright.config.ts`, `apps/web/src/lib/parent-api.ts`, `apps/web/src/copy/parent.ts`.

## Tasks & Acceptance

**Execution:**
- `apps/api/package.json` -- add `sharp@0.35.4`, `file-type@22.0.2`, `multer@2.2.0` and dev `@types/multer`; run `pnpm install` -- AD-28 names these exact versions and all three are already resolved in the lockfile store.
- `apps/api/prisma/schema.prisma` -- add `SourceTestStatus` / `PageImageState` enums and `SourceTest` / `PageImage` models with `@@unique([sourceTestId, ordinal])`, `Restrict` on both `SourceTest` parent relations, `Cascade` from `SourceTest` to `PageImage`, and doc comments naming AD-15/AD-16/AD-17 -- a row is the authority from the first byte; Epic 8 owns deletion semantics deliberately, so nothing is destroyed as a side effect here.
- `apps/api/prisma/migrations/<timestamp>_add_source_test/migration.sql` -- generate with `prisma migrate dev --name add_source_test` -- migrations are checked in and `prisma migrate deploy` is what every environment runs.
- `apps/api/src/sourcetest/source-test-policy.ts` -- export `MAX_PAGES = 10`, `ALLOWED_MIMES`, `SOURCE_TEST_TTL_MS` (re-exported from `UNCOMMITTED_STATE_TTL_MS`), `UPLOAD_ROOT` resolution via `optionalEnv`, `storagePathFor(id)`, `canSubmit`, `canAddPage`, `renumbered`, `reorderedOrThrow`, and every message constant -- one source of truth for each figure; tests compare against the constant, never a literal.
- `apps/api/src/sourcetest/page-ingest.service.ts` -- `normalize(buffer)`: `fileTypeFromBuffer` against `ALLOWED_MIMES`, then `sharp(buffer).rotate().jpeg({ quality: 85 })` reading width/height from the output metadata rather than pre-rotate meta; `write(pageId, buffer)` creates the derived directory and writes; `remove(pageId)` unlinks tolerantly -- normalization must complete before the row leaves `Uploading`, and never crop.
- `apps/api/src/sourcetest/source-test.service.ts` -- `openDraft`, `read`, `addPage`, `retakePage`, `deletePage`, `reorderPages`, `submit`; ordinal rewrites use a two-phase negative-offset update inside one `$transaction` so the unique constraint holds mid-rewrite -- delete and reorder must renumber without touching bytes.
- `apps/api/src/sourcetest/source-test.controller.ts` + `dto/source-test.dto.ts` -- routes under `@Controller('parent/source-tests')` behind `ParentElevationGuard` with `@SkipThrottle({ login: true })`; `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: … } })` on the two byte-carrying routes; `ReorderPagesDto` validates `pageIds` as a non-empty `@IsUUID('4', { each: true })` array -- the account comes from `req.elevated`, and validation stays class-validator per the global pipe.
- `apps/api/src/sourcetest/source-test.module.ts` + `apps/api/src/app.module.ts` -- register the module with the ownership doc comment the other modules carry -- `sourcetest` is the sole writer of both entities (AD-17).
- `apps/api/src/sourcetest/source-test-policy.spec.ts` -- unit-test every pure rule and the I/O matrix's ordering, limit, and permutation-validation cases -- these are the rules the story is actually about.
- `apps/api/test/source-test.int-spec.ts` -- cover the matrix end to end over the real stack, including the non-image bytes case, the foreign-account 404, the zero-page submit refusal, and a byte-identity assertion on survivors after a delete -- the renumber-without-reprocessing claim needs evidence, not assertion.
- `apps/api/test/harness.ts`, `apps/api/test/setup.ts`, `.env.example`, `playwright.config.ts` -- add the new tables to the truncate list, point `UPLOAD_ROOT` at a per-run temp directory under test, and document the variable -- an env var absent from the E2E server environment is absent in E2E.
- `apps/web/src/lib/page-order.ts` + `.spec.ts` -- pure `movedOrder(ids, id, direction)` (no-op at the ends), `canSubmitPages(count)`, `canAddPage(count)` -- the web suite has no DOM, so the rules have to be reachable without one.
- `apps/web/src/lib/parent-api.ts` -- add `SourceTestView` / `PageImageView` types and `openSourceTest`, `sourceTest`, `addSourceTestPage`, `retakeSourceTestPage`, `deleteSourceTestPage`, `reorderSourceTestPages`, `submitSourceTest` through the existing `elevated(token)` builder; let `call` omit `content-type` for `FormData` bodies so the browser sets the multipart boundary -- a hand-set content-type on FormData breaks the upload.
- `apps/web/src/copy/parent.ts` -- add a `capture` namespace carrying the mockup's strings verbatim (`'Pages'`, `'Order'`, `'Add page'`, `'Check pages'`, `'Retake'`, `'Delete'`), the count line as a function of `(count, max)`, the ordinal label as a function of `(n)`, ordinal-naming aria labels for move/retake/delete, and the stated reason shown when submission is blocked -- no user-facing string is a hardcoded literal.
- `apps/web/src/app/parent/capture/page.tsx` -- client page: elevation gate, open-or-resume the draft for the selected Student Profile, render the strip as an `<ol>` where each `<li>` names its ordinal in text and carries real focusable buttons whose accessible names include that ordinal, disable move-up on the first and move-down on the last, disable add at `MAX_PAGES`, disable the submit control at zero pages **with the reason displayed**, and announce each change with the words shown -- the UX requires an ordered list, ordinal-named icon controls, and 44px targets.
- `e2e/tests/parent-capture.spec.ts` -- drive the real surface: sign in, elevate, add two pages by file input, reorder, delete to zero, assert the submit control is disabled and the reason is visible, then confirm a direct submit call is refused -- the outermost surface the intent references is the parent's screen.

**Acceptance Criteria:**
- Given a draft Source Test whose pages are visibly numbered `Page 1 … Page N` in the strip, when the parent moves a page up or down, then the displayed order and the numbering both change to match, the new order is persisted, and the order shown before submission is the order stored.
- Given a draft Source Test with three pages, when the parent deletes the second, then the remaining two are renumbered `Page 1` and `Page 2` and neither one's stored image is re-read, re-encoded, or re-written.
- Given a draft Source Test with zero pages, when the parent attempts to submit, then the submit control is disabled with the reason stated on screen and the server refuses the submission independently of the client.
- Given any page-management request for a Source Test belonging to another Parent Account, or made without a valid elevation token, when it is issued, then it is refused by the existing guard or answered 404, and no row or file is changed.
- Given the strip rendered for a parent, when it is inspected for accessibility, then it is an ordered list, every action is a real focusable control whose accessible name includes the page ordinal it acts on, and every target meets the 44px parent floor.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 21: (high 3, medium 12, low 6)
- defer: 2: (high 0, medium 2, low 0)
- reject: 7: (high 0, medium 3, low 4)
- addressed_findings:
  - `[high]` `[patch]` The zero-page submit gate counted every `page_image` row, so a row stranded in `Uploading` (no bytes on disk) satisfied it — the submit gate now counts `state: 'Ready'` only, while the ten-page ceiling still counts every row; an int test writes an `Uploading` row and asserts `NO_PAGES_TO_SUBMIT`.
  - `[high]` `[patch]` After a successful submit the screen kept every control live (each answering 409) and switching child and back silently opened a brand-new empty draft, so the submitted work appeared to vanish — a non-`Draft` Source Test now renders a read-only terminal state with its pages and an explanation.
  - `[high]` `[patch]` The strip's `listStyle: 'none'` strips list semantics from the accessibility tree in WebKit/VoiceOver, the exact surface AC5 is phrased about — `role="list"` / `role="listitem"` re-applied, and the claim is now asserted by a rendering spec.
  - `[medium]` `[patch]` Two concurrent `addPage` calls could both claim the same ordinal and let a raw Prisma P2002 escape as a 500 — the count+insert now retries and falls back to the documented 409 `PAGE_LIMIT_REACHED`.
  - `[medium]` `[patch]` "One draft per child" had no constraint behind it, so two concurrent opens stranded a draft — a partial unique index on `(parentAccountId, studentProfileId) WHERE status = 'Draft'` was added to the story's own migration and `openDraft` returns the draft that won.
  - `[medium]` `[patch]` A retake wrote straight onto the existing page's path, so a failure mid-write destroyed the photo the parent already had — ingest now writes to a temp sibling and renames.
  - `[medium]` `[patch]` `rewriteOrdinals` threw P2025 as a 500 when a page vanished mid-rewrite — second phase moved to `updateMany`.
  - `[medium]` `[patch]` The multipart byte ceiling was frozen at decorator-evaluation time and leaked multer's own message — the limit is read per request and the refusal is restated from the policy module's constant.
  - `[medium]` `[patch]` The byte ceiling was configured but exercised by no test — an int test drives a small `MAX_PAGE_BYTES` override through `resetSourceTestRuntime`, which previously had no caller at all.
  - `[medium]` `[patch]` The draft-open round trip rendered as an empty strip reading "0 of 0", so a resumed six-page draft flashed as empty — gated on a separate draft-loading flag.
  - `[medium]` `[patch]` The error Alert's Retry re-fetched the profile list only and never retried the failed draft open — Retry now re-issues both.
  - `[medium]` `[patch]` Move and retake announced the client's predicted order rather than the server's answer — both now read the returned view.
  - `[medium]` `[patch]` AC5 was implemented but rendered by no test: the web suite never rendered the screen — added `apps/web/src/app/parent/capture/page.spec.tsx` (strip extracted to a hook-free `PageStrip`) covering list semantics, ordinal-named controls, real buttons, ends-disabled as rendered, the terminal state, and the 44px floor read from the emitted CSS.
  - `[medium]` `[patch]` The client submit path ran in no test — the E2E now clicks "Check pages" and asserts the submitted outcome.
  - `[medium]` `[patch]` Retake was the one page operation whose client call nothing exercised — the E2E now drives `#capture-retake-*` and asserts the ordinal and count are unchanged.
  - `[medium]` `[patch]` No test asserted any capture announcement — the E2E now asserts the live-region sentences for add, move and delete.
  - `[medium]` `[patch]` `deleteSourceTestPage` was typed against a 204 with no coverage — `call`'s empty-body handling was confirmed correct and pinned by five new `parent-api.spec.ts` tests.
  - `[medium]` `[patch]` `deletePage` ended with a `this.read(...)` nobody consumed behind a 204 — dropped.
  - `[low]` `[patch]` `announcedText` carried a literal zero-width space where the source it was extracted from used the `\u200B` escape — escape restored.
  - `[low]` `[patch]` `BackToStudentMode` and `ParentIdleExpiry` still reached `endsParentView` through the students page module — repointed at `@/lib/parent-view`, the extraction's stated home.
  - `[low]` `[patch]` The `<ol>` carried both an `aria-label` and a visible heading with the same words, announced twice — now `aria-labelledby` the heading.
  - `[low]` `[patch]` `pageLabel`'s comment described a thumbnail this story deliberately does not render — corrected.
  - `[low]` `[patch]` `capture.adding` was defined but never rendered, so a slow ingest looked like a dead control — rendered while an add is in flight.
  - `[low]` `[patch]` `storedPages` crashed with a TypeError on a legitimately `Uploading` row, reporting a state bug as a harness failure — made null-safe; duplicate `node:crypto` import collapsed.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 1, medium 4, low 7)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[high]` `[patch]` `retry()` fired `loadProfiles()` and `openDraft()` back to back sharing one staleness counter, so the second call's issue always invalidated the first before its response arrived — the profile-list response was silently dropped on every Retry, able to leave the screen loading forever. Split into two independent counters (`profilesRequestId`/`profilesCurrent`, `draftRequestId`/`draftCurrent`), one per request stream.
  - `[medium]` `[patch]` `PageIngestService.write()`'s temp filename was derived from the target path and `process.pid` alone, so two concurrent writes to the same page (a double-tap retake, a client retry) collided on the same temp file and one silently lost its bytes — the temp name now includes a random UUID per call.
  - `[medium]` `[patch]` The client's submit gate and page count counted every returned page regardless of state, while the server's submit gate counts `Ready` rows only — a page stranded in `Uploading` (a crash between insert and byte write) showed an enabled, satisfied submit control that the server then refused — the client now mirrors the server's `Ready`-only count.
  - `[medium]` `[patch]` `openDraft`'s race-recovery path rethrew the raw Prisma unique-violation error when the winning draft could no longer be read (submitted, expired, or removed in the interim), surfacing an unhandled 500 for what is still a legitimate race outcome — it now answers the same `SOURCE_TEST_NOT_FOUND` 404 a vanished draft always does.
  - `[medium]` `[patch]` `MulterFailureFilter` was applied controller-wide, so an oversized body on a non-upload route (reorder, submit) could be mistranslated into the "photo too large" message — moved to the two upload routes' own method-level `@UseFilters`.
  - `[low]` `[patch]` Neither `addPage` nor `retakePage` had int-spec coverage for a request carrying no multipart file part at all — added a case for each asserting the existing `requireBytes` guard's 400 `UNSUPPORTED_IMAGE_FORMAT` response and that no row survives.
  - `[low]` `[patch]` `sourceTestRuntime()` accepted a zero or negative `MAX_PAGE_BYTES` override, silently making every page upload fail rather than refusing to boot as the surrounding comment states the intent to be — added a positivity check alongside the existing integer check.
  - `[low]` `[patch]` `deleteConfirm`'s copy stated "The pages after it are renumbered" even when deleting the last remaining page, where nothing is renumbered — now conditional on whether the deleted ordinal precedes the last one.
  - `[low]` `[patch]` The hand-written partial unique index enforcing one draft per child existed only as raw SQL in the migration, invisible to `schema.prisma` and unverified by any test — added an int-spec assertion that `pg_indexes` still carries it.
  - `[low]` `[patch]` `pageTooLarge` floored the byte limit to whole megabytes, understating the actual enforced limit for any override that is not an exact multiple of 1 MiB — now rounds to the nearest tenth of a MB.
  - `[low]` `[patch]` The "adding" in-flight indicator (`data-testid="adding"`) was asserted only by grepping `page.tsx`'s own source text for the conditional and the copy key, never by anything rendering the page — a regression that silently broke the indicator while leaving those substrings in the file would ship undetected. Added e2e assertions that it becomes visible on upload and hidden once the row lands.
  - `[low]` `[patch]` `retry()` re-issuing both the profile list and the draft open — itself a fix from the prior review pass — had no test forcing the draft-open call to fail and confirming Retry re-issues it, so that exact regression could recur silently. Added an e2e test that fails the draft-open call once via route interception and asserts Retry recovers it.
- rejected findings (noise or already-accepted, not re-addressed):
  - `claimOrdinal`'s contention-exhaustion message reusing `PAGE_LIMIT_REACHED` — already named in this spec's own Residual Risks as a known, accepted imprecision.
  - `PageStrip` rendering an `Uploading` page identically to a `Ready` one — the stranded-row scenario is already named in Residual Risks as Epic 8's to sweep; the submit-gate mismatch that made it actionable is the medium finding above.
  - `canAddPage` existing with different signatures in `source-test-policy.ts` (api) and `page-order.ts` (web) — a deliberate boundary: the web version takes `maxPages` as an argument specifically so it owns no second copy of the server's figure.
  - `ParseUUIDPipe` accepting any UUID version while `ReorderPagesDto` restricts to v4 — no practical impact, since every id in this system is generated as v4.
  - No explicit pixel-dimension ceiling before `sharp` decodes an upload — `sharp`/libvips already refuses input above its default ~178-megapixel limit; a duplicate application-level cap would be redundant.
  - A claimed race between two UI mutations reading a stale `pending` React-state closure — unverified against the actual synchronous event-handling model; the `busy`-disabled controls already close the practical window.
  - `MulterFailureFilter`'s `@Catch` list not covering every conceivable busboy parser error — speculative; no concrete non-`MulterError` failure mode was demonstrated.
  - `retakePage` not guarding a concurrent in-flight `addPage` on the same page id — not reachable: a page id does not exist until `addPage` returns it, so no client (or direct API caller who hasn't seen the id yet) can race a retake against it.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 3: (high 0, medium 0, low 3)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `@nestjs/platform-express` pre-translates every non-size multer/busboy failure (wrong field name, too many files, …) into its own `BadRequestException` carrying multer's raw message verbatim (confirmed live: a wrong-field upload answered `"Unexpected field - notTheFileField"`, not `UNSUPPORTED_IMAGE_FORMAT`) — `MulterFailureFilter` never saw a raw `MulterError` for these, so its non-size branch was dead code. The filter now also catches `BadRequestException`, distinguishing platform-express's own pre-translated multer messages (by their fixed prefixes) from `requireBytes`'s and `ParseUUIDPipe`'s own `BadRequestException`s on the same routes, which pass through untouched. Covered by a new int-spec case posting under a wrong field name.
  - `[low]` `[patch]` `capture.deleted(ordinal)` always announced "The pages after it are renumbered" even when the deleted page was the last one, where nothing renumbers — mirrors a wording bug `deleteConfirm` already had fixed for the same case. `deleted` now takes `(ordinal, total)` and follows the same `ordinal < total` condition; `page.tsx` passes the pre-delete count.

Findings not carried into `addressed_findings` above:
- **Deferred** (see frontmatter `deferred`): the in-flight "adding" indicator and the blocked-state reasons (`limitReached`, `submitBlocked`) render as plain text with no live-region wiring, so a screen-reader user only learns of those state changes on the next unrelated announcement; and `page.tsx`'s own gating/orchestration logic (`isDraft`, `addable`, `submittable`, the ordinal lookups in `retakePage`/`deletePage`) is exercised in `page.spec.tsx` only by grepping the component's source text, not by running it — real behavior is covered by `parent-capture.spec.ts` e2e, but the unit-level proof the story's own "pure functions with colocated specs" language points at is weak for this slice.
- **Rejected as noise or negligible**: `requireDraft`'s expiry check running just before, not inside, each mutating transaction (the window is sub-request-scoped and status alone — not `expiresAt` — gates the transaction's own write, so the exposure is a few milliseconds at most); no cap on concurrent multipart uploads in flight (speculative memory-pressure claim, no demonstrated exhaustion at any realistic scale); `retakePage` completing a page stranded in `Uploading` without flagging the earlier failure (arguably the intended recovery path, not a defect); no direct unit test for `liveAt()` (indirectly covered via `isExpired` and the int-spec); `.env.example` not mentioning the zero/negative `MAX_PAGE_BYTES` refusal, and `UPLOAD_ROOT`/`MAX_PAGE_BYTES` not being documented as boot-time-only (both minor doc completeness, not required); no one-step "discard this draft" affordance (Epic 8 owns deletion semantics deliberately, per this story's own Never list); a garbled sentence in the generated `epic-3-context.md` cache ("Carry the n-electric fix around `meta.autoOrient` width handling") — a planning-cache artifact, not corrected without knowing the intended text; and `review_loop_iteration: 0` looking stale next to two same-day triage-log entries — by design, this workflow resets that counter on every `done → in-review` transition.

## Design Notes

**Why this story carries the substrate.** Story 3.1 is not implemented, so there is no Source Test, no Page Image, and no page-add path. Page management cannot be observed without them. The line drawn: this story owns the rows, the ingest pipeline, and everything that reorders, retakes, deletes or gates. Story 3.1 keeps the camera viewfinder, the continuous-capture loop, library multi-select, camera-denied guidance, and the inverted-surface tokens that go with them. Ingest lands here rather than being stubbed because AD-28 forbids a row leaving `Uploading` un-normalized, and a stub would put a format the vision model cannot read one story away from an AI call.

**Ordinal rewrite under a unique constraint.** `@@unique([sourceTestId, ordinal])` is what makes "contiguous 1..N" enforceable rather than merely intended, but a straight rewrite collides mid-statement. Two phases in one transaction:

```ts
await tx.$executeRaw`UPDATE page_image SET ordinal = -ordinal WHERE "sourceTestId" = ${id}`;
for (const [index, pageId] of orderedIds.entries()) {
  await tx.pageImage.update({ where: { id: pageId }, data: { ordinal: index + 1 } });
}
```

**Reorder is an explicit permutation, not a move.** `PUT /pages/order` takes the full `pageIds` array; the client computes the move with `movedOrder` and sends the result. A body that is not a permutation of the stored ids is rejected whole. This makes the "order is explicit" criterion literal in the wire format, and keeps the server free of a direction vocabulary it would otherwise have to keep consistent with the UI.

**HEIC.** `ALLOWED_MIMES` includes `heic`/`heif` per AD-28, but whether the installed libvips can decode them is a platform fact. If `sharp` throws on such a buffer, answer 415 with `UNSUPPORTED_IMAGE_FORMAT` and leave no `Ready` row; making HEIC actually decode is Story 3.1's acceptance criterion, not this one.

## Verification

**Commands:**
- `pnpm install` -- expected: `sharp`, `file-type`, `multer` resolve for the `api` workspace.
- `pnpm --filter api exec prisma migrate dev --name add_source_test` -- expected: a new checked-in migration directory; `prisma migrate deploy` replays it clean on the test database.
- `pnpm typecheck` -- expected: no errors in either workspace.
- `pnpm lint` -- expected: clean, `jsx-a11y` included.
- `pnpm test` -- expected: the new `source-test-policy.spec.ts` and `page-order.spec.ts` pass with the rest.
- `pnpm --filter api run test:int` -- expected: `source-test.int-spec.ts` passes against real Postgres, every I/O matrix row covered.
- `pnpm e2e` -- expected: `parent-capture.spec.ts` passes against the full stack.
- `pnpm prettier --write .` -- expected: clean tree before commit.

## Auto Run Result

**Summary:** Story 3.2 (page management before submit) was implemented, reviewed, and patched in two prior review passes. This is a third, fresh review pass over the same diff (baseline `b38a804`): four parallel reviewers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) found 14 distinct issues after dedup; 2 were patched, 3 deferred, 9 rejected as noise or negligible.

**Files changed in this pass:**
- `apps/api/src/sourcetest/source-test.controller.ts` -- `MulterFailureFilter` now also catches `BadRequestException`, restating `@nestjs/platform-express`'s own pre-translated non-size multer/busboy failures (wrong field name, too many files, …) as `UNSUPPORTED_IMAGE_FORMAT` instead of leaking multer's raw message, while passing `requireBytes`'s and `ParseUUIDPipe`'s own `BadRequestException`s through untouched.
- `apps/api/test/source-test.int-spec.ts` -- new case: a wrong-field-name upload is answered 400 `UNSUPPORTED_IMAGE_FORMAT`, not the size refusal, and creates no row.
- `apps/web/src/copy/parent.ts` -- `capture.deleted` now takes `(ordinal, total)` and only claims "the pages after it are renumbered" when `ordinal < total`, matching `deleteConfirm`'s existing wording rule.
- `apps/web/src/app/parent/capture/page.tsx` -- `deletePage` passes the pre-delete page count into `capture.deleted`.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- covers both branches of `capture.deleted`.

**Review findings breakdown:**
- Patch (applied): 2 -- 1 medium (`MulterFailureFilter` dead non-size branch, confirmed live by the new int-spec case before the fix), 1 low (last-page delete announcement wording).
- Defer (added to frontmatter `deferred`): 3 -- the api integration suite's cross-file flakiness and the parent-auth E2E strict-mode collision (both pre-existing, carried from earlier passes), plus two new items: unannounced in-flight/blocked-state copy, and `page.tsx`'s own gating logic being covered only by source-text grep rather than real execution.
- Reject: 9 -- see the triage log's "Findings not carried into addressed_findings" note for the full list and reasoning (expiry TOCTOU outside the mutating transaction, speculative upload-concurrency memory pressure, `retakePage` completing a stranded `Uploading` row, missing direct `liveAt()` unit test, two minor `.env.example`/doc-completeness gaps, no one-step draft-discard affordance (explicitly out of scope), a garbled sentence in the generated `epic-3-context.md` cache, and the `review_loop_iteration` reset being by design).
- Follow-up review recommendation: `false`. Only this pass's patched findings count: 1 medium + 1 low → `3×1 + 1×1 = 4`, below the 5 threshold, and neither patched finding was high severity.

**Verification performed:**
- `pnpm --filter api exec vitest run test/source-test.int-spec.ts` -- 30/30 passed, including the new multer-failure case.
- `pnpm test` (full workspace) -- 266/266 web tests, 415/415 api tests (unit + every int-spec file), all passed in this run.
- `pnpm typecheck` -- clean in both workspaces.
- `pnpm --filter api run lint` and `pnpm --filter web run lint` -- both clean (root `pnpm lint` via turbo could not resolve the `eslint` binary in this environment; per-package invocation is the equivalent check and passed).
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- 4/4 passed.
- `pnpm exec prettier --write .` -- ran clean across the tree.

**Residual risks:** Unchanged from the prior passes' own Residual Risks, plus the three items newly deferred above (see frontmatter `deferred`). No new residual risk was introduced by this pass's two patches: both are narrow, additive corrections (a message-translation branch, and an announcement's wording condition) verified by passing tests.

