---
title: 'Story 1.5: Parent View Idle Expiry'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: '639d1bd8294fb1ef99dfc0ae46894c5951c629a6'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Web unit specs still pin component behaviour by matching component source text, because
      apps/web runs its unit tests without a DOM.
    evidence: |-
      apps/web/vitest.config.ts runs environment 'node' with no jsdom and no testing-library, so
      ParentIdleExpiry.spec.tsx asserts on readFileSync + toContain for the parts of the component
      that are not extractable as pure functions (the effect body, the Date.parse guard, the
      onExpire wiring). Those assertions break on a reformat and pass on code that is structurally
      right and behaviourally wrong. Pre-existing convention recorded in Story 1.4; the story's
      own mitigation was to push the logic into idle-expiry.ts, which is unit-tested for real.
      Fixing the convention means adding a jsdom test environment.
    location: >-
      apps/web/vitest.config.ts
    severity: medium
  - summary: >-
      The parent layout imports a page module, so the Students screen's whole graph loads on every
      Parent View surface including the PIN gate.
    evidence: |-
      apps/web/src/app/parent/layout.tsx mounts BackToStudentMode and ParentIdleExpiry, both of
      which import endsParentView from '../students/page' — a 'use client' module pulling ~15 MUI
      imports, parentApi and parentCopy. endsParentView is a pure predicate over ParentApiError
      and belongs in apps/web/src/lib/parent-api.ts. The coupling pre-dates this story (Story 1.4
      introduced it via BackToStudentMode); this story's clock follows the existing import rather
      than adding a new kind of dependency.
    location: >-
      apps/web/src/app/parent/_components/ParentIdleExpiry.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Parent View has a 15-minute elevation token but no idle clock: nothing measures whether the parent is still there, nothing refreshes the token while they are, and nothing acts when the window lapses. A parent who walks away leaves Parent View standing on screen until something else happens to touch it, and a parent who is actively working is dropped mid-task when the token quietly dies under them.

**Approach:** Give Parent View the client-owned idle clock AD-13 describes, mounted once in the `/parent` layout so it covers every Parent View surface. It stamps real interaction (pointer, key, scroll, touch), *requests* a replacement token from the existing `POST /api/parent/elevation/refresh` while the parent is active, and when the idle window lapses it silently navigates to `/student` — no warning, no countdown, no prompt — landing the device on the profile it is already bound to. Every figure it uses is derived from the instants the server states; the browser names no duration of its own.

## Boundaries & Constraints

**Always:**
- The idle window is derived from the server's own instants (`expiresAt`, `ceilingAt` and when the token was received), never from a duration written in the web app.
- Only real user interaction moves the clock: `pointerdown`, `keydown`, `scroll`, `touchstart`. An API call — a refresh included — is not interaction and must not extend anything (AD-13: polling does not touch the clock).
- The client only ever *requests* a replacement token; it never rewrites `expiresAt`, and the ceiling it carries is whatever the server returned.
- Expiry is silent and uniform: no warning, no countdown, no dialog, no live-region announcement, and the same behaviour on every `/parent` surface because the clock is mounted in the layout.
- On expiry the device goes to `/student` — the last-bound profile, with no prompt, because a silent expiry cannot ask.
- Re-entry is the existing PIN gate unchanged, cool-down rules included.

**Block If:**
- The intent would require changing the elevation TTL, the 8-hour ceiling, the PIN cool-down, or the token's shape.

