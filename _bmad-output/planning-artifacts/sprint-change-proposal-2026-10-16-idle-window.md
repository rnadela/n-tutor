# Sprint Change Proposal — Parent View idle window too tight

- Date: 2026-10-16
- Author: Rvnadela (via bmad-correct-course)
- Mode: Batch
- Scope: **Minor** — direct Developer implementation
- Status: Approved 2026-10-16 — routed to Developer (bmad-build)

## 1. Issue Summary

Parent View locks back to Student Mode and asks for the PIN too often during real use. Parents reviewing results, the paged answer key (Story 5.8) or a draft Practice Test read for minutes without tapping, and get thrown out.

Two causes:

1. **Window is 15 min** (`ELEVATION_TTL_SECONDS=900`, FR-34 / NFR9). PRD already flagged this as an `[ASSUMPTION]` (prd.md §4.1, §12 item 3) — usage has now falsified it.
2. **Passive presence is not counted.** `INTERACTION_EVENTS` = `pointerdown | keydown | scroll | touchstart`. Moving the mouse, or focus moving (keyboard/screen-reader navigation, returning to the tab), does not extend the window. Accessibility review already raised this (ux `review-accessibility.md:338`, "screen-reader reading may not register as activity").

Triggering story: 1.5 Parent View idle expiry (done). Found in post-epic use.

## 2. Impact Analysis

Checklist summary:

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger story | [x] | 1-5-parent-view-idle-expiry |
| 1.2 Problem type | [x] | Original requirement assumption wrong (15 min) |
| 2 Epic impact | [x] | Epic 1 only; no epic added/removed/reordered |
| 3.1 PRD | [!] | FR-34 value, §12 assumption 3 |
| 3.2 Architecture | [!] | ARCHITECTURE-SPINE AD-13 wording "15-minute window" |
| 3.3 UX | [!] | EXPERIENCE.md idle-timeout binding rule, D4 row |
| 3.4 Other (tests, env, docs) | [!] | API default, `.env.example`, e2e/playwright defaults, web spec |
| 4 Path | [x] | Direct Adjustment |
| 5 MVP | [N/A] | Unaffected |

- **Epics:** Epic 1 — FR-34 / NFR9 text and Story 1.5 AC value. No other epic touched.
- **Stories:** Story 1.5 AC value. Story 1.6 (uncommitted state) unaffected — `UNCOMMITTED_STATE_TTL_MS` (72 h) still far exceeds window.
- **Unchanged on purpose:**
  - `ELEVATION_CEILING_MS` = 8 h absolute ceiling.
  - `PIN_COOLDOWN_MS` = 15 min (wrong-PIN lockout, separate concern).
  - Silent expiry, no warning, server-side enforcement, client only *requests* refresh.
  - Web clock still derives window from server instants — no duration in browser.
- **Security trade-off:** forgotten tablet stays an open Parent View up to 60 min instead of 15. Accepted by product owner. Ceiling and server enforcement unchanged.
- **Deploy:** prod `.env` on droplet may pin `ELEVATION_TTL_SECONDS=900` explicitly (local `.env` does). Must update there or the code default change does nothing.

## 3. Recommended Approach

**Direct Adjustment.** One constant + one event list + doc text. Effort: ~1 h. Risk: low. Timeline: none.

## 4. Detailed Change Proposals

### 4.1 Code

**`apps/api/src/identity/pin-policy.ts:27-28`**

```
OLD:
/** One elevation token lives 15 minutes; the parent refreshes while active. */
export const ELEVATION_TTL_SECONDS = 15 * 60;
NEW:
/** One elevation token lives 60 minutes; the parent refreshes while active. */
export const ELEVATION_TTL_SECONDS = 60 * 60;
```

**`apps/web/src/lib/idle-expiry.ts:24`** — count passive presence:

```
OLD:
export const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
NEW:
export const INTERACTION_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'scroll',
  'touchstart',
  'focus',
] as const;
```

- `pointermove` covers mouse + pen hover while reading.
- `focus` is attached with `capture: true` on `window` (existing loop), so it catches element focus (keyboard / screen-reader navigation) and the window regaining focus.
- `pointermove` is high-frequency: throttle `onInteraction` so it ignores events within 1 s of `lastInteractionAt` (window is 60 min; 1 s granularity is irrelevant). Keeps timer churn low.
- Update header comment ("no second definition of '15 minutes'") to drop the number.

**`apps/web/src/lib/idle-expiry.spec.ts`**

