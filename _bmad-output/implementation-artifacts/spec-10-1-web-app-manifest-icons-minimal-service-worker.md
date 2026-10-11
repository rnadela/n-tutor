---
title: 'Story 10.1: Web App Manifest, Icons & Minimal Service Worker'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_revision: 'ce9d8270147f0e330540d1259c192be9a59d9f4d'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/apps/web/AGENTS.md']
warnings: ['oversized']
deferred:
  - summary: >-
      The product's family-facing name is stated three times and the three
      disagree: the installed app is "n-tutor" while every in-app surface says
      "n-test-reviewer".
    evidence: |-
      `commonCopy.appName` is 'n-tutor' (the name Story 10.1's acceptance
      criteria require on the home screen), while `parentCopy.appName` is
      'n-test-reviewer' (rendered by AuthBrand and ParentSidebarChrome) and
      `adminCopy.appName` is 'n-test-reviewer Admin', which is still the root
      layout's `metadata.title` on every page. Pre-existing naming drift that
      this story surfaces rather than causes: renaming the product is a
      product decision, not a PWA change.
    location: >-
      apps/web/src/copy/parent.ts:79, apps/web/src/copy/admin.ts:7, apps/web/src/app/layout.tsx:14
    severity: medium
  - summary: >-
      The manifest declares no `id`, so app identity is derived from
      `start_url` and a later `start_url` change would install a second app.
    evidence: |-
      `manifest.ts` omits `id`. Browsers fall back to `start_url` for identity;
      once families have installed, the identity cannot be changed
      compatibly. Nothing in the story asks for it, and `start_url` is `/`
      with no reason to move, so it is a future-proofing item rather than a
      defect in this change.
    location: >-
      apps/web/src/app/manifest.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** `apps/web` ships no web app manifest, no app icons, no `theme-color` and no service worker, so no browser ever offers "Install" / "Add to Home Screen" and a family cannot open n-tutor from a home screen.

**Approach:** Add the installability surface only — a Next.js `app/manifest.ts` metadata route, a generated-in-repo placeholder icon set, `viewport.themeColor` in the root layout, and one static service worker at `/sw.js` that exists purely so browsers consider the app installable: install/activate handlers, no `fetch` handler, no caching, no push.

## Boundaries & Constraints

**Always:**
- Manifest is the Next.js metadata route `apps/web/src/app/manifest.ts` typed as `MetadataRoute.Manifest`, with `name`/`short_name` `n-tutor`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`.
- `theme_color` and `background_color` read from `@/theme/tokens` (`colorTokens`), never hardcoded hex.
- `viewport.themeColor` in the root layout carries one entry per color scheme, both from `colorTokens`.
- The app name is a copy-module string (`src/copy/common.ts`), not a literal in the manifest route (AD-32: no user-facing literal inside a module that renders).
- `/sw.js` has install + activate listeners only, calls `skipWaiting()` and `clients.claim()`, and registers at scope `/`.
- Every icon and the manifest are self-hosted from this repo; no runtime CDN fetch (UX-DR5).
- Icons are real PNG bytes committed to the repo, produced by a dependency-free in-repo generator script so the placeholder art is reproducible and replaceable.
- Unit-testable logic (registration decision, manifest shape) lives in plain modules with specs; `apps/web` runs vitest with `environment: 'node'`, so no spec may need a DOM beyond a hand-written stub.

**Block If:**
- Making the icons would require adding a runtime or dev dependency (no new dependencies are permitted by this change).
- A caching or `fetch`-handling service worker is needed to make the app installable in a target browser.

**Never:**
- No `fetch` handler, no Cache Storage, no precache, no offline page, no push subscription, no `next-pwa`/Workbox or any other new dependency (AD-35).
- No change to offline behavior: FR-36 remains the only offline carve-out.
- No install banner — that is Story 10.2.
- No new color tokens, no new density/spacing figures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Supporting browser | `navigator.serviceWorker` present | `register('/sw.js', { scope: '/' })` called exactly once | No error expected |
| No service-worker support | `navigator` without `serviceWorker` | No registration attempted, nothing thrown | Returns without acting |
| Registration rejects | `register` returns a rejected promise | Rejection swallowed; page keeps working, nothing surfaced to the person | Caught, no rethrow, no UI |
| Manifest fetched | `GET /manifest.webmanifest` | JSON with the required fields and three icon entries (192, 512, 512 maskable) | No error expected |
| `/sw.js` fetched | `GET /sw.js` | `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript` | No error expected |

</intent-contract>

## Code Map

- `apps/web/src/app/layout.tsx` -- root layout; today exports only `metadata` (title from `adminCopy.appName`). Add a `viewport` export and mount the registration component inside `<body>`. Keep `InitColorSchemeScript` / `AppRouterCacheProvider` / `ThemeRegistry` order unchanged.
- `apps/web/src/theme/tokens.ts` -- `colorTokens` (`TokenPair` with `light`/`dark`) and `token(name, scheme)`. Use `primaryStudent` for `theme_color` and `backgroundDefault` for `background_color`; both schemes for `viewport.themeColor`. Student teal light value is `#0F6E78` — the placeholder icon ground.
- `apps/web/src/copy/common.ts` -- `commonCopy`, the cross-surface copy module. Add `appName` here; `adminCopy.appName` is the Admin console's own title and must not be reused.
- `apps/web/src/app/parent/_components/ParentIdleExpiry.tsx` -- the precedent for a renders-nothing `'use client'` component mounted by a layout, with its behavior pushed into a framework-free `src/lib` module. Mirror that split.
- `apps/web/src/lib/idle-expiry.ts` -- the precedent framework-free module: dependencies passed in, drivable from a plain node spec. Mirror for the registration decision.
- `apps/web/next.config.ts` -- `NextConfig` with `reactStrictMode`, `typedRoutes`, `output: 'standalone'`. Add `headers()` for `/sw.js`.
- `apps/web/public/` -- currently empty. New home of `sw.js` and `icons/`.
- `apps/web/vitest.config.ts` -- `environment: 'node'`, specs are `src/**/*.spec.{ts,tsx}`.
- `apps/web/node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` and `.../04-functions/generate-viewport.md` -- read-only evidence for the manifest route and the `themeColor` media-array shape in this Next version (16.3.4).
- `_bmad-output/implementation-artifacts/epic-10-context.md` -- epic context: AD-35 rationale, structural seed, success bar.