**Never:**
- Never persist the clock's state, the token, or the last-interaction instant to `localStorage`, `sessionStorage`, a cookie, or IndexedDB.
- Never rebind the device on expiry (rebinding needs elevation, which has just ended) and never prompt for a profile.
- Never build the uncommitted-input retention mechanism (Story 1.6), a "you were signed out" notice, or a warning-before-expiry affordance.
- Never let a transient failure (network, 429, 500) end Parent View early — only the elevation guard's own refusal or the lapsed window does.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Idle for the whole window | Elevation held; no interaction since it was received | At the deadline the clock expires: `/student` is navigated to, silently | No error expected |
| Active parent | Interaction after the refresh threshold has passed | One refresh request; the replacement token's instants become the new window | No error expected |
| Keystroke storm | Many interactions inside one threshold period | At most one refresh per threshold period — the clock throttles, it does not fire per event | No error expected |
| Interaction then idle | Interaction at minute 1, nothing after | Expiry lands one window after that interaction, not one window after the refresh | No error expected |
| Refresh refused by the guard | Refresh answers 401 `elevated: false` (stale epoch, or past the ceiling) | Treated as expiry: straight to `/student` | The guard's refusal is the authority, not the client's arithmetic |
| Refresh fails transiently | Refresh answers a network failure, 429 or 500 | Parent View continues; the request is retried on the retry threshold until the window lapses anyway | A bad moment is not an idle parent |
| Ceiling reached while active | `ceilingAt` arrives before the idle deadline | Expiry at the ceiling instant; no refresh is attempted past it | The 8-hour ceiling ends elevation regardless of activity |
| No elevation held | On `/parent/pin`, or after the token was cleared | The clock attaches no listeners and schedules nothing | Nothing to expire |
| Background tab | Timer fires late because the browser throttled it | The decision is made against the current instant, so a late tick expires rather than extending | Wall-clock time, never elapsed-timer time |
| Expired token presented to the API | Any `/api/parent/*` route, or the refresh route, with a token past its `exp` | 401 `elevated: false` | Server-side expiry stands on its own: a client that fails to expire holds nothing |
| Device with no binding expires | Elevation held on an account with no Student Profile | `/student` refuses as not bound and the existing rule routes on to sign-in | No Student Mode exists to return to |

</intent-contract>

## Code Map

- `apps/api/src/identity/pin-policy.ts:31-40` -- `ELEVATION_TTL_SECONDS` (15 min) and `ELEVATION_CEILING_MS` (8 h), plus `elevationTtlSeconds()`/`elevationCeilingMs()` reading the env overrides. The single source of both figures; the web app never restates them.
- `apps/api/src/identity/parent-pin.controller.ts:72-92` -- `POST elevation/refresh` (a replacement token, the original ceiling carried along) and `GET session`. Both already exist; this story is their first real client.
- `apps/api/src/identity/parent-elevation.guard.ts:80-116` -- the claim-by-claim checks, the ceiling check, the stale-epoch check, and `notElevated()` carrying `elevated: false`. `exp` is verified by `verifyAsync`, so an expired token is already refused everywhere — this story adds the test that pins it.
- `apps/api/test/harness.ts:363-386` -- `elevate()` and `elevationTokenWithClaims(jwt, claims, { expiresIn })`, which is how an already-expired elevation token is minted without waiting.
- `apps/api/test/parent-pin.int-spec.ts:468-500` -- the existing refresh/ceiling/epoch cases and their shape; the expired-token cases join this file rather than starting a new one.
- `apps/web/src/lib/elevation.tsx` -- the in-memory-only elevation context. It gains one field (when the held token was received) and nothing else; `elevation.spec.tsx` asserts no storage API is named anywhere in its source, so the addition must stay memory-only.
- `apps/web/src/lib/elevation.spec.tsx:60-78` -- that source-level storage assertion. Any new field must not break it.
- `apps/web/src/app/parent/layout.tsx` -- `ParentThemeProvider` > `ElevationProvider` > main box, with `BackToStudentMode` above `{children}`. The idle clock mounts here, inside the provider, for the same reason: one mount covers every Parent View surface.
- `apps/web/src/app/parent/_components/BackToStudentMode.tsx:44-60,80-113` -- the precedent for leaving Parent View: navigate out of the route group and let the provider unmount destroy the token, *without* calling `clearElevation()` first (clearing while the screens are mounted makes each fire its own `router.replace('/parent/pin')`, which races and wins). Expiry follows the same rule.
- `apps/web/src/app/parent/students/page.tsx:52-54` -- `endsParentView(cause)`: the shared "the elevation guard refused, as opposed to anything transient" predicate. The refresh failure path reuses it verbatim.
- `apps/web/src/lib/parent-api.ts:262-267` -- `refreshElevation(token)`; `ParentApiError` carries `notElevated` and `NETWORK_STATUS` is 0. No new API function is needed.
- `apps/web/src/app/parent/page.tsx:40-66` -- the request-staleness convention (`requestId` ref) and the "a non-network rejection sends the parent back to the PIN" branch already on the parent screens.
- `apps/web/src/app/student/page.tsx:27-29,55-64` -- `deviceIsUnbound`, and the rule that an unbound device routes on to `/auth/sign-in`. That is what catches an expiry on an account with no profile.
- `apps/web/vitest.config.ts` -- `environment: 'node'`, no jsdom, no testing-library. This is why the clock must be a framework-free unit with injected timers rather than logic living inside a component: it is the only way to test it as behaviour instead of as a source regex.
- `apps/web/src/lib/consumption-format.ts` + `consumption-format.spec.ts` -- the precedent for a pure, framework-free web module with a real behavioural spec.
- `playwright.config.ts:35-45` -- the E2E API env block, which already states `ELEVATION_TTL_SECONDS` and `ELEVATION_CEILING_MS`. Leave both alone: the E2E drives the browser's clock, not the server's.
- `e2e/tests/student-mode.spec.ts:14-60` -- `signUp`, `openStudents`, `addProfile`, `enterParentView`: the exact opening the idle-expiry E2E reuses.
- `e2e/tests/parent-pin.spec.ts` -- the PIN and cool-down E2E; re-entry after expiry asserts against the same screens it drives.