- "nothing else" case fires `mousemove` as the ignored event — `pointermove` now counts. Switch ignored event to one still not counted (e.g. `resize`).
- Add throttle case: burst of `pointermove` within 1 s causes at most one state update / reschedule.

**`.env.example:39-43`** — `ELEVATION_TTL_SECONDS=3600`; fix stale comment ("Nothing in the web app refreshes it yet … arrives with Story 1.5" — Story 1.5 is done).

**`playwright.config.ts:51`, `e2e/tests/parent-idle-expiry.spec.ts:18`, `parent-uncommitted-state.spec.ts:16`, `student-grade-dispute.spec.ts:43`** — default `'900'` → `'3600'` (keep in sync with API default).

**`apps/api/src/identity/pin-policy.spec.ts:120-122`** — comment "fifteen minutes" → drop number.

**`.claude/skills/ralph-browser-test/SKILL.md:60`** — "Idle expiry (15 min) … restore 900" → "60 min … restore 3600".

**Env (not in repo):** local `.env` and prod droplet `.env`: set `ELEVATION_TTL_SECONDS=3600` (or remove line to take default).

### 4.2 PRD — `prds/prd-n-test-reviewer-2026-08-29/prd.md`

Line 217 (FR-34 consequences):

```
OLD:
- The idle window is **15 minutes** with no parent interaction. `[ASSUMPTION: 15 minutes is long enough to review a draft Practice Test without re-entering the PIN, and short enough that a tablet left on the kitchen counter is not an open Parent View.]`
NEW:
- The idle window is **60 minutes** with no parent interaction. Interaction includes pointer movement and focus changes, not only taps and keys, so a parent reading without touching the screen is still present. `[CHANGED 2026-10-16: 15 minutes proved too tight in use — parents reviewing results and answer keys were sent back to the PIN mid-review. See sprint-change-proposal-2026-10-16-idle-window.md.]`
```

Line 1188 (§12 assumption 3):

```
OLD:
3. **§4.1 / FR-34** — 15 minutes is the right Parent View idle window: long enough to review a draft Practice Test without re-entering the PIN, short enough that a tablet left on the counter is not an open Parent View.
NEW:
3. **§4.1 / FR-34** — ~~15 minutes~~ Falsified 2026-10-16; window is now 60 minutes, accepting a longer open Parent View on an abandoned device in exchange for uninterrupted review.
```

NFR (line ~1040) — replace any "15 minutes" with "60 minutes".

### 4.3 Epics — `epics.md`

- Line 30 (FR-34): "The idle window is 15 minutes" → "The idle window is 60 minutes (pointer movement and focus count as interaction)".
- Line 129 (NFR9): "expires after 15 minutes of inactivity" → "expires after 60 minutes of inactivity".
- Line 455 (Story 1.5 AC): "Given Parent View has been idle for 15 minutes" → "Given Parent View has been idle for 60 minutes".

### 4.4 Architecture — `architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md:196`

```
OLD: the elevation token expires on its own 15-minute window and the server mints any replacement.
NEW: the elevation token expires on its own idle window (`ELEVATION_TTL_SECONDS`, default 60 minutes) and the server mints any replacement.
```

### 4.5 UX — `ux-n-test-reviewer-2026-08-29/EXPERIENCE.md`

- Line 400: "Fires **silently at 15 minutes of inactivity**" → "Fires **silently at 60 minutes of inactivity** — pointer movement and focus changes count as activity —".
- Line 603 (D4 row): "Parent View idle timeout at 15 minutes" → "at 60 minutes (was 15; widened 2026-10-16)".

Historical review/reconcile/memlog files: leave as-is (point-in-time records).

## 5. Implementation Handoff

- **Scope:** Minor → Developer agent (`bmad-build`) direct implementation.
- **Tasks:**
  1. Apply 4.1 code + test changes; run api + web unit tests, `parent-idle-expiry` e2e.
  2. Apply doc edits 4.2–4.5.
  3. Update prod droplet `.env` `ELEVATION_TTL_SECONDS` before/at deploy (`ralph-deploy-prod`).
- **Success criteria:**
  - Fresh PIN entry → `expiresAt - now` ≈ 60 min in refresh/verify responses.
  - Moving mouse only (no clicks) for > 60 min keeps Parent View open.
  - 60 min with no input at all → silent return to Student Mode; PIN required.
  - 8 h ceiling still ends Parent View regardless of activity.
  - All unit + e2e tests green.
