---
title: 'Story 3.1: Multi-Page Capture (camera + library)'
type: 'feature'
created: '2026-09-26'
baseline_revision: '183c6e5c0d0bb749e16b2ed03c2c10f6fa844608'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The retake file input in PageStrip still offers the `image/*` wildcard, while the
      page-add input now offers the explicit four-format list.
    evidence: |-
      `ACCEPTED_IMAGE_TYPES` exists because `image/*` lets a parent pick a GIF or TIFF the
      server then refuses, and because some iOS pickers report no usable type for HEIC.
      `apps/web/src/app/parent/capture/PageStrip.tsx` keeps the wildcard, so half the
      photo-choosing surface on this screen behaves the way the new module calls wrong.
      Pre-existing: it shipped with Story 3.2, and Story 3.1's intent constrains how the
      server decides a format, not what the retake picker offers.
    location: >-
      apps/web/src/app/parent/capture/PageStrip.tsx:130
    severity: low
  - summary: >-
      The HEIF branch discards the source colour profile, so a Display P3 HEIC is
      reinterpreted as sRGB.
    evidence: |-
      libheif returns raw RGBA with no ICC profile attached, and `sharp` treats raw input as
      sRGB. iPhone HEICs are commonly Display P3, so colour shifts on exactly the format the
      branch exists to support. The ordinary `sharp(buffer)` branch keeps its profile. Low
      impact for extraction, which reads text rather than colour.
    location: >-
      apps/api/src/sourcetest/page-ingest.service.ts
    severity: low
  - summary: >-
      The disabled shutter drops below the 3:1 contrast floor on the inverted ground.
    evidence: |-
      `'&:disabled': { opacity: 0.5 }` over `primaryOnInverted` on `backgroundInverted`
      halves a 7.70:1 pair, and no token or test covers the disabled appearance. Every other
      colour decision on this surface was measured; this one was not.
    location: >-
      apps/web/src/app/parent/capture/CameraViewfinder.tsx
    severity: low
  - summary: >-
      No Playwright coverage drives the camera or a multi-file library selection, so the
      stream lifecycle and the capture encode are verified only structurally.
    evidence: |-
      `apps/web` runs `environment: 'node'`, so the double-press guard, the `getUserMedia`
      race, the track-ended handler, and the canvas-to-JPEG encode are asserted against
      source text rather than driven. `e2e/tests/parent-capture.spec.ts` contains no
      occurrence of `camera`, `getUserMedia`, or `viewfinder`, and every `setInputFiles` call
      there passes exactly one file. Pinning these needs a browser launched with fake media
      devices and a granted camera permission.
    location: >-
      e2e/tests/parent-capture.spec.ts
    severity: medium
  - summary: >-
      The api unit specs cannot run without Postgres, because they share a vitest project
      with the integration tier.
    evidence: |-
      `apps/api/vitest.config.ts` includes both `src/**/*.spec.ts` and
      `test/**/*.int-spec.ts`, and `test/global-setup.ts` connects to Postgres and runs
      `prisma migrate deploy` for either. The new pure `normalize` spec is among the
      fastest tests in the repo and among the slowest to start. Pre-existing and
      repo-wide.
    location: >-
      apps/api/vitest.config.ts
    severity: low
  - summary: >-
      A captured frame's canvas size is unbounded, so a high-resolution camera can post a
      page well past the sizes the library path implicitly stays under.
    evidence: |-
      `CAPTURE_IDEAL_WIDTH`/`CAPTURE_IDEAL_HEIGHT` in `AddPages.tsx` are `ideal` hints, not a
      cap, and `capture()` sizes the canvas straight from `video.videoWidth`/`videoHeight`
      with no client-side check against `MAX_PAGE_BYTES` or `MAX_DECODED_PIXELS`. A device
      reporting a much higher native resolution would still post, and only the server's own
      limits would catch it.
    location: >-
      apps/web/src/app/parent/capture/AddPages.tsx
    severity: low
  - summary: >-
      `CameraViewfinder`'s shutter gate mirrors the page cap but not `editable`, so the
      shutter is not provably disabled if the upload stops being editable while the
      viewfinder is still open.
    evidence: |-
      `AddPages` computes `addable = editable && !full` to gate opening the camera and the
      library input, but `CameraViewfinder` receives only `busy`/`pageCount`/`maxPages` and
      derives its own `full = pageCount >= maxPages`, with no `editable` input at all. No
      test drives a viewfinder that is already open at the moment `editable` turns false, so
      whether that transition is reachable from the surrounding screen, and what the shutter
      does if it is, is unverified.
    location: >-
      apps/web/src/app/parent/capture/CameraViewfinder.tsx
    severity: low
  - summary: >-
      If the attached stream never produces a frame, the shutter silently no-ops with no
      guidance shown.
    evidence: |-
      `capture()` returns early when `video.videoWidth`/`videoHeight` are both `0`, which is
      correct — it stops a blank page from being posted — but nothing tells the parent why
      the shutter did nothing in that state, and no test exercises a stream that opens but
      never produces a frame.
    location: >-
      apps/web/src/app/parent/capture/AddPages.tsx
    severity: low
  - summary: >-
      `decodeHeic` has no timeout, so a pathological HEIC container could hang the ingest
      request indefinitely.
    evidence: |-
      `decodedPipeline` awaits `decodeHeic({ buffer })` directly; a crafted or corrupt
      container that causes libheif to loop rather than throw would hold the request open
      with nothing to bound it. Lower risk than an unauthenticated surface would carry, since
      only a signed-in parent can reach this route, but the code path is new with this story.
    location: >-
      apps/api/src/sourcetest/page-ingest.service.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent can only add pages to a Source Test through a single-file `<input type="file">` that Story 3.2 left as a placeholder: there is no camera viewfinder, no continuous capture, no photo-library multi-select, and no guidance when the camera is unavailable or denied. Server-side, HEIC/HEIF is on the allow-list but is *rejected* rather than converted, because this platform's prebuilt `sharp`/libvips decodes only AVIF out of the HEIF family — so an ordinary iPhone photo cannot be uploaded at all.

