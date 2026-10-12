# Epic 1 Context: Parent Accounts, PINs & Student Profiles

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 1 establishes the identity and trust boundary the whole product sits on: a parent signs up with email and password, sets a numeric PIN that gates Parent View, creates and manages a Student Profile per child, and the shared family device switches safely between Student Mode and Parent View — including a silent idle expiry back to Student Mode and recovery of in-progress parent work afterwards. It also lands the design system foundation (tokens, typography, primitives, table/card patterns) that every later epic builds on. Nothing else can be built correctly before this epic: it defines who owns data, what a child can reach, and the one visual system every surface reads from.

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

## Requirements & Constraints

**Accounts.** Sign-up takes a format-verified email, a password meeting a stated minimum strength, and explicit acceptance of the terms plus the child-data consent notice. Consent is recorded against the account with a timestamp and the accepted notice version — account-scoped, taken before any profile exists. Duplicate-email sign-up is rejected with a message that does not disclose whether the account exists. Sessions persist across app launches until explicit sign-out. Password reset is by emailed link. Exactly one timezone is captured per account at sign-up (defaulted from the device, editable in Settings); it is the boundary every later allowance period is measured against.

**PIN.** Required on every Student Mode → Parent View transition, including after restart. Changing it requires the current PIN or the account password. Three consecutive failures lock Parent View for a cool-down whose failure count survives restart. The PIN is never displayed back and is stored hashed.

**Student Profiles.** Each requires a display name and exactly one Grade Level from the Admin-configured list. Rename or Grade Level change must not alter existing Practice Tests. Archiving hides a profile from Student Mode selection while preserving its Attempt and Mastery history. Active-profile caps are not enforced in this epic.

**Mode switching.** The first profile created becomes the device's bound profile, so "last-bound" is always defined. Deliberately exiting Parent View on a multi-profile device prompts for which profile to bind; a silent expiry cannot prompt and falls back to last-bound. In Student Mode, no upload, generation, release, cross-profile data, or Analytics surface is reachable — not by navigation, not by direct URL — and the PIN prompt is the only way out.

**Idle expiry.** Parent View expires after 15 minutes of inactivity and returns silently to Student Mode: no warning, no countdown, no extension prompt, no post-expiry prompt. Re-entry requires the PIN with the same cool-down rule. Behavior is uniform across every Parent View surface.

**Uncommitted parent work.** Held server-side only, keyed to the Parent Account, never written to client storage. It survives expiry, carries its own TTL, and is restored strictly *after* PIN verification — never fetched, rendered, or held client-side while the device is in Student Mode. A fetch of retained state belonging to a different Student Profile than the bound one is rejected server-side.

**Non-functional.** Passwords and PINs hashed, all traffic over TLS. Authorization enforced server-side per Parent Account for every owned resource; Student Mode restrictions are never client-side-only. Parent View's time bound is server-enforced — a client that fails to expire does not retain parent authority. WCAG 2.1 AA on student-facing surfaces, contrast verified in both light and dark mode.

## Technical Decisions

**Credential split.** Two credentials, never one. Identity is an httpOnly/Secure/SameSite=Strict session cookie, unreadable by JS, which answers *which account* and lets the shell and student-scoped surfaces server-render. Elevation is a parent-scoped token held in a React context **in memory only** — never cookie, disk, or web storage — lost on any full page load. The session cookie alone never satisfies a parent-scoped endpoint. No parent-scoped data is ever server-rendered; parent surfaces fetch client-side carrying the elevation token. A refresh or hard navigation therefore drops the parent to the PIN by design, which is exactly why uncommitted-state restore exists.

**Mode in the token.** The token carries the mode and the Parent Account; crossing the PIN mints a Parent View-scoped token, and every parent endpoint checks the scope server-side. Entering Student Mode for a profile mints a new session token carrying that Student Profile, and every student-scoped endpoint reads the profile from the token, never from a request parameter. Switching profiles requires re-crossing the mode gate.

**Idle clock.** Client-clocked, server-capped. The client tracks real interaction (pointer, key, scroll, touch) and may only *request* a refreshed elevation token — never extend one; the server mints replacements. Polling is not interaction and must not touch the clock. The elevation token expires on its own 15-minute window, with an absolute ceiling of 8 hours of total elevation regardless of activity.

**Uncommitted state.** A row, not a blob in memory: owned by the Parent Account, with a state and a single 72-hour TTL measured from row creation and never extended by activity. Expiry deletes the row outright. Within the window it stays gated on a parent-scoped token so a child cannot restore it either. This is one lifecycle shared with the orphaned-capture sweep — a row is restorable state until its TTL elapses and an orphan after. Story 1.6 ships only the general mechanism; later epics plug content types (draft question edits, in-progress grade override, partial upload) into it, each adding one acceptance criterion rather than rebuilding it.

**Destructive actions.** Student Profile deletion, Parent Account deletion, and early image deletion require a fresh *account-password* re-authentication verified server-side — not the PIN, which gates a mode, not destruction.

**Module ownership.** One writer per entity cluster: `identity` owns Parent Account, Student Profile, and sessions. Other modules read through the owning module's injected service and never touch another module's Prisma delegate. Cross-module write methods take the caller's transaction client as their first parameter.

**Stack posture.** No scaffolding generator: the monorepo is a hand-assembled configuration copied from the sibling `n-electric` project (Turborepo + pnpm workspaces, NestJS + Prisma + PostgreSQL, Next.js + React + MUI, Playwright, Docker Compose), set up directly in this epic. Argon2 for password and PIN hashing. Pinned dependency versions and the deploy envelope are fixed in the stack table — treat them as given rather than re-chosen.

