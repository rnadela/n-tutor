# Epic 10 Context: Installable App (PWA)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A family can install n-tutor to the home screen of a tablet or phone and open it in one tap, the app gently tells them that they can, the palette matches the icon they tapped, and below desktop width the app navigates like a native one through a bottom tab bar. Purely front-end and additive: installing changes how the app is opened, not what it does. No capability, permission, or offline change — the single existing offline carve-out stays the only offline behavior, and an installed app opened without a connection behaves exactly like the browser tab. Explicitly not a step toward native apps or push notifications. No API, schema, architecture-decision, or deploy change anywhere in the epic, and no new dependencies.

## Stories

- Story 10.1: Web App Manifest, Icons & Minimal Service Worker
- Story 10.2: Install Banner
- Story 10.3: Brand Palette
- Story 10.4: Bottom Navigation Below Desktop
- Story 10.5: Student Results Tab

## Requirements & Constraints

- Installable on browsers that support it, with its own name (`n-tutor` for both name fields), icon, and standalone window. All icon and manifest assets self-hosted — no runtime CDN fetch. Icon art ships as committed raster exports only; no SVG icon, which Chrome would prefer over the correct PNGs.
- In a browser tab on a browser that can install, a dismissible banner invites installation: a one-tap action where the browser offers one, brief add-to-home-screen steps where it does not (iOS/iPadOS Safari). Never when running installed, and never on a browser with no install path — no dead-end instructions. Dismissal hides it for the rest of the browser session; it returns in a new one.
- Banner placement: Student Mode Home only (never Take Test, never Results); every Parent View screen except camera capture.
- Palette must match the icon (warm ivory grounds, forest-green Student accent, ink-navy Parent accent, moss secondary), light and dark, across Student Mode, Parent View, Admin, and camera capture, with no surface left on an old cool-grey/teal-accent value.
- Every contrast pair in the design doc's measured table must meet its floor (4.5:1 text, 3:1 non-text/divider) in both modes, enforced by a spec computed from the colour tokens so a future token change breaks CI. Grade states must stay identifiable with colour removed (glyph, word, shape) — Correct and Not-graded-yet separate largely by hue.
- Below `lg` (1200px) every signed-in surface — Parent View, Student Mode, Admin — navigates by a fixed bottom tab bar instead of a sidebar or header hamburger; at `lg` and above the existing sidebar is unchanged. One layout per width, in a tab and installed alike. Sign-in pages get no bar.
- Tabs: Parent — Home, Upload, Drafts, Attempts, More (More opens the existing full grouped destination list). Admin — Overview, Taxonomy, Accounts, Flagged, Topics (all five fit; no More). Student — Home, Results, Parent View (the PIN gate).
- The bar is absent on the PIN gate, Admin sign-in, sign-in pages, inside an Attempt and its results, while the camera viewfinder is open, and while a text field has focus on a touch device. No content, tab, or snackbar may sit under the bar or under an iOS home indicator.
- A Student Results screen lists only the bound profile's completed Practice Tests, newest first, reusing Home's row component and the existing student endpoints — no new API, no profile id in the request — with an empty state saying what will appear and how. Student Home's flat list stays unchanged and still includes completed tests; at `lg` and above Results is reachable from a Home link, so it is not a narrow-only screen.
- Success bar: no manifest installability errors in production DevTools; Chrome offers Install and opens standalone with the right icon and name; iPad Add to Home Screen the same; Parent View tab navigation never re-prompts for the PIN; banner and bar have zero accessibility violations in light and dark; existing unit, contrast, and E2E suites pass.

## Technical Decisions