**Approach:** Add a real capture surface in `apps/web` — an inverted-surface camera viewfinder that stays open across pages, plus a first-class multi-select library input beside it and plain guidance when the camera cannot be used — and close the HEIC/HEIF gap in `PageIngestService` with a `heic-decode` branch ahead of `sharp`. Both post to the existing `POST /parent/source-tests/:id/pages` route; no route, schema, or allowance behaviour changes.

## Boundaries & Constraints

**Always:**
- Format is decided by `fileTypeFromBuffer` against `ALLOWED_MIMES`; the client-declared `content-type` is never read. HEIC/HEIF is converted to JPEG q85 server-side before the row leaves `Uploading`. EXIF orientation is honoured and stored dimensions are read off the **output**.
- Camera adds one page at a time; library multi-select adds every chosen photo in one parent action, appended in selection order. Both append to the end and mix freely; nothing downstream records or surfaces which path a page came from.
- 1–10 pages, enforced from `SourceTestView.maxPages` — the web app never writes the ceiling as a literal. A selection larger than the remaining slots is trimmed, and both the accepted and the rejected counts are announced.
- Camera unavailable, denied, or absent is never a dead end: the library control stays enabled and the guidance names how to re-enable camera access.
- Viewfinder chrome takes `backgroundInverted` / `primaryOnInverted` / `dividerOnInverted` / `textOnInverted` and nothing else. These are mode-invariant deliberate duplicates: never alias, collapse, or "correct" them to the light parent palette (UX-DR4).
- Every user-facing string comes from `apps/web/src/copy/parent.ts`; every control meets `density.tapTarget` with a visible focus ring; the viewfinder's `<video>` carries an accessible name.
- Media tracks are stopped whenever the viewfinder closes, the component unmounts, or Parent View ends.

**Block If:**
- `heic-decode@2.1.0` cannot be resolved for the `api` workspace from the local pnpm store and no network install is possible.

