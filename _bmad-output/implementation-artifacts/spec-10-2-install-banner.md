---
title: 'Story 10.2: Install Banner'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_revision: '91628dc9e8d7951ee7f2df9b125bb829712a45f7'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/apps/web/AGENTS.md']
warnings: ['oversized']
deferred:
  - summary: >-
      The source-read specs each carry their own line-based comment stripper,
      which does not remove the body lines of a multi-line comment.
    evidence: |-
      `const CODE = SOURCE.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/u.test(line))`
      drops only lines whose first token opens a comment, so the second and
      later lines of a `{/* … */}` JSX block stay in `CODE`. A positive
      assertion can therefore be satisfied by prose, and a negative one can
      fail on it. The same helper is now pasted into three spec files with the
      stripping rule restated each time. Latent brittleness in the test
      harness, not a product defect, and the pattern predates this story
      (`layout.spec.ts` set it).
    location: >-
      apps/web/src/app/parent/_components/ParentSidebarChrome.spec.tsx:18, apps/web/src/app/layout.spec.ts
    severity: low
  - summary: >-
      The install action's resolved-promise callback updates component state
      and writes session storage with no unmount guard, so navigating away
      while the browser's own install dialog is still open runs that callback
      after the component has unmounted.
    evidence: |-
      `install()` in `apps/web/src/components/InstallBanner.tsx:182-199` calls
      `void promptToInstall().then((accepted) => { prompting.current = false;
      if (accepted) dismiss(); })` with no cleanup/mounted-ref check around the
      `setDismissed`/`rememberInstallBannerDismissed` calls inside `dismiss()`.
      React 18 no longer warns on a post-unmount `setState`, and the extra
      `sessionStorage` write is harmless, so the practical risk is low — but it
      is a real gap in the cleanup discipline the rest of the module otherwise
      follows.
    location: >-
      apps/web/src/components/InstallBanner.tsx:182-199
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 10.1 made `apps/web` installable, but nothing tells a family that it is: no surface ever mentions the home screen, so the install path is reachable only by a parent who already knows their browser's menu.

**Approach:** One shared, dismissible banner component plus a framework-free rules module that decides when it may render — an "Install" action driven by the deferred `beforeinstallprompt` event where the browser fires one, Share → Add to Home Screen instructions on iOS/iPadOS Safari, and nothing at all anywhere else. Mounted on exactly two surfaces: Student Mode Home and Parent View (every screen but camera capture).

## Boundaries & Constraints

**Always:**
- The visibility rules live in a framework-free `src/lib/install-banner.ts` taking its inputs as arguments (`apps/web` unit tests run `environment: 'node'`, no jsdom), so every rule is drivable from a plain spec.
- The deferred `beforeinstallprompt` event is captured once at the root layout and held in a module-level store the banner subscribes to — the event fires once, before any screen-level component can be guaranteed mounted.
- `beforeinstallprompt` is `preventDefault()`-ed so the browser's own mini-infobar does not compete with the banner.
- The banner renders only when: the surface allows it, the app is not running installed, and the session has not dismissed it, and either a deferred prompt exists or the browser is iOS/iPadOS Safari.
- Dismissal is `sessionStorage` under one namespaced key, every access wrapped in try/catch (the `attempt-store` rule: a blocked or absent store is never a reason a screen breaks).
- On a prompt accepted, the banner goes and does not come back for the session; on cancel it stays until dismissed.
- `role="region"` with an accessible name from copy, a real `<button>` for dismiss, every colour/figure from `@/theme/tokens` and the active surface's theme, and the banner above the content without overlaying or animating it.
- Every string is a copy-module string (AD-32) — three messages (Parent View, Student Home, iOS steps + the sign-in-once-more note), the action label, the dismiss label, the region name.
- Covered by unit specs for the rules module and the prompt store, plus a Chromium Playwright E2E: shown → dismissed → hidden → new context shown again, and standalone emulated → hidden.

**Block If:**
- Making the banner show would require a new dependency (none are permitted by this epic) or an API/DB change.