## Tasks & Acceptance

**Execution:**

- `apps/web/src/lib/idle-expiry.ts` -- new, framework-free. Exports `INTERACTION_EVENTS` (`pointerdown`, `keydown`, `scroll`, `touchstart`), the two ratios `REFRESH_AT_FRACTION` and `RETRY_AT_FRACTION` of the window (ratios, never durations), a pure `decide(state, now)` returning `{ action: 'expire' }` / `{ action: 'refresh' }` / `{ action: 'wait', delayMs }` over `{ issuedAt, expiresAt, ceilingAt, lastInteractionAt, lastAttemptAt }`, and `createIdleClock(deps)` driving it with injected `now`, `setTimeout`/`clearTimeout`, `refresh`, `onExpire` and an `addEventListener` target. Decision order: expire when `now` has reached `expiresAt`, `ceilingAt`, or `lastInteractionAt + window`; otherwise refresh when the token would die before the idle deadline and the threshold since `lastAttemptAt` has passed; otherwise wait until the earliest of those instants. `window` is `expiresAt - issuedAt`.
- `apps/web/src/lib/idle-expiry.spec.ts` -- new: drive `createIdleClock` with a fake clock over every I/O matrix row — silent expiry exactly one window after the last interaction; one refresh per threshold under a keystroke storm; a refresh on its own never moving the deadline; interaction-then-idle expiring on the interaction, not on the refresh; the ceiling winning when it comes first; a guard refusal expiring; a transient failure retrying rather than expiring; a late (throttled) tick expiring against wall-clock time; no listeners and no timer without elevation.
- `apps/web/src/lib/elevation.tsx` -- record when the held token was received (`receivedAt`, stamped inside `setElevation`) and expose it on the context. Memory only: no storage API may be named in this file.
- `apps/web/src/lib/elevation.spec.tsx` -- extend: the stamp moves when a new token is set, is `null` with no token, and the existing "names no storage API" assertion still holds.
- `apps/web/src/app/parent/_components/ParentIdleExpiry.tsx` -- new client component rendering `null`. It wires `createIdleClock` to the real window, `parentApi.refreshElevation` + `setElevation` for a refresh, and `router.replace('/student')` for expiry — no `clearElevation()` first, for the reason `BackToStudentMode` documents. A refresh rejection routes through `endsParentView`: the guard's own refusal expires, anything else is retried by the clock.
- `apps/web/src/app/parent/_components/ParentIdleExpiry.spec.tsx` -- new: assert the component renders nothing, announces nothing (no live region, no copy string), and that its expiry path navigates to `/student` without calling `clearElevation()` first.
- `apps/web/src/app/parent/layout.tsx` -- mount `ParentIdleExpiry` inside `ElevationProvider`, so every Parent View surface is covered by one clock.
- `apps/api/test/parent-pin.int-spec.ts` -- add: an expired elevation token is refused with `elevated: false` on the parent-scoped read, on `POST elevation/refresh`, and on an elevation-guarded write — the client-side clock is a convenience, and the server does not depend on it.
- `apps/api/src/identity/pin-policy.spec.ts` -- add: the elevation TTL is the one figure the idle window comes from, and it stays at or below the ceiling (the existing constructor check), so no second definition of "15 minutes" can appear.
- `e2e/tests/parent-idle-expiry.spec.ts` -- new, using Playwright's browser clock (`page.clock`): enter Parent View, fast-forward past the window with no interaction, and land on Student Mode showing the bound child, with no warning or countdown seen on the way; then the "Parent" control asks for the PIN again and the wrong-PIN cool-down behaves as Story 1.2 defines. A second case fast-forwards with interaction in between and stays in Parent View. A third asserts the same expiry from `/parent/students`, so the behaviour is not `/parent`'s alone.