**Never:**
- Do not serve stored page bytes or render server-side thumbnails — no image-serving endpoint exists and none ships here; the strip stays ordinal-text, as Story 3.2 built it.
- Do not change the page routes, the DTOs, the Prisma schema, the 72h TTL, the legibility check (3.4), or Upload Allowance accounting.
- Do not touch the reorder / retake / delete behaviour in `PageStrip`.
- Do not restore the preserved attempt `refs/attempt-preserve-dirty/20260923-210321-45b5-b38a8047-2` as a diff: it is parented 13 commits back and predates the rest of Epic 3. Read it for intent only.
- No `any`, no `@ts-expect-error`, no new dark-mode-tracking token for the viewfinder.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Camera capture | Draft with 2 pages, viewfinder open, shutter pressed | One page appended as page 3; viewfinder stays open; count line and strip update from the server's answer | Failed POST shows the copy error, strip unlocks, viewfinder stays open |
| Library multi-select, fits | Draft with 0 pages, 3 photos chosen in one action | 3 pages appended as 1,2,3 in selection order; one announcement stating 3 were added | Any file failing mid-run reports the failure; pages already accepted stay |
| Library multi-select, over cap | Draft with 9 pages, `maxPages` 10, 3 photos chosen | Only the first is added; announcement states 1 added and 2 not added | No request is sent for the trimmed files |
| HEIC photo | `POST .../pages` with HEIC bytes | Sniffed `image/heic`, decoded via `heic-decode`, stored as `image/jpeg`, row reaches `Ready`, dimensions match the decoded image | — |
| JPEG with EXIF orientation 6 | Rotated iPhone JPEG | Stored upright; `width`/`height` are the rotated output's, not the input's | — |
| Bytes that are not an allowed image | PDF bytes posted as `image/jpeg` | 415 with the format rule only; no `Ready` row, no stored file | `UnsupportedImageFormat` → `BadRequestException`/415 as today, message carries no filename or byte |
| `navigator.mediaDevices` absent | Non-secure or unsupported browser | No viewfinder; `cameraUnavailable` + `cameraFallback` shown; library input enabled | — |
| Camera permission refused | `getUserMedia` rejects `NotAllowedError` | Viewfinder closes; `cameraDenied` guidance naming site settings shown; library input enabled | Any other rejection is reported as `cameraUnavailable` |
| Cap reached | Draft with `maxPages` pages | Camera and library controls disabled; `limitReached(max)` shown | — |

</intent-contract>

## Code Map

