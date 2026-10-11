# Sprint Change Proposal — Installable App (PWA) + Install Banner

- **Date:** 2026-10-11
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Scope classification:** Minor (additive; direct Developer implementation)

## 1. Issue Summary

**Trigger.** Product request after Epics 1–9 completed: families should be able to open the app like an app — one tap from the home screen of the family tablet or the parent's phone — instead of finding a browser tab or bookmark.

**Problem.** The web app is not installable. `apps/web` has no web app manifest, no app icons, no service worker, and no `theme-color`. Browsers therefore never offer "Install" / "Add to Home Screen" with a proper icon, and nothing in the product tells a family that installing is possible.

**Evidence.**
- `apps/web/public/` is empty; no `app/manifest.ts`, no `icon.*`, no `apple-icon.*`.
- `apps/web/src/app/layout.tsx` metadata sets `title` only.
- PRD §6.1: "Mobile-first responsive web application. Single codebase, no app store." — a PWA satisfies this without contradicting it.

**Decisions taken (with Rvnadela, 2026-10-11).**
| Decision | Choice |
|---|---|
| Banner placement | Both Student Mode and Parent View (refined below: never mid-test or in the camera) |
| Dismissal | Per browser session — dismissing hides it until the next session; never shown once installed |
| Service worker scope | Minimal — installability only, no caching of pages or data, offline rules unchanged (FR-36) |
| Icon | Placeholder monogram "n" on Student teal `#0F6E78`, generated in-repo; replaceable later |
| Installed app name | `n-tutor` (both `name` and `short_name`) |
| Student Mode placement | Home screen only (not Take Test, not Results) |

## 2. Impact Analysis

### Epic impact
- Epics 1–9: **no change** to completed scope. No story reopened, no rollback.
- **New Epic 10: Installable App (PWA)** — two stories.

### Story impact
- New: Story 10.1 (manifest, icons, service worker), Story 10.2 (install banner).
- Existing stories: none modified. Story 1.7 (Design System Foundation) tokens are reused for `theme_color` / `background_color`.

### Artifact conflicts
| Artifact | Conflict | Update |
|---|---|---|
| PRD | §6.1 says "no app store" — no conflict. §9.2 defers "Native mobile apps" and "Notifications (push)" — PWA must not drift into either. | Add FR-41; clarify §6.1 and §9.2. |
| Epics | No PWA coverage. | Add FR-41 to inventory + coverage map, UX-DR42, Epic 10 with 2 stories. |
| Architecture | No service-worker decision; child-data posture (AD-26 client-owned Attempt state, httpOnly session cookie) must not be undermined by a caching worker. | Add AD-35. |
| UX (EXPERIENCE.md) | Student Mode is child-facing and Take Test must stay free of distraction. No install-prompt pattern exists. | Add Install Banner component pattern + platform note. |

### Technical impact
- `apps/web/src/app/manifest.ts` (Next.js 16 metadata route), `icon.png` / `apple-icon.png` file conventions, `public/sw.js`, registration in a client component, banner component + copy, `viewport.themeColor` in root layout.
- **No new dependencies.** No API, DB, worker, or Compose changes.
- Deployment: `sw.js` must be served with `Cache-Control: no-cache` so updates roll out; `next.config.ts` `headers()` handles it.

### Risks
1. **iOS storage partition.** On iOS, a home-screen web app has its own cookie/storage jar separate from Safari. A family that installs from Safari must sign in once more inside the installed app, and an Attempt in progress in Safari (AD-26 client storage) will not appear in the installed app. Mitigation: banner copy on iOS says "You'll sign in once more after adding it"; banner never appears on Take Test, so no in-progress Attempt is stranded by the act of installing.
2. **iOS has no install prompt API.** Safari never fires `beforeinstallprompt`; the banner shows short instructions (Share → Add to Home Screen) instead of an Install button.
3. **Browsers that cannot install** (e.g. Firefox desktop): banner is not shown at all — no dead-end instructions.
4. **Stale code from a worker.** Avoided by AD-35: worker has no `fetch` handler and caches nothing.