- **The service worker exists for installability only and never touches requests.** One static worker at `/sw.js`, scope `/`, install/activate only: no `fetch` handler, no Cache Storage, no push subscription, and `skipWaiting`/`clients.claim` so a new version takes over on next load. A caching worker could serve Parent-View or child data across sessions or past a Parent View expiry, serve stale JS after a deploy, and add a second client-persistence mechanism beside the sanctioned in-progress Attempt state. `/sw.js` is served no-store with a JS content type via the Next config `headers()`.
- The manifest is a Next metadata route, not a static file; icons use the framework's `icon`/`apple-icon` conventions (192, 512, inset maskable 512, 180 apple-icon). The favicon needs RGBA PNG entries — RGB entries cannot be decoded and fail every page. `start_url` and `scope` at `/`, `display: standalone`, theme and background colours from brand tokens, never new hex literals. The root layout sets `viewport.themeColor` for both schemes from tokens and declares `viewportFit: 'cover'` so `env(safe-area-inset-*)` resolves on iOS. Worker registration happens in a client component on load.
- **All colour lives in the theme token module.** The palette change is value-only: no token added, removed, or renamed, no hex literal outside that module. The MUI mapping layer needs no change; specs comparing against tokens follow automatically, and any spec or comment pinning a literal is updated in-story.
- The accent means *interactive*, so semantic Correct is teal (the retired Student accent) now that the Student accent is forest green — a hue no interactive control uses. Tints move, dividers never do: where a hover/selected tint fails the 3:1 floor against the divider, the tint is what changes.
- Brand tokens are not palette tokens: the icon's ground and ink colours are their own tokens, used only by the manifest and browser theme-color, and are unchanged. They equal certain palette values by **deliberate duplication** — never alias one to the other, because the icon must not change when the palette does. The camera-capture inverted set is likewise a deliberate duplicate whose comments must name its values.
- **The bottom bar is a second view of the same destination data, not a second navigation.** It reuses the existing grouped destination lists and the existing drawer, which the Parent More action opens, so the two cannot drift.
- The bar is a shared component taking items as props (href, label, icon, match) plus an optional More action firing a callback instead of navigating. Fixed to the bottom, paper background, 1px divider top border, no shadow, icon above an always-visible label. The current tab is marked three ways — primary colour, bold weight, short indicator bar — never colour alone, and carries `aria-current="page"`. Each surface keeps its own density for tap targets. No hide-on-scroll, no inter-tab transition, under the motion policy.
- Breakpoint switching is **CSS-only** — no viewport hook — so there is no layout swap after first paint, matching the cards-below-desktop rule.
- Every tab navigates client-side via a Next `<Link>`, because Parent View elevation dies on a full page load; a tab press must never re-prompt for the PIN.
- Visibility is a pure pathname helper modeled on the existing colour-mode-switch helper (false for the PIN gate, Admin sign-in, auth routes, student test routes). The camera viewfinder hides the bar from the capture component itself via the existing capture-open state or a small context; keyboard-focus hiding applies only on a coarse pointer.
- Each shell pads content by bar height plus the bottom inset; the bar pads by bottom, left, and right insets; the shared snackbar's bottom anchor is offset by the same amount below `lg`.
- Parent and Admin shells move their sidebar/drawer breakpoint from `md` to `lg` and drop the header hamburger below `lg`, keeping page title, colour mode switch, and exit/sign-out in the header. The 900–1199px range intentionally changes from sidebar to bar.
- Results is a new student route reading the existing practice-test and run endpoints, filtering to completed on the client, newest first, reusing Home's row component; a row opens the existing results route.
- All bar and banner labels live in the `copy/` modules.
- The HTML mockups are painted in the superseded palette; still valid for layout, hierarchy, and state treatment, but the design doc wins on colour.

## UX & Interaction Patterns

- **Install Banner:** one compact strip at the top of the content area, below the surface header — text, one action, a dismiss button. Never overlays content, never blocks interaction, never animates in a way that pulls focus, and must not shift content after first paint (render from the first client render, or reserve space). Uses the active surface's tokens and density. `role="region"` with an accessible name; dismiss is a real button; fully keyboard- and screen-reader-operable. Copy is plain and calm — no exclamation marks, no urgency. On accept it disappears for good; on cancel it stays until dismissed. Detection: `beforeinstallprompt` for the install path, standalone display-mode (or the iOS standalone flag) for the installed check, sessionStorage for dismissal.
- **Why the banner stays off Take Test:** the child is mid-Attempt and nothing but the Question should compete; installing from iOS Safari mid-Attempt would also strand answers, because an iOS home-screen web app has its own storage jar separate from Safari. That partition is why the iOS copy warns about signing in once more.
- **Why the bar replaces the hamburger:** the top-left hamburger is the hardest spot to reach one-handed and hides where you are; once installed there is no browser chrome, so the app's own navigation is the whole experience. Pending drafts stays first-class as its own Parent tab rather than living behind More, and More is the current Parent tab on any route not under the other four.
- Below `lg` the Student Home "Parent View" link is not rendered, because the tab replaces it (same destination, same lock glyph); at `lg` and above it shows as today, alongside the new Results link.
- The bar never appears where it would compete with the task: the PIN gate, inside an Attempt, the camera viewfinder, or while typing.
- Banner and bar are landmarks with accessible names and must meet the project's Accessibility Floor in light and dark.
- Warmth comes from the grounds, never decoration: no gold flourishes, textures, or book illustrations inside the app. The installed splash ground and the in-app paper are the same ivory, so the launch transition is seamless.

## Cross-Story Dependencies

- 10.1 before 10.2: the banner depends on the manifest being served for `beforeinstallprompt` to fire at all.
- 10.3 is independent in sequence, but 10.1's manifest/theme-color values and 10.2's banner styling read the same tokens, so the palette swap must leave those keys intact.
- 10.4 before 10.5: 10.5 adds the Results tab to the bar 10.4 builds and extends 10.4's E2E to open Results from it.
- 10.4 re-checks 10.2's mobile visual pass with the bar present, and owns that pass rather than reopening 10.2; earlier mobile-layout stories (row actions, cards-below-desktop, colour mode switch) are likewise covered by it, not reopened.
- 10.5 depends on the shipped student test-list work for its row component and endpoints; Home's flat list must not change.
- All stories consume the Design System Foundation tokens (theme/background colours, surface palettes, density, tap targets) and the existing `copy/` convention — reuse rather than extend.
- Testing: 10.2 — unit coverage of the visibility rules plus a Chromium E2E (shown → dismissed → hidden → new context shown again; standalone emulated → hidden). 10.3 — the contrast-pair spec plus a light/dark visual pass across Student Home, Take Test, Results, Parent dashboard, Analytics, Capture, Admin, and a greyscale check of grade states. 10.4 — unit specs for the bar and the visibility helper, plus an E2E at 390×844, 820×1180, 1180×820 (bar shown, tab navigation with no PIN re-prompt, More opens, bar absent on PIN gate and inside an Attempt) and 1280×800 (sidebar, no bar). 10.5 — unit coverage of the completed-only filter, newest-first order, and empty state.
