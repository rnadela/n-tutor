---
title: 'Widen Parent View idle window to 60 min and count passive presence'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '192d38aa71a8e4c9db1379542d92576dd3d4b0b2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-16-idle-window.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Parent View returns to Student Mode and asks for the PIN after 15 min without taps/keys/scroll. Parents reading results, answer keys or drafts get locked out mid-review, because the window is short and mouse movement / focus changes do not count as presence.

**Approach:** Raise the server-side elevation TTL default to 60 min (the browser clock derives its window from server instants, so no browser duration changes). Add `pointermove` (throttled to once per second) and `focus` to the client's interaction events. Sync tests, env example, e2e defaults and planning docs per the approved sprint change proposal.

## Boundaries & Constraints

**Always:** Window stays defined once (API `ELEVATION_TTL_SECONDS`); browser never names a duration. Expiry stays silent. Server still enforces expiry; client only requests refreshes. Refresh calls never count as interaction.

**Ask First:** Any change to `ELEVATION_CEILING_MS` (8 h), `PIN_COOLDOWN_MS` (15 min), refresh fractions, or adding a warning/countdown UI.

**Never:** Edit historical review/reconcile/memlog files under planning-artifacts. Touch local or prod `.env` files (user handles). Add `mousemove`/`visibilitychange` separately (pointermove + focus cover them).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh PIN | No env override | Token window = 3600 s | N/A |
| Hover-only reading | `pointermove` events, no taps, > 60 min | Parent View stays open (refreshes as usual) | N/A |
| Keyboard focus nav | `focus` events only | Counts as interaction | N/A |
| Pointer burst | Many `pointermove` within 1 s of last interaction | At most one state update / reschedule | N/A |
| Truly idle | No events for full window | Silent expiry to `/student` | N/A |
| Unlisted event | `resize` fired at window − 1 ms | Does not extend; expires on schedule | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/identity/pin-policy.ts:27-28` -- `ELEVATION_TTL_SECONDS = 15 * 60` + doc comment; single source of the window. Ceiling check at :82 (TTL ≤ ceiling) unaffected (3600 s < 8 h).
- `apps/api/src/identity/pin-policy.spec.ts:120-122` -- comment says "fifteen minutes"; asserts default equals constant (no literal).
- `apps/api/src/identity/identity.module.spec.ts:33` -- sets TTL 3600 with ceiling 60000 to force refusal; unaffected.
- `apps/web/src/lib/idle-expiry.ts:11-14` -- header comment mentions "15 minutes".
- `apps/web/src/lib/idle-expiry.ts:24` -- `INTERACTION_EVENTS`; listeners attached on `window` with `{ passive: true, capture: true }` at :288, removed at :204 — capture means `focus` (non-bubbling) is caught.
- `apps/web/src/lib/idle-expiry.ts:~276` -- `onInteraction()` sets `lastInteractionAt = deps.now()` then `tick()`; the throttle goes here. Listener receives the Event, so `event.type` is available.
- `apps/web/src/lib/idle-expiry.spec.ts:18` -- `WINDOW = 900_000` (test-local window; may stay — module is duration-free). :259-273 "every stated event…and nothing else" fires `mousemove` as ignored event. Rig `target.fire(type)` at :100.
- `.env.example:39-43` -- `ELEVATION_TTL_SECONDS=900` + stale "nothing refreshes it yet / arrives with Story 1.5" comment.
- `playwright.config.ts:51`, `e2e/tests/parent-idle-expiry.spec.ts:18`, `e2e/tests/parent-uncommitted-state.spec.ts:16`, `e2e/tests/student-grade-dispute.spec.ts:43` -- `?? '900'` defaults.
- `.claude/skills/ralph-browser-test/SKILL.md:60` -- "Idle expiry (15 min) … restore 900".
- Docs: `prds/prd-n-test-reviewer-2026-08-29/prd.md` lines 217, ~1040, 1188; `epics.md` lines 30, 129, 455; `architecture/.../ARCHITECTURE-SPINE.md:196`; `ux-designs/.../EXPERIENCE.md` lines 400, 603.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/identity/pin-policy.ts` -- `ELEVATION_TTL_SECONDS = 60 * 60`, comment "60 minutes" -- the one definition of the window.
- [x] `apps/api/src/identity/pin-policy.spec.ts` -- drop "fifteen minutes" from comment -- avoid stale number.
- [x] `apps/web/src/lib/idle-expiry.ts` -- add `'pointermove'` and `'focus'` to `INTERACTION_EVENTS`; in `onInteraction(event)` ignore a `pointermove` arriving < 1000 ms after `lastInteractionAt` (export the 1000 ms as a named constant); drop "15 minutes" from header -- passive presence counts without timer churn.
- [x] `apps/web/src/lib/idle-expiry.spec.ts` -- ignored event `mousemove` → `resize`; add throttle test (pointermove burst inside 1 s → no reschedule beyond first; pointermove ≥ 1 s later extends deadline); add test that `focus` extends -- covers I/O matrix.
- [x] `.env.example` -- `ELEVATION_TTL_SECONDS=3600`; rewrite comment: idle window, refreshed while parent active, must not exceed ceiling.
- [x] `playwright.config.ts`, 3 e2e specs -- `'900'` → `'3600'` -- match API default.
- [x] `.claude/skills/ralph-browser-test/SKILL.md` -- 15 min / 900 → 60 min / 3600.
- [x] Planning docs (prd.md, epics.md, ARCHITECTURE-SPINE.md, EXPERIENCE.md) -- apply proposal §4.2–4.5 text verbatim.