## Tasks & Acceptance

**Execution:**
- `apps/web/scripts/generate-pwa-icons.mjs` -- add a dependency-free Node script that writes the placeholder icon PNGs (monogram "n" in white on Student teal `#0F6E78`), encoding PNG by hand with `node:zlib`; the maskable variant insets the glyph into the ~80% safe zone over a full-bleed ground -- so the placeholder art is reproducible and swappable without pulling in an image library.
- `apps/web/public/icons/icon-192.png`, `apps/web/public/icons/icon-512.png`, `apps/web/public/icons/icon-512-maskable.png` -- generate and commit; the manifest's icon set, self-hosted.
- `apps/web/src/app/icon.png`, `apps/web/src/app/apple-icon.png` -- generate and commit (512×512 and 180×180) so Next's icon file conventions emit the favicon and the iOS home-screen icon.
- `apps/web/src/copy/common.ts` -- add `appName: 'n-tutor'` to `commonCopy` -- one place decides the installed app's name.
- `apps/web/src/app/manifest.ts` -- add the metadata route returning `MetadataRoute.Manifest` with the required fields, colors from `colorTokens`, name from `commonCopy.appName`, and the three icon entries (the 512 maskable one carrying `purpose: 'maskable'`).
- `apps/web/src/app/manifest.spec.ts` -- assert the required field values, that the colors equal the token values rather than literals, and that the icon set contains 192, 512 and a maskable 512.
- `apps/web/public/sw.js` -- add the installability-only worker: `install` → `skipWaiting()`, `activate` → `clients.claim()`, and nothing else; a comment stating why it must never gain a `fetch` handler or a cache.
- `apps/web/src/lib/service-worker.ts` -- add a framework-free `registerServiceWorker(navigatorLike)` that returns without acting when `serviceWorker` is absent, otherwise registers `/sw.js` at scope `/` and swallows rejection.
- `apps/web/src/lib/service-worker.spec.ts` -- unit-test the I/O matrix rows: supported, unsupported, rejecting registration, and single registration.
- `apps/web/src/app/_components/ServiceWorkerRegistration.tsx` -- add the `'use client'` renders-nothing component that calls the lib function once on mount.
- `apps/web/src/app/layout.tsx` -- export `viewport` with `themeColor` for light and dark from tokens, and mount `<ServiceWorkerRegistration />` inside `<body>`.
- `apps/web/next.config.ts` -- add `headers()` serving `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript`.

