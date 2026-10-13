# Epic 1 Context: Parent Accounts, PINs & Student Profiles

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 1 establishes the trust boundary and the shared UI foundation the whole product sits on. A parent can create an account and sign in on any device, set a numeric PIN that gates every entry into Parent View, and create, rename, re-grade, and archive Student Profiles. A device binds to one Student Profile and can switch between a locked-down Student Mode and Parent View, with Parent View expiring silently after idle time and in-progress parent work surviving that expiry. Alongside that, Epic 1 ships the design-system foundation — tokens, typography, primitives, and the shared table/row-action/card/color-mode patterns — so every later epic builds on one consistent system rather than inventing its own. Nothing in Epics 2–10 is safe to build before this boundary and this foundation exist.

## Stories

- Story 1.1: Parent Account Sign-Up & Sign-In
- Story 1.2: Parent PIN for Parent View
- Story 1.3: Student Profile Management
- Story 1.4: Student Mode ↔ Parent View Switching
- Story 1.5: Parent View Idle Expiry
- Story 1.6: Uncommitted Parent Input Survives Expiry (mechanism)
- Story 1.7: Design System Foundation
- Story 1.8: Table Row Actions
- Story 1.9: Cards Below Desktop
- Story 1.10: Light / Dark Mode Switch

## Requirements & Constraints

- **Accounts:** email/password sign-up with terms + child-data consent recorded as timestamp plus notice version; duplicate-email rejection must not reveal that an account exists; session persists until explicit sign-out; emailed password reset. One account timezone is captured at sign-up from the device default, editable in Settings, and it bounds every later allowance period.
- **Registration is closed by default.** An invitation code is required and must be checked at the signup endpoint, never only in the UI.
- **PIN:** numeric, hashed, never displayed back. Required on every Student Mode → Parent View transition including after restart. Changing it requires the current PIN or the account password. Three consecutive failures lock Parent View for a cool-down that survives restart; the failure counter is persisted server-side, never client-held.
- **Student Profiles:** display name plus exactly one Admin-configured Grade Level. Rename and Grade Level change must not alter existing Practice Tests. Archive hides the profile from Student Mode selection while preserving Attempt and Mastery history. Tier-based caps on active profile count are explicitly out of scope here (they land with allowance enforcement).
- **Mode isolation:** in Student Mode, no upload, generation, release, cross-profile data, or Analytics surface is reachable — by navigation or by direct URL — and the PIN prompt is the only way out. This must be enforced server-side, not by client routing alone.
- **Idle expiry:** 15 minutes, silent (no warning, no countdown), falls back to the last-bound profile with no prompt, applies uniformly to every Parent View surface, and is server-enforced so a client that fails to expire keeps no authority.
- **Uncommitted work:** retained server-side only, keyed to the Parent Account, never written to client storage; restored strictly after PIN verification; a cross-profile restore is refused server-side, not silently rebound; retained state carries its own TTL.
- **Security baseline:** passwords and PINs hashed; TLS everywhere; authorization enforced server-side per Parent Account on every resource and query.
- **Accessibility is a build constraint, not a review step:** WCAG 2.1 AA, contrast verified in both light and dark mode, divider tokens held to the 3:1 non-text boundary floor, focus order following reading order, icon-only controls named by the object they act on, and `prefers-reduced-motion` honored.

## Technical Decisions