**Acceptance Criteria:**
- Given no env override, when a parent enters the PIN, then the elevation response `expiresAt` is ~60 min after issue.
- Given grep over `apps/`, `e2e/`, `playwright.config.ts`, `.env.example`, then no `ELEVATION_TTL` default of `900` remains.
- Given the 8 h ceiling is reached, when the parent is active, then Parent View still ends.

## Design Notes

Throttle only `pointermove`: discrete events (taps, keys, focus) keep exact-deadline semantics the existing spec asserts; only the high-frequency stream is rate-limited. 1 s granularity is negligible against a 60 min window.

## Verification

**Commands:**
- `pnpm --filter web test` -- expected: green, incl. new idle-expiry cases.
- `pnpm --filter api test` -- expected: green.
- `pnpm --filter web lint && pnpm --filter api lint` -- expected: clean.
- `pnpm --filter web typecheck` (or `tsc --noEmit`) -- expected: clean.

## Suggested Review Order

**Window length (server, single source)**

- Default TTL 15→60 min; browser derives window from issued instants.
  [`pin-policy.ts:28`](../../apps/api/src/identity/pin-policy.ts#L28)

- Non-circular literal pin so a revert to 900 fails.
  [`pin-policy.spec.ts:129`](../../apps/api/src/identity/pin-policy.spec.ts#L129)

**What counts as presence (client)**

- Lapsed deadline checked before stamping — late timer cannot be outrun by focus.
  [`idle-expiry.ts:321`](../../apps/web/src/lib/idle-expiry.ts#L321)

- Event list gains pointermove + focus.
  [`idle-expiry.ts:25`](../../apps/web/src/lib/idle-expiry.ts#L25)

- Ignores synthetic moves (unchanged coords) and 1 s bursts; tolerant of backwards clock.
  [`idle-expiry.ts:330`](../../apps/web/src/lib/idle-expiry.ts#L330)

- Rate-limit constant, not a window.
  [`idle-expiry.ts:44`](../../apps/web/src/lib/idle-expiry.ts#L44)

**Tests**

- Revival guard under late timer.
  [`idle-expiry.spec.ts:332`](../../apps/web/src/lib/idle-expiry.spec.ts#L332)

- Focus counts; pointermove burst throttled; backwards clock; discrete events unthrottled.
  [`idle-expiry.spec.ts:285`](../../apps/web/src/lib/idle-expiry.spec.ts#L285)

**Config and docs**

- Example env + e2e fallback aligned to 3600.
  [`.env.example:43`](../../.env.example#L43)
  [`playwright.config.ts:51`](../../playwright.config.ts#L51)

- FR-34 / NFR9 / AD-13 / UX idle rule updated to 60 min.
  [`prd.md:217`](../../_bmad-output/planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/prd.md#L217)
  [`epics.md:30`](../../_bmad-output/planning-artifacts/epics.md#L30)