**Never:**
- Never on Student Mode screens other than Home (`/student/tests/**`), never on Parent View camera capture (`/parent/capture`), never on Admin or auth surfaces.
- No banner when running installed (`display-mode: standalone`, or `navigator.standalone` on iOS), and none on a browser with no install path — no dead-end instructions.
- No `localStorage`/cookie/server record of the dismissal, no "remind me later" schedule, no new colour or density token, no change to the service worker, the manifest or offline behaviour.
- No toast, dialog, overlay or focus steal: the banner never takes focus and never blocks interaction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chromium, Parent View | deferred prompt held, `/parent/analytics`, not dismissed | banner with the Install action | No error expected |
| Chromium, Student Home | deferred prompt held, `/student` | banner with the Install action | No error expected |
| iOS Safari | no prompt ever fires, iOS UA + Safari, `/student` | banner with the Share → Add to Home Screen steps and the sign-in note, no Install button | No error expected |
| No install path | no prompt, not iOS Safari | nothing renders | No error expected |
| Running installed | `(display-mode: standalone)` matches, or `navigator.standalone` true | nothing renders | No error expected |
| Excluded surface | prompt held, `/parent/capture` or `/student/tests/<id>` | nothing renders | No error expected |
| Dismissed this session | dismiss key present in `sessionStorage` | nothing renders, this tab only | No error expected |
| Storage unavailable | `sessionStorage` getter/setter throws | banner behaves as "not dismissed"; dismissal holds in component state for the page's life | Caught, nothing surfaced |
| Prompt accepted | `prompt()` resolves `{ outcome: 'accepted' }`, or `appinstalled` fires | banner gone and the deferred prompt dropped, so it cannot return | No error expected |
| Prompt rejected or throws | `prompt()` resolves `dismissed`, rejects, or throws | banner stays, nothing surfaced, action remains usable | Caught, no rethrow, no UI |

</intent-contract>

## Code Map

