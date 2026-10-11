# Epic 10 Context: Installable App (PWA)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A family can install n-tutor to the home screen of a tablet or phone and open it in one tap, the app gently tells them that they can, and the app's palette matches the icon they tapped. This is purely a front-end, additive change: installing changes how the app is opened, not what it does. No capability, permission, or offline behavior changes — the single existing offline carve-out (FR-36) remains the only offline behavior, and an installed app opened without a connection behaves exactly like the browser tab. Explicitly not a step toward native apps or push notifications. The palette work is a token-value swap only: the design-system mechanism built earlier is untouched, and no component code should change.

## Stories

- Story 10.1: Web App Manifest, Icons & Minimal Service Worker
- Story 10.2: Install Banner
- Story 10.3: Brand Palette

## Requirements & Constraints

- The app must be installable on browsers that support installation, with its own name, icon, and standalone window. Installed app name is `n-tutor` for both `name` and `short_name`.
- When running in a browser tab (not installed) on a browser that can install the app, a dismissible banner invites the person to install: a one-tap install action where the browser provides one, or brief add-to-home-screen instructions where it does not (iOS/iPadOS Safari).
- Banner placement: Student Mode — Home screen only (never Take Test, never Results). Parent View — every screen except the camera capture view.
- The banner never renders when running installed, and never on a browser with no install path (no dead-end instructions). Dismissal hides it for the remainder of the browser session; it returns in a new session.
- All icon and manifest assets are bundled/self-hosted — no runtime CDN fetch. Icon art is the real books-and-pencil "N" on ivory, shipped as committed raster exports only; no SVG icon ships (a vector would be preferred by Chrome over the correct PNGs).
- Palette must match the app icon ("Reading Room": warm ivory grounds, forest-green Student accent, ink-navy Parent accent, moss secondary), in light and dark, across Student Mode, Parent View, Admin, and camera capture. No surface may be left on an old (cool-grey/teal-accent) value.
- Every contrast pair named in the design doc's measured-contrast table must meet its floor (4.5:1 text, 3:1 non-text/divider) in both modes, enforced by a unit spec computed from the colour tokens so a future token change breaks CI.
- Grade states must stay identifiable with colour removed (glyph, word, shape) — re-verified because Correct and Not-graded-yet separate largely by hue.
- No new dependencies. No API, DB, worker, or Compose changes. Front-end only.
- Success bar: no manifest installability errors in Chrome DevTools on production; Android/desktop Chrome offer Install and open standalone with correct icon and name; iPad Safari Add to Home Screen yields correct icon/name and standalone window; banner has zero accessibility violations in light and dark; existing unit and E2E suites pass unchanged.

## Technical Decisions

- **The service worker exists for installability only and never touches requests.** A single static worker at `/sw.js`, scope `/`, install/activate handlers only: no `fetch` handler, no Cache Storage, no push subscription, and `skipWaiting`/`clients.claim` so a new version takes over on next load. Rationale: a caching worker could serve Parent-View or child data across sessions or past a Parent View expiry, serve stale JS after a deploy, and create a second client-persistence mechanism beside the sanctioned in-progress Attempt state.
- `/sw.js` must be served with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript` so worker updates roll out; handled via the Next.js config `headers()`.
- The manifest is a Next.js metadata route (`app/manifest.ts`), not a static file. Icons use the framework's `icon` / `apple-icon` file conventions. Required set: 192×192, 512×512, inset maskable 512×512, plus a 180×180 apple-icon. The favicon must use RGBA PNG entries — Next cannot decode RGB entries and fails every page.
- Manifest fields: `start_url: "/"`, `scope: "/"`, `display: "standalone"`, with `theme_color` and `background_color` from the brand design tokens (never new hex literals). `viewport.themeColor` is set in the root layout for both light and dark schemes from tokens. Service-worker registration happens in a client component on load.
- **All colour lives in the theme token module.** The palette change is value-only: no token added, removed, or renamed, and no hex literal introduced outside that module. The MUI mapping layer needs no change; specs comparing against the tokens follow automatically, and any spec or comment pinning a literal is updated in-story.
- The accent means *interactive*, so the semantic Correct colour moves to teal (the retired Student accent) now that the Student accent is forest green — a hue no interactive control uses.
- Brand tokens are not palette tokens: the icon's ground and ink colours are their own tokens, used only by the manifest and browser theme-color, and are left unchanged. They equal certain palette values by **deliberate duplication** — never alias one to the other, because the icon must not change when the palette does. The camera-capture chrome's inverted set is likewise a deliberate duplicate; its explanatory comments must name the new values.
- Tints move, dividers never do: where a hover/selected tint fails the 3:1 floor against the divider, the tint is the value that changes.
- The HTML mockups are painted in the superseded palette; they remain valid for layout, hierarchy, and state treatment, but the design doc wins on colour.

## UX & Interaction Patterns

- **Install Banner pattern:** one compact strip at the top of the content area, below the surface header — text, one action, and a dismiss button. It never overlays content, never blocks interaction, never animates in a way that pulls focus, and must not shift content after first paint (render from the first client render, or reserve space).
- It uses the active surface's tokens and density: Student palette in Student Mode, Parent palette in Parent View.
- Accessibility: `role="region"` with an accessible name; dismiss is a real button; fully reachable and dismissible by keyboard and screen reader; meets the project's Accessibility Floor in light and dark.
- Copy is plain and calm — no exclamation marks, no urgency — and lives in the `copy/` modules. Intent of the three strings: a Parent View line about adding to the home screen to open in one tap; a Student Mode Home line about putting practice tests one tap away; and an iOS line giving the Share → Add to Home Screen steps plus a note that the person will sign in once more after adding it.
- Install action behavior: on accept the banner disappears and does not return; on cancel it remains until dismissed. Detection: `beforeinstallprompt` for the install path; `display-mode: standalone` (or `navigator.standalone` on iOS) for the installed check; sessionStorage for dismissal.
- **Why the banner is kept off Take Test:** the child is mid-Attempt and nothing but the Question should compete for attention; installing from iOS Safari mid-Attempt would also strand answers, because an iOS home-screen web app has its own cookie/storage jar separate from Safari. That partition is why the iOS copy warns about signing in once more.
- Warmth in the palette comes from the grounds, never from decoration: no gold flourishes, textures, or book illustrations inside the app. The installed splash ground and the in-app paper are the same ivory so the launch transition is seamless.

## Cross-Story Dependencies

- Story 10.1 must land before Story 10.2: the banner depends on the manifest being served for `beforeinstallprompt` to fire at all.
- Story 10.3 is independent of 10.1/10.2 in sequence, but 10.1's manifest/theme-color values and 10.2's banner styling both read the same tokens, so the palette swap must leave those keys intact.
- All three stories consume the design-system tokens established in the Design System Foundation work (theme/background colours, surface palettes, density) and the existing `copy/` module convention — reuse rather than extend.
- Testing dependencies: 10.2 needs unit coverage of the visibility rules plus a Playwright E2E in Chromium (shown → dismissed → hidden → new browser context shown again; standalone emulated → hidden). 10.3 needs the new contrast-pair unit spec plus a light/dark visual pass across Student Home, Take Test, Results, Parent dashboard, Analytics, Capture, and Admin, and a greyscale check of the grade states.