**Acceptance Criteria:**
- Given the built app, when `GET /manifest.webmanifest` is requested, then it returns JSON with `name` and `short_name` `n-tutor`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, token-derived `theme_color` and `background_color`, and icon entries for 192×192, 512×512 and a maskable 512×512.
- Given any page of the built app, when its HTML is rendered, then the head carries a manifest link, an `apple-touch-icon` link to the 180×180 apple icon, and two `theme-color` metas differing by `prefers-color-scheme`.
- Given the built app, when `GET /sw.js` is requested, then it responds 200 with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript`.
- Given `/sw.js`'s source, when it is read, then it contains no `fetch` listener, no `caches`/`CacheStorage` use and no `pushManager` use, and it calls `skipWaiting` and `clients.claim`.
- Given the app is opened installed with no network, when any screen loads, then it behaves exactly as the browser tab does offline — no page is served from a cache, because nothing is cached.
- Given the existing unit and E2E suites, when they run, then their results are unchanged by this story.

## Spec Change Log

## Review Triage Log

### 2026-10-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 2: (high 0, medium 1, low 1)
- reject: 11: (high 0, medium 2, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The iOS "opens standalone with the correct app name" criterion was unimplemented — the only app-name metadata was `metadata.title` (`n-test-reviewer Admin`). Added `appleWebApp` metadata (`capable`, `title` from `commonCopy.appName`, `statusBarStyle`) to the root layout.
  - `[medium]` `[patch]` Every acceptance criterion lives at the HTTP/head surface but every test asserted at the module surface. Added `e2e/tests/pwa-installability.spec.ts`: served `/sw.js` headers (single `Content-Type`), served manifest fields and icon responses, head tags, and `navigator.serviceWorker.getRegistration('/')` after a load — the only check that proves the root-layout mount registers the worker.
  - `[low]` `[patch]` Nothing checked the icon files the manifest names. Added `src/app/manifest-icons.spec.ts`: each `src` exists under `public/`, each PNG's IHDR dimensions equal its declared `sizes`, and the ground pixel equals `colorTokens.primaryStudent.light` (catches the generator's colour bytes drifting from the token).
  - `[low]` `[patch]` The layout's two new responsibilities were untested. Added `src/app/layout.spec.ts`: `viewport.themeColor` pairs equal the light/dark token values under their media strings, and `layout.tsx` mounts `<ServiceWorkerRegistration />` exactly once (repo's source-read pattern).
  - `[low]` `[patch]` `registerServiceWorker` let a `null` `serviceWorker` reach a TypeError. Guard is now falsy-plus-callable, with spec cases.
  - `[low]` `[patch]` The icon generator was reachable only by typing its path. Added the `icons:generate` script to `apps/web/package.json`.
  - `[low]` `[patch]` The AD-35 guard regexes were easy to walk past. Denylist broadened to `onfetch`, `importScripts`, `indexedDB`, `localStorage`, `sessionStorage`, `showNotification`, `CacheStorage`.

### 2026-10-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 13: (high 0, medium 1, low 12)
- addressed_findings:
  - `[low]` `[patch]` `manifest-icons.spec.ts`'s "insets the maskable glyph further than the unmasked one" test only compared the two PNGs' byte sizes, which is a weak proxy for the inset it claims to prove. Replaced it with a pixel-level check at a coordinate (120, 256) that falls inside the unmasked icon's glyph stem but outside the maskable icon's smaller stem, asserting the unmasked pixel is the glyph colour and the maskable pixel is the ground colour.

## Design Notes

PNG encoding by hand is the deliberate choice: the change budget forbids new dependencies, and `next/og`'s `ImageResponse` produces hashed, route-served URLs that a manifest's `src` cannot name stably. A hand-rolled encoder is ~40 lines against `node:zlib` and the output is committed, so nothing is generated at build or request time.

```js
// PNG = signature + IHDR + IDAT(zlib of filter-0 scanlines) + IEND
const raw = Buffer.alloc(size * (1 + size * 3)); // one filter byte per row
// ... paint ground + glyph into raw ...
chunk('IDAT', zlib.deflateSync(raw));
```

The glyph is drawn from rectangles (one stem, one shoulder, one right leg) scaled from a unit box, so the same code renders every size and the maskable variant is the same art at a smaller scale factor.

## Verification

**Commands:**
- `node apps/web/scripts/generate-pwa-icons.mjs` -- expected: exits 0 and leaves the committed PNGs byte-identical (re-running is a no-op in `git status`)
- `pnpm --filter web test` -- expected: all specs pass, including the new manifest and service-worker specs
- `pnpm --filter web typecheck` -- expected: no errors
- `pnpm --filter web lint` -- expected: no errors
- `pnpm --filter web build` -- expected: build succeeds and reports the `/manifest.webmanifest` route
- `pnpm --filter web start` then `curl -sI localhost:3000/sw.js` -- expected: 200 with `cache-control: no-cache, no-store, must-revalidate` and `content-type: application/javascript`
- `curl -s localhost:3000/manifest.webmanifest` -- expected: the field values listed in the acceptance criteria
- `curl -s localhost:3000/ | grep -o 'theme-color[^>]*'` -- expected: two entries, light and dark
- `pnpm e2e` -- expected: unchanged results versus before this story

**Manual checks (if no CLI):**
- The three `public/icons` PNGs and both app-dir icons open as valid images at their stated sizes, with the monogram inside the maskable safe zone.

## Auto Run Result

Status: done

**Implemented change.** `apps/web` is installable: a Next metadata-route manifest, a generated-in-repo placeholder icon set, per-scheme `theme-color`, iOS home-screen metadata, and one installability-only service worker at `/sw.js` that handles no request and caches nothing (AD-35). Offline behaviour is untouched — FR-36 remains the only carve-out. This pass is a fresh review of the already-implemented story; it found one weak test assertion and patched it.

**Files changed (this pass)**

- `apps/web/src/app/manifest-icons.spec.ts` — the "insets the maskable glyph further than the unmasked one" test compared only PNG byte sizes; replaced with a pixel-level check at a coordinate inside the unmasked icon's glyph stem but outside the maskable icon's smaller stem, so the test actually observes the inset rather than an unrelated byte-count difference.

**Review findings breakdown (this pass).** 1 patch applied (low); 0 items deferred; 13 rejected — brand-name divergence (already tracked in the existing `deferred` list), the icon generator's hardcoded colour bytes (mitigated by the existing pixel-drift test and necessary because a build script cannot import the TS token module), global `theme-color`/manifest scope across all surfaces and service-worker registration for the whole app (both explicitly required by the intent's `scope: '/'` boundary), untested glyph shape (manual-check limitation, not new), apple-icon corner-clipping risk (not substantiated — the glyph sits well inside iOS's standard corner mask), the `statusBarStyle` comment's unverified claim (already a disclosed residual risk), no tracked follow-up ticket for deferred items (orchestrator/ledger concern, not this story's), brittle regex-based unit tests (an accepted repo pattern given `environment: 'node'`), the E2E `colorToken()` regex fragility (already a disclosed residual risk), no `favicon.ico` fallback (Next's `icon` convention covers it), no service-worker-update E2E (not practically testable in this suite), the install handler's `skipWaiting()` not wrapped in `event.waitUntil` (standard, documented pattern), and no CI pipeline (pre-existing, repo-wide, unrelated to this diff).

**Follow-up review recommendation.** Patched findings this pass: high 0, medium 0, low 1 → score `3×0 + 1×1 = 1` < 5, and no high. `followup_review_recommended: false`.

**Verification performed**

- `pnpm --filter web test` — 75 files / 1520 tests pass.
- `pnpm --filter web typecheck`, `pnpm --filter web lint` — clean.
- `npx prettier --check` on the changed file — clean (after `--write`).
- `pnpm --filter web build` — compiles; `/manifest.webmanifest`, `/icon.png`, `/apple-icon.png` emitted static. The build's `next-env.d.ts` churn was reverted.
- `pnpm e2e` was not re-run this pass: the only change is a unit-level pixel assertion in `manifest-icons.spec.ts`, which the E2E suite does not exercise and which cannot regress browser-surface behaviour.

**Residual risks**

- Carried over from the prior pass, unchanged by this one: the icon art is a placeholder; `appleWebApp.capable`'s exact meta name was not confirmed on a physical iPad; no physical Android/iPad install was performed; the E2E `colorToken()` helper parses `tokens.ts` by regex due to the `@/` alias gap under the E2E tsconfig.

