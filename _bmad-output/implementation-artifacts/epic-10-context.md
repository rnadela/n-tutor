# Epic 10 Context: Installable App (PWA)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A family can install n-tutor to the home screen of their tablet or phone and open it in one tap, and the app gently tells them that they can. This is purely a front-end, additive change: installing changes how the app is opened, not what it does. No capability, permission, or offline behavior changes — the existing single offline carve-out (FR-36) remains the only offline behavior, and an installed app opened without a connection behaves exactly like the browser tab. This is explicitly not a step toward native apps or push notifications, both of which stay out of scope.

## Stories

- Story 10.1: Web App Manifest, Icons & Minimal Service Worker
- Story 10.2: Install Banner

## Requirements & Constraints

- The app must be installable on browsers that support installation, with its own name, icon, and standalone window. Installed app name is `n-tutor` for both `name` and `short_name`.
- When running in a browser tab (not installed) on a browser that can install the app, a dismissible banner invites the person to install: a one-tap install action where the browser provides one, or brief add-to-home-screen instructions where it does not (iOS/iPadOS Safari).
- Banner placement rules: Student Mode — Home screen only (never Take Test, never Results). Parent View — every screen except the camera capture view.
- The banner never renders when running installed, and never on a browser with no install path (no dead-end instructions).
- Dismissal hides the banner for the remainder of the browser session and it returns in a new session.
- No new dependencies. No API, DB, worker, or Compose changes. Front-end only.
- Icon art is a placeholder monogram "n" on Student teal `#0F6E78`, generated in-repo and replaceable later.
- All icon and manifest assets are bundled/self-hosted — no runtime CDN fetch.
- Success bar: no manifest installability errors in Chrome DevTools on the production URL; Android/desktop Chrome offer Install and open standalone with correct icon and name; iPad Safari Add to Home Screen yields correct icon/name and standalone window; banner has zero accessibility violations in light and dark; existing E2E suite results unchanged.

## Technical Decisions

- **The service worker exists for installability only and never touches requests.** A single static worker at `/sw.js`, scope `/`, with install/activate handlers only: no `fetch` handler, no Cache Storage, no push subscription, and `skipWaiting`/`clients.claim` so a new version takes over on next load. Rationale: a caching worker would risk serving Parent-View and child data across sessions or after a Parent View expiry, could serve stale JS after a deploy, and would create a second client-persistence mechanism beside the sanctioned client-owned in-progress Attempt state.
- `/sw.js` must be served with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript` so worker updates roll out; handled via the Next.js config `headers()`.
- The manifest is a Next.js metadata route (`app/manifest.ts`), not a static file. Icons use the framework's `icon` / `apple-icon` file conventions. Required icon set: 192×192, 512×512, and a 512×512 maskable PNG, plus a 180×180 apple-icon.
- Manifest fields: `start_url: "/"`, `scope: "/"`, `display: "standalone"`, with `theme_color` and `background_color` taken from the existing design tokens (reuse, do not hardcode new colors).
- `viewport.themeColor` is set in the root layout for both light and dark color schemes, from design tokens.
- Service-worker registration happens in a client component on load.
- Structural footprint: manifest route, icon and apple-icon files under the app directory, `public/sw.js`, and a public icons directory holding the 192/512/maskable assets.

## UX & Interaction Patterns

- **Install Banner pattern:** one compact strip at the top of the content area, below the surface header — text, one action, and a dismiss button. It never overlays content, never blocks interaction, never animates in a way that pulls focus, and must not shift content after first paint (render from the first client render, or reserve space).
- It uses the active surface's tokens and density: Student palette in Student Mode, Parent palette in Parent View.
- Accessibility: `role="region"` with an accessible name; dismiss is a real button; fully reachable and dismissible by keyboard and screen reader; must meet the project's Accessibility Floor in light and dark mode.
- Copy is plain and calm — no exclamation marks, no urgency — and lives in the `copy/` modules. Intent of the three strings: a Parent View line about adding to the home screen to open in one tap; a Student Mode Home line about putting practice tests one tap away; and an iOS line giving the Share → Add to Home Screen steps plus a note that the person will sign in once more after adding it.
- Install action behavior: on accept the banner disappears and does not return; on cancel it remains until dismissed.
- Detection: `beforeinstallprompt` for the install path; `display-mode: standalone` (or `navigator.standalone` on iOS) for the installed check; sessionStorage for dismissal.
- **Why the banner is kept off Take Test:** the child is mid-Attempt and nothing but the Question should compete for attention; also, installing from iOS Safari mid-Attempt would strand answers, because an iOS home-screen web app has its own cookie/storage jar separate from Safari. That partition is why the iOS copy warns about signing in once more.

## Cross-Story Dependencies

- Story 10.1 must land before Story 10.2: the banner depends on the manifest being served for `beforeinstallprompt` to fire at all.
- Both stories consume the design-system tokens established in the Design System Foundation work (theme/background colors, surface palettes, density) and the existing `copy/` module convention — reuse rather than extend.
- Testing dependency for 10.2: unit coverage of the visibility rules plus a Playwright E2E in Chromium (shown → dismissed → hidden → new browser context shown again; standalone emulated → hidden).
