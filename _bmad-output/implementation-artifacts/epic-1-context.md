# Epic 1 Context: Parent Accounts, PINs & Student Profiles

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Establish the product's identity and safety spine: a parent can create an account and sign in on any device, gate parent-only controls behind a numeric PIN, create and manage Student Profiles, and bind a device between Student Mode (the default state) and Parent View — including a silent idle expiry that returns the device to the child and a server-side mechanism that preserves whatever the parent was mid-way through. Because Student Mode is the device default and a child shares the device, the mode boundary is a real security boundary, not a UI convention. This epic also lands the shared design-system foundation every later epic builds on, so no feature story invents its own tokens or primitives.

## Stories

- Story 1.1: Parent Account Sign-Up & Sign-In
- Story 1.2: Parent PIN for Parent View
- Story 1.3: Student Profile Management
- Story 1.4: Student Mode ↔ Parent View Switching
- Story 1.5: Parent View Idle Expiry
- Story 1.6: Uncommitted Parent Input Survives Expiry (mechanism)
- Story 1.7: Design System Foundation

## Requirements & Constraints

- Sign-up takes email, password, and explicit terms + child-data-consent acceptance, recorded with a timestamp and the notice version. A duplicate-email attempt is rejected with a generic message that never reveals an account exists; the same applies to sign-in errors and password-reset requests. Password reset is by emailed link. The session persists until explicit sign-out.
- An account timezone is captured at sign-up from the device default and is editable in Settings. It bounds every allowance period later (Epic 9), so it must be stored from day one.
- A numeric Parent PIN gates every Student Mode → Parent View transition, including after restart. Changing it requires the current PIN or the account password. Three consecutive failures lock Parent View for a cool-down that survives restart; the failure count persists too. The PIN is hashed and never displayed back.
- A Student Profile requires a display name and exactly one Admin-configured Grade Level. Rename and Grade-Level change never alter existing Practice Tests. Archiving hides a profile from Student Mode selection while preserving Attempt and Mastery history — deliberately distinct from deletion (Epic 8). Tier-based profile caps are not enforced here (Epic 9).
- The device binds to a Student Profile when the first profile is created. A deliberate exit from Parent View on a multi-profile account prompts which profile to bind to, defaulting to the last-bound one; a silent expiry cannot prompt and falls back to last-bound.
- In Student Mode no upload, generation, release, cross-profile data, or Analytics surface is reachable — by navigation or by direct URL. The PIN prompt is the only path out.
- Parent View expires after 15 minutes of inactivity: silent, no warning, no countdown, uniform across every Parent View surface. Re-entry requires the PIN and the same cool-down rules.
- Because expiry is unannounced, uncommitted parent input must survive it without an explicit save and be restored exactly, and re-entry returns the parent where they left off rather than to the Parent View root. Retained state is server-side only, keyed to the Parent Account, never written to client storage; restoration happens strictly after PIN verification; a cross-profile fetch is rejected server-side; the state carries its own TTL.
- Passwords and PINs are stored hashed; all traffic over TLS. Authorization is enforced server-side for every request — Student Mode restrictions are never client-side-only, and a client that fails to expire must not retain Parent View authority.

## Technical Decisions

- Inherited, hand-assembled stack — no scaffolding generator: Turborepo + pnpm workspaces, NestJS + Prisma + PostgreSQL (`apps/api`), Next.js + React + MUI (`apps/web`), Playwright E2E, Docker Compose. JWT auth with argon2 hashing for both the account password and the PIN. This epic stands the monorepo up directly.
- **Split credentials.** Identity is an httpOnly / Secure / SameSite=Strict session cookie, unreadable by JS, surviving refresh — it answers *which account* and never by itself satisfies a parent-scoped endpoint. Elevation is a separate parent-scoped token held in React context, **in memory only**, lost on any full page load; crossing the PIN mints it.
- **No parent-scoped data is ever server-rendered.** Parent surfaces fetch client-side carrying the elevation token; a server-rendered parent screen is a defect. A refresh or hard navigation intentionally drops the parent back to the PIN — which is exactly why the uncommitted-state mechanism exists.
- **The mode lives in the token.** Entering Student Mode for a profile mints a session token carrying that Student Profile; every student-scoped endpoint reads the profile from the token, never from a request parameter. Switching profiles means re-crossing the mode gate.
- **Idle clock:** the client owns it, tracking real interaction (pointer, key, scroll, touch) and *requesting* a refreshed elevation token while the parent is active. Polling is not interaction and must not touch the clock. The client can never extend a token — the server mints replacements; the elevation window is 15 minutes with an absolute 8-hour ceiling on total elevation.
- **Uncommitted state is one lifecycle, one TTL.** FR-35 restorable state and the orphaned-capture sweep are the same mechanism at two moments: a row is restorable until its TTL elapses and an orphan after. TTL is 72 hours from row creation, never extended by activity; expiry deletes the row outright. Reads are gated on a parent-scoped token. Story 1.6 ships this general mechanism only — draft edits (Epic 4), grade overrides (Epic 6), and partial uploads (Epic 3) plug into it later, each adding one AC rather than rebuilding it.
- **Module ownership:** `identity` owns Parent Account, Student Profile, and sessions and is their sole writer. No other module touches its Prisma delegate; cross-module write methods take the caller's transaction client as their first parameter.
- The account timezone is an **effective-dated history**, not a mutable field; a change applies from the next period boundary and never re-slices a running period.
- Destructive actions require fresh account-password re-authentication verified server-side — never the PIN, which gates a mode rather than destruction.
- Logs, error reports, and audit rows never carry child content; Sentry runs with `sendDefaultPii: false` and aggressive default capture suppression.