- `apps/api/src/sourcetest/page-ingest.service.ts` -- `normalize()` (L70-95) sniffs with `fileTypeFromBuffer` then `sharp(buffer).rotate().jpeg({quality: JPEG_QUALITY})`. The `catch` at L79-86 is where HEIC currently dies; the HEIC branch goes **before** the `sharp` call. `write`/`read`/`remove` derive paths from the row id and are untouched.
- `apps/api/src/sourcetest/source-test-policy.ts` -- `MAX_PAGES` 10 (L23), `ALLOWED_MIMES` already lists `image/heic` + `image/heif` (L40-46), `STORED_MIME` `image/jpeg` (L49), `JPEG_QUALITY` 85 (L51), `isAllowedMime` (L284), `storagePathFor` (L195). Read-only.
- `apps/api/src/sourcetest/source-test.controller.ts` -- `@Post(':id/pages')` (L197) with `pageUpload()` `limits.files: 1` and `MulterFailureFilter`. Its comment already names this story as the caller. Read-only: one file per request stays the wire contract; multi-select loops client-side.
- `apps/api/vitest.config.ts` -- `src/**/*.spec.ts` + `test/**/*.int-spec.ts`, `environment: 'node'`, `globalSetup` creates the test database (Postgres container `n-test-reviewer-postgres` is up).
- `apps/web/src/app/parent/capture/page.tsx` -- `write()` (L382-403) is the single mutation path and **drops a call while `pending !== null`**, so a multi-file add must be ONE `write('add', …)` whose `run` loops. `addPage(file)` L473-481. The placeholder file input to replace is L774-798 (`id="capture-add-page"`, `accept="image/*"`, single file); `addable`/`maxPages`/`limitReached` at L432-438 and L800-804.
- `apps/web/src/app/parent/capture/PageStrip.tsx` -- exports `controlSx` (L16) and `ORDER_HEADING_ID` (L27); reuse both. Hook-free by design so static markup can be asserted.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- the test idiom: `renderToStaticMarkup` under `ThemeProvider` + assertions against `PAGE_SOURCE` read off disk. `apps/web` runs with `environment: 'node'` and no DOM, so camera behaviour must be reachable through props and pure helpers.
- `apps/web/src/copy/parent.ts` -- the existing `capture:` block is L211-312 (`addPage`, `adding`, `limitReached`, `added(ordinal)`, `addFailed` L355). New strings extend this block; do **not** add a second `capture:` key.
- `apps/web/src/theme/tokens.ts` -- `colorTokens` (L11-30) is `Record<string, TokenPair>`; `token(name, scheme)` L35. `apps/web/src/theme/theme.ts` `paletteFor` picks tokens by name, so extra keys are inert. `apps/web/src/theme/theme.spec.ts` L85-90 asserts every token has a 6-digit hex light **and** dark value.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md` L43-54, L432-434 -- the on-inverted token values and the closed-exception rule. `mockups/key-capture.html` L143-147 measures white at 16.56:1 on the viewfinder ground and is the source for `textOnInverted`; its State 1 copy is "Capture pages", "Fill the frame with page 3", "Pages captured", "Camera roll", "Done".
- `refs/attempt-preserve-dirty/20260923-210321-45b5-b38a8047-2` -- intent evidence only. Useful verbatim: its `tokens.ts` inverted-token comment block and its `parentCopy.capture` camera/library strings. It contains **no** capture component and **no** spec.

## Tasks & Acceptance

**Execution:**
- `apps/api/package.json` -- add `"heic-decode": "2.1.0"` to `dependencies` -- `sharp`'s prebuilt libvips decodes only AVIF from the HEIF family; verified present in the local pnpm store, so `pnpm install --offline` resolves it.
- `apps/api/src/types/heic-decode.d.ts` -- new ambient module declaring `decode({buffer}): Promise<{width, height, data: Uint8ClampedArray}>` -- the package ships no types and `any` is forbidden. Take the snapshot's version verbatim.
- `apps/api/test/fixtures/sample-page.heic` -- restore from the preserved ref (`git show <ref>:apps/api/test/fixtures/sample-page.heic`) -- a real 64×64 HEIC, already verified to decode.
- `apps/api/src/sourcetest/page-ingest.service.ts` -- in `normalize()`, when the sniffed mime is `image/heic` or `image/heif`, decode to RGBA and feed `sharp(data, {raw: {width, height, channels: 4}})` instead of the buffer, then JPEG q85 as today; a decode failure raises the same `UnsupportedImageFormat` -- HEIC/HEIF must be converted, not refused. No `rotate()` on that branch: libheif applies the container's own `irot`/`imir` while decoding, and raw input carries no EXIF.
- `apps/api/src/sourcetest/page-ingest.service.spec.ts` -- new unit spec over `normalize`: HEIC fixture converts to `image/jpeg` at the decoded dimensions; a synthesised orientation-6 JPEG comes back upright with swapped dimensions; empty, PDF, and truncated-HEIC buffers all raise `UnsupportedImageFormat`; the thrown message equals the passed-in rule string and nothing else -- the matrix's ingest rows.
- `apps/web/src/theme/tokens.ts` -- add `backgroundInverted` `#10202E`, `primaryOnInverted` `#7FB6E8`, `dividerOnInverted` `#6A747E`, `textOnInverted` `#FFFFFF`, each with **identical** light and dark values and the deliberate-duplicate comment -- an inverted surface is dark in both schemes, so it must not track either palette.
- `apps/web/src/copy/parent.ts` -- extend the existing `capture:` block with the camera and library strings (viewfinder heading and accessible name, per-page framing guidance, shutter, close, library label, `addedCount`, `rejectedCount`, `cameraUnavailable`, `cameraDenied`, `cameraFallback`, `useCamera`) -- no user-facing literal in a component.
- `apps/web/src/lib/library-selection.ts` -- new pure module: `ACCEPTED_IMAGE_TYPES` (the four formats, as an `accept` string) and `splitSelection(files, pageCount, maxPages)` returning `{accepted, rejectedCount}` in selection order -- the cap rule has to be assertable without a DOM.
- `apps/web/src/lib/library-selection.spec.ts` -- new spec: selection order preserved, trimmed at the remaining slots, empty selection yields nothing, a full draft accepts nothing, `accept` names HEIC -- the two library matrix rows.
- `apps/web/src/app/parent/capture/CameraViewfinder.tsx` -- new hook-free presentational component: inverted-surface chrome (ground, divider border, accent, text from the new tokens), a `<video>` with an accessible name, the framing guidance naming the next ordinal, the live `count of max` line, a shutter and a Done control at `controlSx` -- hook-free so the static-markup tests can assert the accessibility and token rules.
- `apps/web/src/app/parent/capture/AddPages.tsx` -- new client component owning camera availability (`'unknown' | 'ready' | 'denied' | 'unavailable'`), the `getUserMedia` stream and its teardown, the viewfinder open/close state, canvas-to-`File` capture, and the multi-select library input; renders the guidance and fallback copy per status and calls `onAdd(files)` with an ordered array -- the story's whole interaction, isolated from the screen's other concerns.
- `apps/web/src/app/parent/capture/page.tsx` -- replace the placeholder input block with `<AddPages …/>`; change `addPage(file)` to `addPages(files)` performing ONE `write('add', …)` that POSTs each file in order and announces from the final server view -- `write` drops a second call while one is pending, so a per-file loop over `write` would silently lose pages.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- extend: viewfinder markup carries the inverted token values and not the light parent primary; the `<video>` is named; shutter and Done meet the tap-target floor; each camera status renders its own guidance while the library input stays enabled; the screen's source uses `AddPages` and no longer carries `accept="image/*"` -- the three camera matrix rows.