- **Split credentials.** Identity is an httpOnly/Secure/SameSite=Strict session cookie that answers *which account* and survives refresh. Parent View elevation is a separate scoped token held in React context, in memory only — never a cookie, never web storage — so a refresh or hard navigation drops the parent back to the PIN. The session cookie alone never satisfies a parent-scoped endpoint.
- **Mode travels in the token.** Crossing the PIN mints a Parent-View-scoped token; every parent endpoint checks that scope server-side. No parent-scoped data is ever server-rendered — parent surfaces fetch client-side carrying the elevation token.
- **Idle clock is client-measured, server-capped.** The client tracks real interaction (pointer, key, scroll, touch) and may only *request* a refreshed token; the server mints every replacement. Polling is not interaction and must not touch the clock. The token expires on its own 15-minute window, with an absolute 8-hour ceiling on total elevation regardless of activity.
- **One uncommitted-state lifecycle.** Retained parent state and the orphaned-capture sweep are the same mechanism at two moments: a row is restorable until its TTL elapses and an orphan after. One TTL, 72 hours from row creation, not extended by activity; expiry deletes the row outright with no tombstone. Story 1.6 ships only this general mechanism — later epics plug their own content types into it, each adding one acceptance criterion rather than rebuilding it. The scheduled sweep runs on the queue's own scheduler, not a framework cron.
- **Module ownership.** Parent Account, Student Profile, and sessions belong to `identity`; Subject and Grade Level belong to `admin`. Every other module reads through the owning module's injected service and never touches another module's Prisma delegate. Operator identities are a separate credential store entirely — an operator credential cannot satisfy a parent guard, or the reverse.
- **Timezone is effective-dated.** Changing it never re-slices a running period, so store history rather than overwriting a single field.
- **One base theme, nested overrides.** A single MUI theme carries every token; each surface nests a provider that overrides the primary accent only, so all other tokens stay byte-identical across Student Mode, Parent View, Admin, and Auth. Nothing hardcodes a color, and every token has both a light and a dark value.
- **Tokens, not literals.** Density sets (comfortable for Student Mode, compact for Parent View and Admin) govern row height, card padding, gap, and section margin, with tap-target floors of 48px and 44px respectively that compact must never undercut. Elevation is flat — zero elevation, a 1px divider border as the sole boundary, scrim-plus-border for overlays, never shadows. Radius is semantic: square-ish for surfaces carrying generated content, 8px for anything tappable. One focus-ring mechanism, evaluated against the surface behind the control.
- **Typography by content type, never by surface.** A self-hosted serif for all generated content wherever it appears (including Parent View and Admin) and a self-hosted sans for interface chrome, resolved through a fixed eight-role scale. `tabular-nums` on every numeral that aligns in a column or ticks in place.
- **Copy is a parameterized layer.** No user-facing result string is a fixed literal; address resolves second-person for students and third-person-by-name for parents through one shared surface-aware component. A hardcoded user-facing string is a defect. Only the grade-state labels are exempt.
- **Every control is a real control.** No `div` or `span` ever carries an action, `aria-expanded`, or state.
- **Color mode is per device, not per account.** One shared stored mode read and written by every nested theme provider and by the pre-paint init script, so a choice on one surface applies everywhere and is in effect from first paint with no flash. Until the switch is used, the device preference decides; once used, the choice wins over the device preference and survives sign-out and mode switching. The document's theme color follows the mode in effect. This needs no API, schema, or architecture change.

## UX & Interaction Patterns

- **Primitives before features.** The text field, primary and destructive buttons, dialog, destructive-confirm dialog, and snackbar must exist as reusable components before any feature story consumes them. Destructive intent is carried by label text and an outlined error border — never a filled red button — and a destructive confirm names exactly what will be destroyed, requires account-password re-authentication, and states the action cannot be undone.
- **Row actions are one shared pattern.** Only self-evident icons may stand alone (pencil = rename, trash = delete, chevron = expand); anything else goes in a per-row overflow menu whose items show icon and label together. A row shows at most two icons, the overflow counting as one; more than two actions means all of them move into the menu. Every icon button and overflow trigger is named with the row's object, has a tooltip on hover and focus, and meets its surface's tap-target floor. Destructive menu items sit below a divider in the error color.
- **Tables become cards below desktop.** Below 1200px every data table renders as a list of cards; at 1200px and above, as the table. The switch is CSS-only — no viewport hook — so there is no layout swap after first paint, and the hidden layout is removed from the accessibility tree with no duplicate ids across the two. A card is a flat divider-bordered surface: identifying value as the title, row actions at top-right, every other column as a labeled field. One column on phones, two from 600px, except ranked lists which stay one column. Nothing a table shows may be dropped from its card.
- **Color mode switch placement.** Parent View header top-right before the exit control; Admin header before Sign out; sign-in pages top-right; Student home beside the Parent View link. Never inside the camera capture view or an in-progress Attempt. Its icon, accessible name, and tooltip all describe what the *next* press will do.
- **Layout and motion.** One fluid layout per surface, unchanged between phone and tablet; desktop supported but not optimized. Motion is permitted only for question transitions, expand/collapse, map open/close, route transitions, and the generation wait. Explicitly banned: results-reveal flourishes, per-tick timer animation, streaks, badges, points, confetti, infinite scroll, hover-only affordances on touch, and modal stacks more than one level deep.

## Cross-Story Dependencies

- **Story 1.7 comes first in substance.** Stories 1.1–1.6 are built on the design-system foundation, not ahead of it.
- **Stories 1.8, 1.9, and 1.10 are retroactive cross-cutting patterns.** They land inside Epic 1 but apply to screens owned by Epics 2, 7, and 9 (Admin taxonomy, topics, accounts, availability; Parent students and analytics). Expect to touch those surfaces and update their existing unit and E2E specs for how actions are reached, without changing the actions' behavior. Story 1.9 depends on 1.8's row-action rules.
- **Story 1.2's cool-down rule is reused verbatim by Story 1.5** on re-entry after idle expiry.
- **Story 1.3 depends on Epic 2** for the Admin-configured Grade Level list; **Story 1.1's account timezone is consumed by Epic 9's** allowance period windows; **active-profile caps are enforced in Epic 9**, not here.
- **Story 1.6's mechanism is extended later** by Epic 3 (partially completed upload), Epic 4 (draft question edits), and Epic 6 (in-progress grade override).
- **Story 1.10 keeps the document theme color in step with the chosen mode**, which is what the installed-app title bar from Epic 10 reads; no Epic 10 story changes.
- **Story 1.4's direct-URL and cross-profile restrictions** are the client half of a server-side authorization rule every later epic's endpoints must also honor.