## UX & Interaction Patterns

- Four surfaces: Auth (unauthenticated), Student Mode (device default), Parent View (PIN-gated), Admin. Light and dark both ship.
- One base MUI theme with a nested `ThemeProvider` overriding `palette.primary` only per surface (student accent vs. parent accent); every other token is byte-identical across surfaces. Student Mode runs `density.comfortable` with a 48px tap-target floor; Parent View and Admin run `density.compact` with a 44px floor.
- Typography is assigned by content type, never by surface: serif for generated content wherever it appears, sans for all interface chrome, across an eight-role type scale. Tabular figures on any numeral that aligns in a column or ticks in place.
- Flat-with-borders elevation: `elevation={0}` everywhere, a 1px divider-colored border as every control's boundary, scrim-plus-border (never a shadow) for dialogs, menus, and the PIN prompt. Semantic radius: square paper role for generated content, rounded control role for anything tappable. One focus-ring mechanism product-wide.
- Story 1.7 delivers the reusable primitives later epics assume exist: text field, primary and destructive buttons (destructive intent carried by label text plus an outlined error-color border, never a filled red button), dialog and destructive-confirm dialog (names exactly what is destroyed, takes the account password, states it cannot be undone), and snackbar.
- Cross-cutting rules enforced from the first screen: every control is a real control (no `<div>`/`<span>` carries an action, state, or `aria-expanded`); no result/analytics string is a fixed literal — each takes its subject as a parameter and resolves second-person (Student Mode) or third-person-by-name (Parent View) through one shared address-resolution component; focus order follows reading order; icon-only controls are labeled with the object they act on; meaningful state changes announce via a live region using the displayed copy verbatim; `prefers-reduced-motion` honored; motion is functional-plus-progress only, with no decorative flourishes.
- Every screen in this epic is a single fluid layout unchanged between phone and tablet; desktop is supported but not optimized.
- Copy is plain and factual: no exclamation marks, cheerleading, error codes, or apology paragraphs. The PIN cool-down message states the lock and when it lifts, never framing an attempt counter as a taunt. Profile-limit and destructive-confirmation copy names specifics rather than asking "Are you sure?".
- An explicit "Back to Student Mode" control always exists in Parent View. The Student Profile switcher is reachable from anywhere in Parent View and preserves the current view rather than resetting to a root.

## Cross-Story Dependencies

- Story 1.7 is foundational: Stories 1.1–1.6 are built on the design system, not ahead of it.
- Story 1.2 (PIN, cool-down) gates Story 1.4's mode transitions and is reused verbatim by Story 1.5's re-entry path.
- Story 1.4 depends on Story 1.3 — the first Student Profile's creation is what establishes the initial device binding.
- Story 1.6 depends on the elevation-token mechanism from Stories 1.2/1.5; restoration is gated on a parent-scoped token.
- Story 1.3 depends on **Epic 2**: a Student Profile requires an Admin-configured Grade Level, so the taxonomy must exist (or be seeded) before profile creation is functional.
- Story 1.1's account timezone and Story 1.3's profile count feed **Epic 9** (allowance periods, tier-based profile caps). Neither is enforced here.
- Story 1.6's mechanism is extended — not rebuilt — by Epic 3 (partial uploads), Epic 4 (draft edits, review position), and Epic 6 (in-progress grade overrides).
- Student Profile deletion and Parent Account deletion are **Epic 8**, deliberately distinct from this epic's archiving.