**Conventions.** User-facing strings are parameterized, never literal; second person to the student, third person to the parent. Structured JSON logs to stdout with one correlation id per request, and no child content in any log line. Scheduling goes through pg-boss only.

## UX & Interaction Patterns

**Theme.** One base MUI theme with a nested provider overriding `palette.primary` only per surface: `primary-student` forest green and `primary-parent` ink navy, each with a dark variant. Every other token is byte-identical across Student Mode, Parent View, and Admin. The full semantic color set exists in light and dark against measured contrast ratios, with `divider` held to the 3:1 non-text floor. Only two sanctioned surface tints (`tintHover`, `tintSelected`) exist, and neither ever carries a state alone. Palette *values* were revised to match the app icon; the token mechanism this epic builds is unaffected, and acceptance should reference the ratios table rather than literal hex values.

**Typography.** Two self-hosted families assigned strictly by content type, never by surface: a serif for all generated content (question text, explanations, answer keys, wherever they appear) and a sans for all interface chrome. Eight fixed type roles shared identically across surfaces. `tabular-nums` applied to every numeral that aligns in a column or ticks in place.

**Density, shape, focus.** Two density token sets — comfortable for Student Mode, compact for Parent View and Admin — governing row height, card padding, gap, and section margin; components read tokens, never hardcoded spacing, and density is independent of breakpoint. Tap-target floors of 48px (Student) and 44px (Parent/Admin) are minimums compact must never breach. Elevation is flat everywhere: `elevation={0}`, a 1px divider-colored border as every control's sole boundary, and a scrim plus border (never a shadow) separating overlays including the PIN entry. Radius is semantic: near-square for anything carrying generated content, 8px for anything tappable. One focus mechanism: a 2px primary-colored outline at 2px offset, evaluated against the surface behind the control.

**Primitives to build before feature stories need them.** Text field, Primary button, Destructive button (intent carried by label and an outlined error border, never a filled red button), Dialog and Destructive-confirm dialog (names exactly what will be destroyed, requires the account-password field, states it cannot be undone), and Snackbar (flat, bordered, no shadow).

**Cross-cutting rules enforced from the first screen.** Every control is a real control — no `div` or `span` ever carries an action, `aria-expanded`, or state. Focus order follows reading order. Icon-only controls are labeled with the object they act on. Live-region announcements use the displayed copy verbatim on every state change that matters. Every surface other than Take Test and Analytics is a single fluid layout, unchanged between phone and tablet; desktop is supported but not optimized. Motion is permitted only for a short allowlist (route/page transitions, panel expand, map open/close, the generation wait) with `prefers-reduced-motion` honored throughout.

**Table row actions (one shared component).** A row shows at most 2 icons, and the overflow `⋮` counts as one. Only a self-evident icon may stand alone — pencil for rename, trash for delete, chevron for expand/collapse; anything else goes in the per-row `⋮` menu whose items show icon and label together. More than 2 actions means all of them move into the menu and `⋮` is the row's only icon. Menu items keep disabled/pending state, and a destructive item is set apart by a divider and the error color. Keyboard: opens on Enter/Space/click, arrow-key movement, Escape or a choice closes it, focus returns to the trigger. Every icon button and `⋮` trigger has an accessible name naming the row's object, a tooltip on hover *and* focus, and the surface's tap-target floor. Existing behavior behind each action (inline rename form, confirmations, pending state, announcements) is unchanged.

**Cards below desktop.** Below 1200px (`lg`) every data table renders as a list of cards; at 1200px and above, as the table. The switch is CSS-only via breakpoint keys — no viewport hook, so no layout swap after first paint. Both layouts live in the DOM reading the same component state, the hidden one `display: none` and out of the accessibility tree, with every `aria-controls`/`aria-describedby` id unique across the two. A card is a flat divider-bordered surface at the surface's card padding: the row's identifying value as its title, row actions at the top-right under the same icon/menu rules, and every remaining column as a labeled field (caption label, body value, tabular figures). Nothing a table shows may be dropped from its card. One column below 600px, two from 600px, except ranked lists, which stay one column. The card list is a real `ul`/`li` and each card is named by its title.

**Verification expectations.** Unit specs for the row-actions cap/menu/label/keyboard rules and for the card layout; an E2E check of each affected screen at phone width (cards, no horizontal scroll) and desktop width (table); and a visual pass in light and dark mode at phone, tablet, and just-below-`lg` widths with no wrapped action cell and no clipped or overlapping field.

## Cross-Story Dependencies

- Story 1.7 is a hard prerequisite: Stories 1.1–1.6 are built on the design system foundation, not ahead of it. Stories 1.8 and 1.9 extend it and share the same row-actions rules, so 1.9's cards consume 1.8's component.
- Stories 1.4, 1.5, and 1.6 are one mechanism seen from three angles — token-carried mode, the idle clock, and the server-side retained-state row — and the PIN gate from 1.2 is the single entry point all three depend on.
- The account timezone captured in Story 1.1 is the boundary Epic 9's allowance periods are measured against; it must be stored and editable even though nothing consumes it yet.
- Student Profiles require Admin-configured Grade Levels (Epic 2). Epic 1 may need seeded taxonomy data to be testable; it must not define its own grade list.
- Story 1.3 deliberately omits Account Tier profile caps — that enforcement lands in Epic 9.
- Story 1.6 ships the persistence mechanism only; Epics 3, 4, and 6 plug their content types into it later. Do not special-case any one content type here.
- Stories 1.8 and 1.9 change screens owned by Epic 2 (Taxonomy, Accounts, Availability), Epic 7 (Topics, Analytics/Mastery), and Epic 1 (Students); their existing table unit and E2E specs need updating for how actions are reached, not for behavior.