**Acceptance Criteria:**

- Given a parent standing anywhere in Parent View with no interaction, when one idle window elapses, then the device is on Student Mode showing the bound child, and nothing warned, counted down, announced, or asked which profile to use.
- Given a parent who keeps working, when they interact past the refresh threshold, then a replacement token is requested and Parent View continues uninterrupted, with the original ceiling unchanged.
- Given a parent whose Parent View has expired, when they re-enter, then the PIN is required and three wrong entries lock the gate exactly as Story 1.2 defines.
- Given a screen in Parent View that fetches on its own, when only API calls happen and the parent does not touch the device, then the idle window still lapses on schedule — a request is not interaction.
- Given an elevation token past its expiry, when it is presented to any parent-scoped route including the refresh route, then it is refused with `elevated: false`.
- Given `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` and `pnpm run build && pnpm run e2e` at the repo root, when run on a clean tree, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 5, low 5)
- defer: 2: (high 0, medium 1, low 1)
- reject: 17: (high 0, medium 0, low 17)
- addressed_findings:
  - `[medium]` `[patch]` `createIdleClock` ran a clock on a non-positive or non-finite window, so a device whose clock runs ahead of the server expired Parent View the instant the PIN was crossed — an unmeasurable window is now treated exactly as "no token", with unit cases for both shapes.
  - `[medium]` `[patch]` The retry threshold could dispatch a second refresh while the first was still in flight, letting a stale response install its instants over the newer token's — an in-flight flag now re-arms the timer instead, with the hard deadline still armed while a request hangs.
  - `[medium]` `[patch]` The refresh failure classification (guard refusal vs. transient failure) was pinned only by a source-text match — extracted as the exported pure `refreshOutcomeFor(cause)` and asserted by execution over 401/`notElevated`, 400, 404, 429, 500, 503, a network failure, a plain Error and a bare string.
  - `[medium]` `[patch]` No test combined one interaction with a subsequent idle period, so an ordinary dependency-array edit could restart the deadline on every refresh with the suite green — added the E2E case that presses a key once and then idles past the window.
  - `[medium]` `[patch]` `getByRole('heading', { name: 'Parent View' })` matches by substring and so also matched the first-PIN screen's "Set a PIN for Parent View" heading, making three existing E2E files race their own PIN submit (observed as an intermittent failure of `parent-pin.spec.ts:87`) — every such matcher is now `exact`, with the reason stated where the helper lives.
  - `[low]` `[patch]` `IdleClockDeps.refresh` was documented as never rejecting while the code and its spec both handled a rejection — the doc now states the real contract.
  - `[low]` `[patch]` `held.current` and `receivedRef.current` were assigned in the render body — moved into a dependency-less effect declared before the clock effect.
  - `[low]` `[patch]` The E2E restated the API's TTL as clock-time literals while claiming not to — every fast-forward is now a multiple of a window read from the same expression `playwright.config.ts` reads.
  - `[low]` `[patch]` The unbound-device E2E installed the browser clock before setup, contradicting the stated reason setup runs on a real clock — a comment now states why that path is safe (no select, no dialog).
  - `[low]` `[patch]` A `JSON.stringify(parentCopy)` assertion would have failed on any unrelated future copy string — scoped to the `parentView` block and to phrasings a warning would need.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[low]` `[patch]` A refresh could resolve `'replaced'` with a finite but non-positive window (`expiresAt <= issuedAt` — a malformed or clock-skewed response), which `onOutcome` accepted without the same `isMeasurable` guard the initial token gets, immediately re-triggering expiry from a bad response rather than the retry path a transient failure gets — `onOutcome` now applies `isMeasurable` to a replacement's instants too, keeping the prior measurable state and retrying on the next threshold instead, with a unit case covering it.

## Design Notes

**Why the window is derived, not stated.** The web app already refuses to name a figure the server owns: the PIN shape and cool-down reach it through `GET /api/auth/policy`. The idle window is the same kind of fact, and it is already in every elevation response as `expiresAt`. Taking `window = expiresAt - receivedAt` means an env override on the API moves the client's clock too, and no second definition of 15 minutes can drift. The receipt stamp makes the window very slightly *shorter* than the server's, by one network round trip — conservative in the safe direction.

**Why the deadline hangs off the last interaction rather than off the token.** If the clock simply refreshed on a timer, a parent who touched the device once at minute 1 would get a fresh 15 minutes at minute 7.5 and expire at 22.5 — the rule would no longer be "idle for 15 minutes". Making `lastInteractionAt + window` the deadline, and refreshing only when the token would die *before* it, expires exactly one window after the parent last did something, while a parent who keeps working is never dropped.

```
window = expiresAt - issuedAt
expire  when now >= expiresAt | ceilingAt | lastInteractionAt + window
refresh when expiresAt < lastInteractionAt + window
        and now >= lastAttemptAt + window * (first attempt ? REFRESH_AT : RETRY_AT)