## 3. Recommended Approach

**Direct Adjustment** — add Epic 10 with two stories to the existing plan.

- **Rationale:** purely additive, front-end only, no interaction with completed business logic. Next.js 16 ships first-class manifest and icon conventions (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`), so no library is needed.
- **Effort:** Small — ~1 day total (10.1 ≈ 0.5d incl. icon art; 10.2 ≈ 0.5d incl. tests).
- **Risk:** Low. Main risk is iOS storage partition (documented above).
- **Timeline:** No effect on completed epics; Epic 10 can ship independently.

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-n-test-reviewer-2026-08-29/prd.md`)

**§6.1 Platform**

OLD:
> Mobile-first responsive web application. Single codebase, no app store, camera access via the browser. Must be usable on a phone held one-handed in a kitchen and on a family tablet. Desktop is supported but not optimized. Native apps are explicitly v2+.

NEW:
> Mobile-first responsive web application. Single codebase, no app store, camera access via the browser. Must be usable on a phone held one-handed in a kitchen and on a family tablet. Desktop is supported but not optimized. **The web app is installable to the home screen as a Progressive Web App (FR-41), so a family reaches it in one tap; installing changes how the app is opened, not what it does.** Native apps are explicitly v2+.

Rationale: records installability as scope while keeping the "single codebase, no app store" constraint intact.

**New FR (add after FR-40, in the Platform/cross-cutting group)**

> **FR-41: Installable app and install nudge.** The web app is installable to a device's home screen with its own name, icon, and standalone window on browsers that support installation. When the app is running in a browser tab (not installed) on a browser that supports installing it, a dismissible banner invites the person to install it — with a one-tap install action where the browser provides one, or brief add-to-home-screen instructions where it does not (iOS/iPadOS Safari). Dismissing hides the banner for the rest of that browser session. In Student Mode the banner appears on the Home screen only; in Parent View it appears on every screen except the camera capture view. It never appears once the app is running installed, and never on a browser that cannot install the app. Installing does not change any capability, permission, or offline behavior: FR-36 remains the only offline behavior.

**§9.2 Out of Scope — clarify two bullets**

OLD:
> - **Native mobile apps** — v2+.

NEW:
> - **Native mobile apps** — v2+. *(The installable web app in FR-41 is not a native app: same codebase, no app store, no device capability beyond what the browser already grants.)*

OLD (first clause of Offline test-taking bullet):
> - **Offline test-taking** — network required, with one carve-out (FR-36).

NEW:
> - **Offline test-taking** — network required, with one carve-out (FR-36). *Installing the app (FR-41) does not add offline capability; an installed app opened without a connection behaves like the browser tab does.*

Notifications bullet unchanged — push remains deferred; the service worker in FR-41 registers no push subscription.

### 4.2 Epics (`epics.md`)

**Requirements Inventory → Functional Requirements** — append FR-41 (text as in 4.1).

**FR Coverage Map** — append:
> FR-41: Epic 10 - Installable app (PWA) + install banner

**UX Design Requirements** — append:
> UX-DR42: Implement the Install Banner: a single, compact, dismissible banner at the top of the content area, using the active surface's density and tokens (Student palette in Student Mode, Parent palette in Parent View). It never overlays content, never blocks interaction, never animates in a way that pulls focus, and is reachable and dismissible by keyboard and screen reader (`role="region"` with an accessible name; dismiss is a real button). In Student Mode, rendered on Home only (never Take Test or Results); in Parent View, not rendered on the camera capture view; not rendered when running installed (standalone display mode), or on browsers without an install path. Copy is plain and calm, no exclamation marks, no urgency.

**Epic List** — append:
> ### Epic 10: Installable App (PWA)
> A family can install n-tutor to the home screen of their tablet or phone and open it in one tap, and the app gently tells them that they can.
> **FRs covered:** FR-41