**Acceptance Criteria:**
- Given the viewfinder is open, when a page is captured and the POST succeeds, then the viewfinder is still open and the count line reflects the server's page total, so the next page can be captured without reopening the camera.
- Given a draft below the cap, when pages are added by camera and by library in any interleaving, then the resulting order is the order they were added and no surface distinguishes which control added a page.
- Given a page is being added, when the add is in flight, then the shutter, the library input, and the whole strip are locked and the screen says an add is in progress.
- Given the viewfinder is closed, the component unmounts, or Parent View ends, when that happens, then every media track obtained by this screen is stopped.
- Given the new inverted tokens, when the codebase is searched, then only the camera viewfinder chrome reads them, and their light and dark values are identical.

## Spec Change Log

## Review Triage Log

### 2026-09-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 18: (high 0, medium 8, low 10)
- defer: 5: (high 0, medium 1, low 4)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` `onStreamStopped` was a dead prop whose presence in `stopStream`'s dependency list would have let an inline callback tear down a live stream on any re-render — prop, doc, and call deleted.
  - `[medium]` `[patch]` A second shutter press before `canvas.toBlob` resolved produced two `onAdd` calls, the second of which `write` silently drops — guarded with a `capturing` ref cleared as the callback's first statement, null-blob path included.
  - `[medium]` `[patch]` A stream resolving after unmount, close, or a superseding open was stored after cleanup had run, leaving the camera on — liveness and generation refs now stop such a stream on the spot, and `openCamera` is a no-op while one is held.
  - `[low]` `[patch]` A track ending mid-session (permission revoked, device unplugged) left a frozen viewfinder whose shutter posted blank pages — an `ended` listener now stops the stream, closes the surface, and shows the `unavailable` guidance.
  - `[medium]` `[patch]` `getUserMedia` requested no resolution, so a camera page could reach the vision model at 640x480 beside multi-megapixel library photos — an `ideal` 1920x1440 hint added as named constants.
  - `[low]` `[patch]` The trim announcement was overwritten by the add announcement in the single-message live region — both halves now stated in one sentence via `capture.addOutcome`.
  - `[low]` `[patch]` `libraryLabel` said "Camera roll", which names nothing on Android or desktop, and its redundant `aria-label` announced the control twice — reworded, and the visible label left as the sole accessible name.
  - `[low]` `[patch]` `SecurityError` was mapped to `denied` but neither documented nor asserted — doc corrected and the mapping covered.
  - `[medium]` `[patch]` A multi-file add that failed part-way left the strip showing the pre-add list although rows existed on the server, and said nothing about what landed — the run now reflects the server's last answer and states the count that actually landed; `addedCount` guards a zero or negative delta.
  - `[low]` `[patch]` `capture.addPage` and `capture.added` lost their last caller when `AddPages` replaced the placeholder input, while a test still pinned `added`'s wording — both strings and that assertion removed.
  - `[medium]` `[patch]` The positive inverted-token assertion was vacuous: it read markup still carrying the emotion global stylesheet, which emits every palette token — routed through `withoutGlobalStyles`, and the vacuity confirmed by probe before the fix.
  - `[medium]` `[patch]` The tap-target assertion matched `min-height` anywhere in the document rather than on a control — a `stylesFor()` helper now resolves the control's own emotion rules; the floor is 44px, and the original figure was wrong as well as unscoped.
  - `[low]` `[patch]` The token-exclusivity check read two files, so any other file could claim the on-inverted set unnoticed — it now walks `apps/web/src` and checks both the token names and their resolved hex values.
  - `[medium]` `[patch]` `decodeHeic` allocated `width * height * 4` before any dimension check, and the raw pipeline bypasses sharp's `limitInputPixels` — a `MAX_DECODED_PIXELS` ceiling now rejects oversized decodes with the same `UnsupportedImageFormat`.
  - `[low]` `[patch]` The widened catch swallowed decoder faults with no trace — the error class is now logged at `warn`, carrying nothing from the buffer.
  - `[medium]` `[patch]` The 64x64 fixture made the raw descriptor unobservable: transposing `raw: {width, height}` would still match the buffer length and pass — a mocked non-square decode over real HEIC bytes now proves the descriptor's orientation.
  - `[low]` `[patch]` The "sharp alone rejects HEIC" assertion asserted a property of this machine's libvips build — made conditional on `sharp.format.heif`.
  - `[medium]` `[patch]` PNG and WebP sniff paths were untested and nothing proved the decision is made on bytes rather than the declared type — unit cases added for both formats, plus route-level integration cases converting a real HEIC and accepting a PNG declared `application/pdf`. Fixture provenance and dimensions recorded at the point of use.

### 2026-09-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 4: (high 0, medium 0, low 4)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` The pixel-ceiling rejection threw a plain `Error`, so its logged class name was indistinguishable from any other decode fault — given its own `DecodedPixelCeilingExceeded` class, and a test proving the comparison is `>` and not `>=` at the exact ceiling.
  - `[low]` `[patch]` No test asserted the decode-failure log line actually fires or stays within AD-20 (no rule text, no filename) — a spec added that spies on `Logger.prototype.warn` and checks both.
  - `[low]` `[patch]` Two clicks on "Use the camera" before the first `getUserMedia` call resolved could both proceed, since the only guard checked a stream that had not been stored yet — an `openingRef` now closes that window, held for the whole request and cleared in a `finally`.