- `apps/web/src/app/layout.tsx` -- root layout; mounts `<ServiceWorkerRegistration />` inside `<body>` outside the theme providers. Mount the renders-nothing prompt-capture component the same way, for the same reason.
- `apps/web/src/app/_components/ServiceWorkerRegistration.tsx` -- the exact precedent to mirror: `'use client'`, one `useEffect` with an empty dep list, `return null`, all behaviour delegated to a `src/lib` module. Strict Mode double-mount is a documented no-op there; the capture must be idempotent for the same reason.
- `apps/web/src/lib/service-worker.ts` -- the framework-free module pattern to mirror (injected `navigatorLike`, falsy-plus-callable guards, swallowed rejection, exported constants).
- `apps/web/src/lib/attempt-store.ts:46,54,330` -- `ATTEMPT_KEY_PREFIX`, the `AttemptStorage` slice-of-`Storage` interface, and `browserAttemptStorage()`'s wrapped accessor. Reuse the shape (inject a storage-like, wrap every access, namespace the key); do not reuse `ntr.attempt.` — `clearAll`/`retainOnly` sweep that prefix.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx` -- Parent View's shell. It already holds `usePathname()`, the `onGate` early-return branch for `/parent/pin`, and the content `<Box>` under the sticky `<header>`: the banner's Parent View mount point is the top of that content box (and of the gate branch's `<Box sx={{ width: '100%' }}>`), gated on the rules module's surface decision.
- `apps/web/src/app/student/page.tsx` -- Student Mode Home, `'use client'`. The eyebrow `<h1>` (`studentCopy.title`) is the surface header; the banner mounts immediately after it, inside the outer grid `<Box>`. Nothing else in Student Mode may mount it.
- `apps/web/src/app/student/layout.tsx` -- deliberately *not* a mount point: it wraps Take Test and Results too.
- `apps/web/src/copy/common.ts` -- `commonCopy`, "copy shared by the primitives in `src/components`", already holds `appName` for this epic. The banner's strings belong here.
- `apps/web/src/components/Button.tsx` -- `PrimaryButton` (`type="button"` by default) for the Install action.
- `apps/web/src/components/LiveRegion.tsx:54` -- `visuallyHidden`, if a label needs hiding; no announcement is wanted (the banner is not an alert).
- `apps/web/src/theme/tokens.ts` -- `density` (parent, `tapTarget` 44) and `comfortableDensity` (student, 48), `rounded.control`, `typeRoles.caption`/`label`, `motion`. Colours come from the mounted theme (`primary.main`, `background.paper`, `divider`, `text.secondary`), never a literal.
- `apps/web/src/app/student/_components/AttemptTimer.spec.tsx` -- the component-spec pattern under `environment: 'node'`: `renderToStaticMarkup` inside a `ThemeProvider`, with the emotion `<style>` blocks stripped before asserting.
- `apps/web/src/app/student/page.spec.tsx` -- the source-read pattern (`readFileSync` + regex) used when a claim is about what a client component wires up rather than what it returns.
- `apps/web/src/app/layout.spec.ts` -- asserts the root layout mounts a component exactly once; extend for the new mount.
- `e2e/tests/pwa-installability.spec.ts` -- Story 10.1's E2E; its `colorToken()` regex helper and `__dirname` note explain the E2E tsconfig's lack of the `@/` alias.
- `e2e/tests/student-mode.spec.ts:13-66` -- read-only reference for `signUp` / set-PIN / add-profile / `enterParentView`, the cheapest route into Parent View and Student Home.
- `playwright.config.ts` -- one `chromium` project, `fullyParallel: false`, `workers: 1`, `baseURL` from `WEB_ORIGIN`.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/install-banner.ts` -- add the framework-free rules: `INSTALL_BANNER_DISMISS_KEY` (namespaced like `n-tutor:…`), `installBannerSurface(pathname): 'parent' | 'student' | null`, `isRunningInstalled(windowLike)`, `isIosSafari(navigatorLike)`, and one `installBannerMode(input): 'prompt' | 'ios' | null` composing them with the dismissed flag -- so every visibility rule is a pure function with a node spec, not markup to be read.
- `apps/web/src/lib/install-banner.spec.ts` -- unit-test every I/O matrix row that is a rule: each excluded path, installed via both signals, iOS detection (iPhone/iPad UA, iPadOS-reporting-Macintosh with touch points, and the in-app non-Safari iOS browsers rejected), no-install-path, and dismissed.
- `apps/web/src/lib/install-prompt.ts` -- add the capture store: `captureInstallPrompt(windowLike)` attaching `beforeinstallprompt` (preventDefault, hold the event, notify) and `appinstalled` (drop it), `deferredInstallPrompt()`, `subscribeInstallPrompt(listener)`, and `promptToInstall()` returning whether the install was accepted -- the event fires once and early, so it is held outside React and read by subscription.
- `apps/web/src/lib/install-prompt.spec.ts` -- unit-test: the event is `preventDefault()`-ed and held, subscribers are notified, a second capture on the same window adds no second listener, `appinstalled` clears the held prompt, and a `prompt()` that rejects or throws is swallowed and leaves the store usable.
- `apps/web/src/app/_components/InstallPromptCapture.tsx` -- add the `'use client'` renders-nothing component that calls `captureInstallPrompt(window)` once on mount, mirroring `ServiceWorkerRegistration`.
- `apps/web/src/app/layout.tsx` -- mount `<InstallPromptCapture />` beside `<ServiceWorkerRegistration />` -- the only place early enough to catch an event that fires once per page load.
- `apps/web/src/copy/common.ts` -- add `installBanner` to `commonCopy`: the region name, the Parent View line, the Student Home line, the iOS Share → Add to Home Screen steps plus the sign-in-once-more note, the Install label and the dismiss label -- plain and calm, no exclamation marks (UX-DR41).
- `apps/web/src/components/InstallBanner.tsx` -- add the `'use client'` banner: takes the surface, subscribes to the prompt store, reads the dismissed flag after mount, renders `role="region"` with the surface's copy and either the Install action or the iOS steps, and a real dismiss button writing the session key -- one component so the two surfaces cannot drift into two banners.
- `apps/web/src/components/InstallBanner.spec.tsx` -- spec the render: the Parent/Student/iOS variants' copy and controls, the region role and accessible name, that the dismiss control is a `<button>`, that it renders nothing for mode `null`, and (source-read) that no colour or spacing literal appears.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx` -- render `<InstallBanner surface="parent" />` at the top of the content area in both the gate branch and the main branch, gated on `installBannerSurface(pathname) === 'parent'` -- so `/parent/capture` is excluded by the shared rule rather than by a second opinion.
- `apps/web/src/app/student/page.tsx` -- render `<InstallBanner surface="student" />` directly after the eyebrow `<h1>`, outside the loading/error branch so it does not flicker with a read.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.spec.tsx` -- add the source-read spec: the chrome mounts the banner exactly once per branch and gates it on `installBannerSurface`.
- `apps/web/src/app/student/page.spec.tsx` -- extend: Student Home mounts the banner exactly once, with `surface="student"`, outside the loading branch.
- `apps/web/src/app/layout.spec.ts` -- extend: the root layout mounts `<InstallPromptCapture />` exactly once.
- `e2e/tests/install-banner.spec.ts` -- add the Chromium E2E against the built app: with a synthetic `beforeinstallprompt` dispatched from an init script, the banner shows in Parent View, is absent on `/parent/capture`, hides on dismiss and stays hidden across a reload, shows again in a fresh browser context, and is absent with `display-mode: standalone` emulated over CDP.

**Acceptance Criteria:**
- Given a Chromium page that has fired `beforeinstallprompt` and is not installed, when a Parent View screen other than camera capture renders, then the banner is in the accessibility tree as a named region with an Install button, and activating it calls the deferred prompt.
- Given the same page, when `/parent/capture` or a Student Mode screen other than Home renders, then no banner exists in the document.
- Given the banner is showing, when the dismiss button is activated, then the banner leaves the document, is still absent after a reload in that tab, and is present again in a new browser context.
- Given `(display-mode: standalone)` is emulated, when a Student Mode Home or Parent View screen renders, then no banner exists in the document.
- Given the banner's markup in light and dark mode on both surfaces, when it is inspected, then its only colours and figures come from the theme and `tokens.ts`, and no text in it is a literal outside `copy/`.
- Given the existing unit and E2E suites, when they run, then their results are unchanged by this story.

## Spec Change Log

## Review Triage Log

### 2026-10-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 18: (high 0, medium 2, low 16)
- addressed_findings:
  - `[medium]` `[patch]` Student Mode Home — one of the story's two surfaces — had no page-level coverage: the mount was pinned only by a source regex, so it could have shipped missing, mis-worded or trapped inside the loading branch with every test green. Added a Student Mode Home E2E describe: the named region visible with the child's sentence (and not the parent's), Install calling the deferred prompt, Dismiss removing it without disturbing the screen, and the banner absent on `/student/tests/<id>`.
  - `[medium]` `[patch]` "On accept the banner disappears and does not return" was asserted only as a string in the component source, because the synthetic offer always resolved `dismissed`. The offer is now parameterised by outcome, and an accept-resolving variant drives a behavioural test: the region leaves the document and is still absent after a reload.
  - `[medium]` `[patch]` `NON_SAFARI_IOS` missed the in-app webviews families actually arrive in, each of which carries `Safari` in its user agent and has no Add to Home Screen — exactly the dead-end instructions the intent rules out. Added `MicroMessenger`, `WhatsApp`, `Snapchat`, `musical_ly`, `BytedanceWebview`, `Twitter`, `Pinterest`, `FBIOS` and `YaBrowser`, with spec cases on both an iPhone and an iPad user agent.
  - `[low]` `[patch]` The Install action had no in-flight guard, so a second tap called `prompt()` again on the same event and the platform's rejection was swallowed — two taps, nothing visible either time. The action now latches while a call is in flight.
  - `[low]` `[patch]` `InstallBannerNavigator.platform` was declared and never read. Dropped, with a note on why it is deliberately absent.
  - `[low]` `[patch]` Two render gaps: the `('parent', 'ios')` variant (an iPad in Parent View, the likeliest real iOS case) was never rendered, and the per-surface `marginBottom` was asserted nowhere. Both now covered.
  - `[low]` `[patch]` `canInstall` in Parent View's shell answered "may this route carry the banner", not "can this device install", and its ternary was written out twice. Renamed to `routeCarriesInstallBanner` and hoisted into one local so the gate and the shell cannot drift.

### 2026-10-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1: (high 0, medium 0, low 1)
- reject: 16: (high 0, medium 0, low 16)
- addressed_findings:
  - `[medium]` `[patch]` The Install action's in-flight guard (`prompting.current`), added to stop a double tap from calling `prompt()` twice on the same deferred event, had no test exercising it — every existing unit and E2E assertion clicked Install exactly once, so a regression reintroducing the double call would ship with both suites green. Added a Parent View E2E step that fires two native clicks on the Install button in the same tick (before the mocked `prompt()` settles) and asserts `__installPromptCalls` stays at `1`.

## Design Notes

**Why the `beforeinstallprompt` event is held outside React.** It fires once per page load, at a moment no screen-level component can claim to own — and it is the only way to a one-tap install, so missing it would silently downgrade every Chromium family to no banner at all. The root layout captures it into a module-level store; the banner subscribes. The same store drops the event on `appinstalled`, which is what makes "on accept it does not return" true even when the person installs from the browser's own menu rather than from the banner.

```ts
// install-prompt.ts — the shape, not the whole file
let deferred: InstallPromptEventLike | null = null;
export function captureInstallPrompt(windowLike: InstallPromptWindow): void {
  if (captured.has(windowLike)) return; // Strict Mode remounts twice
  windowLike.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // the browser's own mini-infobar must not compete
    deferred = event;
    notify();
  });
}
```

**Why `/parent/capture` is excluded by route and not by viewfinder state.** The rule is a per-screen placement rule, and the capture screen *is* the camera capture view — the viewfinder is one region inside it. A state-dependent banner would also appear and disappear while a parent photographs pages, which is the content shift the UX decision rules out.

**Why `sessionStorage` and nothing stronger.** The dismissal is meant to last the browser session and return in a new one, which is `sessionStorage`'s own lifetime — no clock, no key to expire, and nothing about a family's device kept past the tab. Access is wrapped because a private-mode or blocked store throws on read, and a banner is never a reason a screen fails to render.

## Verification

**Commands:**
- `pnpm --filter web test` -- expected: all specs pass, including the new rules, prompt-store, banner and mount specs
- `pnpm --filter web typecheck` -- expected: no errors
- `pnpm --filter web lint` -- expected: no errors (including `jsx-a11y`)
- `npx prettier --check` on every changed file -- expected: clean
- `pnpm --filter web build` -- expected: build succeeds
- `pnpm e2e` -- expected: the new `install-banner` spec passes and every pre-existing spec's result is unchanged

**Manual checks (if no CLI):**
- The banner's copy reads as three plain sentences with no exclamation mark, and the iOS variant names the Share step, the "Add to Home Screen" step and the sign-in-once-more note.

## Auto Run Result

**Summary:** Install banner shipped per the intent-contract: `install-banner.ts` holds the framework-free visibility rules (placement, installed check, iOS/iPadOS Safari detection, dismissal storage), `install-prompt.ts` holds the module-level `beforeinstallprompt` capture store, `InstallBanner.tsx` is the one component mounted on Student Mode Home and Parent View (every screen but camera capture, including the PIN gate), and `InstallPromptCapture` mounts the capture at the root layout beside `ServiceWorkerRegistration`. A prior review pass (2026-10-11) patched 7 findings; this pass patched 1 more (a test-coverage gap on the double-tap guard) and found no further code defects.

**Files changed (this pass):**
- `e2e/tests/install-banner.spec.ts` — added a same-tick double-click on the Install button to the Parent View E2E, asserting the in-flight guard keeps `prompt()` to one call.

**Review findings breakdown (this pass):** 1 patch (medium) applied; 1 item deferred (low — a missing unmount guard on the install-acceptance callback, recorded in frontmatter `deferred`); 16 items rejected (all low — speculative, already covered by the intent's own boundaries, or pre-existing codebase convention).

**Follow-up review recommendation:** `false`. This pass's patched findings: 0 high, 1 medium, 0 low → score `3 × 1 + 1 × 0 = 3`, below the 5 threshold and no high-severity patch.

**Verification performed:**
- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web lint` — clean.
- `npx prettier --check` on the changed file — clean.
- `pnpm --filter web test` — 79 files, 1587 tests, all passing.
- `pnpm --filter web build` — succeeds.
- `pnpm run typecheck:e2e` — clean.
- `npx playwright test e2e/tests/install-banner.spec.ts` (run twice: once isolated to confirm an earlier environmental flake, once as the full 6-test file) — 6/6 passing, including the new double-click assertion. The full `pnpm e2e` suite was not run end-to-end in this session (a single pre-existing spec file alone exceeded the available turn time against this sandbox's Postgres-backed stack); this pass's only change is additive to a new test file with no production-code edits, so it cannot alter any other spec's result.

**Residual risks:**
- The full `pnpm e2e` suite's "every pre-existing spec's result is unchanged" clause is verified by inference (no non-test code changed this pass) rather than by a completed full run.
- One low-severity gap remains deferred: `InstallBanner`'s install-acceptance callback has no unmount guard (see frontmatter `deferred`).