**New epic section (append after Epic 9):**

> ## Epic 10: Installable App (PWA)
>
> A family can install n-tutor to the home screen of their tablet or phone and open it in one tap, and the app gently tells them that they can.
>
> **FRs covered:** FR-41
> **Relevant UX-DRs:** UX-DR42, UX-DR5 (self-hosted assets, no runtime CDN)
>
> ### Story 10.1: Web App Manifest, Icons & Minimal Service Worker
>
> As a parent,
> I want the app to be installable with its own icon,
> So that the family can open it from the home screen like any other app.
>
> **Acceptance Criteria:**
>
> **Given** the web app is served over HTTPS
> **When** a supporting browser (Chrome/Edge on Android, desktop Chrome/Edge) evaluates it
> **Then** it is installable: a manifest is served from the Next.js `app/manifest.ts` metadata route with `name: "n-tutor"`, `short_name: "n-tutor"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `theme_color` and `background_color` taken from design tokens, and 192×192, 512×512, and 512×512 maskable PNG icons
>
> **Given** iOS/iPadOS Safari
> **When** the person adds the app to the home screen
> **Then** it uses an `apple-icon` (180×180) and opens standalone with the correct app name
>
> **Given** the root layout
> **When** any page renders
> **Then** `viewport.themeColor` is set for light and dark color schemes from design tokens
>
> **Given** the service worker at `/sw.js`
> **When** it is registered on load
> **Then** it registers at scope `/`, has no `fetch` handler, caches nothing, registers no push subscription, and calls `skipWaiting`/`clients.claim` so a new version takes over on next load
> **And** `/sw.js` is served with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript`
>
> **Given** the app is opened installed without a network connection
> **When** any screen loads
> **Then** behavior is identical to the browser tab offline (FR-36 unchanged; no cached pages)
>
> **Given** all icon and manifest assets
> **Then** they are bundled/self-hosted (no runtime CDN fetch)
>
> ### Story 10.2: Install Banner
>
> As a parent or student,
> I want the app to tell me I can install it,
> So that getting back into it next time is one tap.
>
> **Acceptance Criteria:**
>
> **Given** a browser that fires `beforeinstallprompt` and the app is not running installed
> **When** the Student Mode Home screen or any Parent View screen (except camera capture) renders
> **Then** the Install Banner shows with an "Install" action that calls the deferred prompt
> **And** on accept, the banner disappears and does not return; on cancel, the banner remains until dismissed
>
> **Given** iOS/iPadOS Safari, not running installed
> **When** the same screens render
> **Then** the banner shows brief instructions (tap Share, then "Add to Home Screen") instead of an Install button, plus a line that the person will sign in once more inside the installed app
>
> **Given** a browser with no install path (no `beforeinstallprompt`, not iOS Safari)
> **Then** the banner never renders
>
> **Given** the app is running installed (`display-mode: standalone`, or `navigator.standalone` on iOS)
> **Then** the banner never renders
>
> **Given** the banner is showing
> **When** the person dismisses it
> **Then** it is hidden for the remainder of the browser session (sessionStorage) and returns in a new session
>
> **Given** any Student Mode screen other than Home (Take Test, Results) or the Parent View camera capture view
> **Then** the banner never renders
>
> **Given** the banner
> **Then** it meets UX-DR42 and the Accessibility Floor in light and dark mode, its copy lives in the `copy/` modules, and it is covered by a unit test (visibility rules) and a Playwright E2E (Chromium: shown → dismissed → hidden → new context shown again; standalone emulated → hidden)

### 4.3 Architecture (`architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md`)

**New decision (append after AD-34):**