wait    until the earliest of those instants
```

**Why a framework-free clock with injected timers.** `apps/web` runs its unit tests in `environment: 'node'` with no jsdom, so logic living inside a component can only be pinned by matching its source text — which passes on code that is structurally right and behaviourally wrong (already recorded as deferred work in Story 1.4). A plain module taking `now`, the timer functions and an event target as dependencies is testable as behaviour today, without adding a test environment this story has no other reason to add.

**Why expiry does not clear the token before navigating.** Story 1.4 learned this the hard way: clearing while the Parent View screens are still mounted makes each of them re-run its "no token" branch and fire `router.replace('/parent/pin')`, which races and wins against the navigation. Leaving the `/parent` route group unmounts `ElevationProvider` and destroys the token unconditionally. For expiry there is not even a window of risk: by the time the clock acts, the token the server would check is already past its own `exp`.

**Why a transient failure does not expire.** The elevation guard's refusal is a statement about authority; a dropped connection is a statement about the network. `endsParentView` already draws exactly that line for every other Parent View screen, and reusing it keeps a flaky connection from looking like a parent who walked away.

## Verification

**Commands:**
- `docker compose up -d postgres` -- expected: healthy container
- `pnpm run typecheck` -- expected: clean
- `pnpm run lint` -- expected: clean, or the pre-existing "eslint not installed" gap unchanged (recorded in Story 1.1; not a regression to fix here)
- `pnpm run test` -- expected: all unit + integration specs pass, including `idle-expiry.spec.ts`, the extended `elevation.spec.tsx`, `ParentIdleExpiry.spec.tsx` and the new `parent-pin.int-spec.ts` cases
- `pnpm run build` then `pnpm run e2e` -- expected: `parent-idle-expiry.spec.ts` passes alongside the existing suites. `pnpm run e2e` does not go through turbo, so the build must run first or it tests a stale `apps/api/dist`.
- `pnpm prettier --write .` -- expected: no unformatted files remain

**Manual checks (if no CLI):**
- No schema change is expected: `git status` after the run must show no new `apps/api/prisma/migrations/` directory.
- `playwright.config.ts` must still state the same `ELEVATION_TTL_SECONDS` and `ELEVATION_CEILING_MS` values — the E2E moves the browser's clock, never the server's.

## Auto Run Result

**Summary:** Second review pass (bmad-build-auto) over Story 1.5's already-implemented and previously-reviewed diff. Four review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran in parallel against the full diff since `639d1bd`. One real, low-severity gap survived triage: a refresh reply with a finite but non-positive window (`expiresAt <= issuedAt`) was accepted as a replacement without the same measurability guard the initial token gets, which would immediately re-trigger expiry off a malformed response instead of retrying it like any other transient failure. Fixed and covered by a new unit case. Everything else raised — a client-stamped `receivedAt` instead of a server one, no exponential backoff, source-text-matching in `ParentIdleExpiry.spec.tsx`, the `apps/web`/no-jsdom gap, the `../students/page` import coupling, an E2E `.catch` that turns out still caught by its own later assertion, an untested unmount-mid-refresh path, and two intent-matrix rows (guard-refusal, ceiling-while-active) proven at the unit/integration layer but not re-proven through the live E2E wiring — was either already recorded (`DW-60`, `DW-61`), already correctly handled on inspection of `idle-expiry.ts`'s decision logic, out of scope of what the spec's own task list asked the E2E suite to cover, or not reachable given the actual call sites.

**Files changed (this pass):**
- `apps/web/src/lib/idle-expiry.ts` — `onOutcome` now applies the same `isMeasurable` guard to a refresh's replacement instants that the initial token already gets.
- `apps/web/src/lib/idle-expiry.spec.ts` — added a case: a replacement with a non-positive window is treated as a bad moment, not an idle parent, and the prior measurable deadline still lapses on schedule.

**Review findings breakdown:** 1 patch applied (low), 0 deferred, 13 rejected (all low; duplicates of already-recorded deferred work, design choices already justified in the spec's own Design Notes, or claims that did not hold up against the actual code path).

**Follow-up review recommendation:** `false` — this pass's only patched finding was low severity (score `3×0 + 1×1 = 1`, below the threshold of 5, and no high-severity patch).

**Verification performed:**
- `pnpm --filter web exec vitest run src/lib/idle-expiry.spec.ts` — 22/22 pass (includes the new case).
- `pnpm --filter web run test` — 11 files, 132/132 pass.
- `pnpm --filter api run test` — 24 files, 314/315 pass; the one failure (`rate-limit.int-spec.ts` > "does not spend the parent budget on the policy route", 404 instead of 200) is pre-existing, unrelated to this diff (file untouched by the story), and passes in isolation (7/7) — a test-isolation flake under full-suite parallelism, not a regression from this pass's patch.
- `pnpm run typecheck` — clean (api + web).
- `pnpm run lint` — pre-existing "eslint not installed" gap, unchanged (recorded in Story 1.1, not a regression).
- `pnpm run build` — clean (api + web).
- `npx playwright test e2e/tests/parent-idle-expiry.spec.ts` — 7/7 pass.
- `pnpm prettier --write` on both touched files — already formatted correctly.

**Residual risks:** The pre-existing `rate-limit.int-spec.ts` flake under full-suite parallel execution is unaddressed (out of this story's scope; not caused by this diff). The two open `deferred` items (`DW-60` component-test source-matching, `DW-61` layout import coupling) remain open, as recorded in frontmatter.