## Design Notes

**Why no thumbnails.** Stored page bytes are never served — no endpoint exists, and Story 3.2's copy states the strip's visible identity is the ordinal. The viewfinder therefore shows the live camera and the count; captured pages appear in the existing ordinal strip. UX-DR25's expired-tile state belongs to whichever story first serves image bytes, not here.

**Why one request per page.** The controller pins `limits.files: 1` and the route is `POST …/pages` (singular). Multi-select is a single *parent action*, not a single request: `AddPages` hands the screen an ordered array and the screen posts them sequentially inside one `write`, which both preserves ordinals and keeps the strip locked for the whole run.

**The HEIC branch, in shape:**

```ts
const sniffed = await fileTypeFromBuffer(buffer);
if (!isAllowedMime(sniffed?.mime)) throw new UnsupportedImageFormat(unsupportedMessage);
// libvips here decodes only AVIF from the HEIF family, so HEIC goes through
// libheif and enters sharp as raw RGBA — already upright, no EXIF to honour.
const pipeline = isHeif(sniffed!.mime)
  ? sharp((await decodeHeic(buffer)).raw, { raw: { width, height, channels: 4 } })
  : sharp(buffer).rotate();
```

## Verification

**Commands:**
- `pnpm install --offline` -- expected: `heic-decode` resolves for the `api` workspace from the local store; the lockfile updates. Fall back to `pnpm install` only if the offline resolve fails.
- `pnpm typecheck` -- expected: clean in both workspaces, with the `heic-decode` shim supplying the types.
- `pnpm lint` -- expected: clean, `jsx-a11y` included.
- `pnpm test` -- expected: the new `page-ingest.service.spec.ts`, `library-selection.spec.ts`, and the extended `page.spec.tsx` pass with the rest; `theme.spec.ts` still passes with the four new tokens.
- `pnpm --filter api run test:int` -- expected: the existing `source-test.int-spec.ts` still passes against real Postgres.
- `pnpm prettier --write .` -- expected: clean tree before commit.