> ### AD-35 — The service worker exists for installability only and never touches requests
>
> - **Decision:** `web` ships a single static service worker at `/sw.js`, scope `/`, with install/activate handlers only. It has **no `fetch` handler**, uses **no Cache Storage**, and registers **no push subscription**. The manifest is the Next.js `app/manifest.ts` metadata route; icons use the `icon` / `apple-icon` file conventions.
> - **Why:** installability is the only goal. A caching worker would put Parent-View and child data at risk of being served across sessions or after a Parent View expiry (FR-34), could serve stale JS after a deploy, and would create a second offline mechanism beside AD-26, which is the only sanctioned client-side persistence.
> - **Binds:** `apps/web/public/sw.js`, its registration component, `next.config.ts` `headers()` for `/sw.js` (`no-cache`), `app/manifest.ts`, icon files.
> - **Revisit if:** push notifications (PRD §9.2, deferred to v1) are taken up — that is a new decision, not an extension of this one.

**Structural Seed** — add under `apps/web`: `src/app/manifest.ts`, `src/app/icon.png`, `src/app/apple-icon.png`, `public/sw.js`, `public/icons/` (192, 512, maskable-512).

### 4.4 UX (`ux-designs/ux-n-test-reviewer-2026-08-29/EXPERIENCE.md`)

**Component Patterns — add "Install Banner":**

> **Install Banner.** One compact strip at the top of the content area, below the surface header. Text + one action + a dismiss button. It does not overlay content or shift it after first paint (rendered from the first client render, or reserved space). Student palette in Student Mode, Parent palette in Parent View; density follows the surface.
>
> | Context | Shown? | Action |
> |---|---|---|
> | Browser offers install (`beforeinstallprompt`) | Yes | "Install" button opens the browser's install dialog |
> | iOS / iPadOS Safari | Yes | Instruction text: Share → Add to Home Screen; notes one more sign-in |
> | No install path | No | — |
> | Running installed | No | — |
> | Student Mode other than Home (Take Test, Results) | No | — |
| Camera capture | No | — |
> | Dismissed this session | No | Returns next session |
>
> *Why not on Take Test:* the child is mid-Attempt; nothing that isn't the Question competes for attention, and installing from Safari mid-Attempt would strand answers in the Safari storage jar (iOS partition).

**Draft copy (Voice and Tone — calm, no exclamation, no urgency):**
- Parent View: "Add n-tutor to your home screen to open it in one tap." — [Install] [Not now]
- Student Mode Home: "Put your practice tests one tap away on this device." — [Install] [Not now]
- iOS line: "Tap Share, then Add to Home Screen. You'll sign in once more after adding it."

**Responsive & Platform — append:**

> **Installable.** The app is installable as a PWA (FR-41) on every surface; installed, it opens standalone with the surface's own theme color. Installing changes nothing about layout, density, or offline behavior.

## 5. Implementation Handoff

- **Scope:** Minor → **Developer agent** (`bmad-build`) implements directly.
- **Order:** Story 10.1 then 10.2 (banner depends on manifest for `beforeinstallprompt` to fire).
- **Sprint status:** add `epic-10`, `10-1-web-app-manifest-icons-minimal-service-worker`, `10-2-install-banner` as `backlog` in `sprint-status.yaml`.
- **Artifact edits (on approval):** apply 4.1–4.4 to PRD, epics, architecture spine, EXPERIENCE.md.

### Success criteria
1. Chrome DevTools → Application → Manifest shows no installability errors on production URL.
2. Android Chrome and desktop Chrome offer Install; installed app opens standalone with correct icon and name.
3. iPad Safari "Add to Home Screen" yields correct icon/name, standalone window.
4. Banner rules in Story 10.2 pass in unit + Playwright tests; never visible on Take Test or capture.
5. Lighthouse/axe: banner has no accessibility violations, light and dark.
6. No change to existing E2E suite results.

## 6. Resolved Questions

1. Icon — placeholder monogram "n" on Student teal `#0F6E78`, generated in-repo (Story 10.1).
2. Installed name — `n-tutor` for `name` and `short_name`.
3. Student Mode placement — Home only.

## 7. Approval

Approved by Rvnadela, 2026-10-11. Routed to Developer agent (`bmad-build`).