**Manual checks (if no CLI):**
- `grep -rn "OnInverted\|backgroundInverted" apps/web/src` -- expected: `tokens.ts` and the viewfinder component only.

## Auto Run Result

Status: done

### Summary

A fresh review pass over the already-`done` diff at `183c6e5c0d0bb749e16b2ed03c2c10f6fa844608..HEAD` (four parallel layers: blind hunter, edge-case hunter, verification-gap, intent-alignment). No intent gap, no spec defect. 3 patches applied this pass, 4 items deferred, 10 rejected as noise or already covered.

### Files changed this pass

- `apps/api/src/sourcetest/page-ingest.service.ts` — the pixel-ceiling rejection now raises a named `DecodedPixelCeilingExceeded` instead of a plain `Error`, so its logged class name is distinguishable from any other decode fault.
- `apps/api/src/sourcetest/page-ingest.service.spec.ts` — two new tests: the decode-failure log line stays within AD-20 (spying on `Logger.prototype.warn`), and the pixel ceiling is `>` and not `>=` at the exact boundary.
- `apps/web/src/app/parent/capture/AddPages.tsx` — an `openingRef` guard closes the window where two clicks on "Use the camera" before the first `getUserMedia` call resolved could both proceed.
- `apps/web/src/app/parent/capture/page.spec.tsx` — one new source-text test for the `openingRef` guard, and the pre-existing "refuses to open a second camera" assertion updated to match the widened guard condition.

### Review findings breakdown

- patch: 4 (all low) — applied.
- defer: 4 (all low) — added to spec frontmatter `deferred`.
- reject: 10 (all low) — dropped, including two claims (unbounded HEIC pixel-ceiling allocation timing, `isHeif` mime coverage) that the code's own design comments and the existing `ALLOWED_MIMES` allow-list already address, and three restatements of the pre-existing deferred item that camera/multi-select logic in `AddPages.tsx` is verified by source-text assertion rather than by driving the component (no new deferred entry added for these — same claim, same required action as the item already on file).

### Follow-up review recommendation

`false`. Patched this pass: high 0, medium 0, low 4. Score = 3 × 0 + 1 × 4 = 4, under the threshold of 5.

### Verification performed

- `pnpm typecheck` — clean, both workspaces.
- `pnpm turbo run lint --force` — clean, cache bypassed.
- `pnpm --filter web test` — 32 files, 611 passed (94 in `capture/page.spec.tsx`, including the new guard test and the updated assertion).
- `pnpm --filter api exec vitest run src/sourcetest/page-ingest.service.spec.ts` — 14 passed, including the two new tests.
- `pnpm --filter api exec vitest run test/source-test.int-spec.ts` — 66 passed against real Postgres, unaffected by this pass's changes.
- `pnpm --filter api test` (full run) — 4 failures, all in `practice-test.int-spec.ts` and `student-mode.int-spec.ts`, unrelated to this story's files; matches the pre-existing shared-test-data flakiness this spec's prior `done` pass already documented and attributed to non-story causes.
- `pnpm prettier --write` on every file touched this pass — no changes needed.

### Residual risks

Unchanged from the prior pass, plus the four newly deferred items above (camera capture resolution has no client-side ceiling; the viewfinder's shutter gate does not itself observe `editable`; a stream that never yields a frame leaves the shutter silently inert; `decodeHeic` has no timeout). All four are low severity and none blocks this story.

