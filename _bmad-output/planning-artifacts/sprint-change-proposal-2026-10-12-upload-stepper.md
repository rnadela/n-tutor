# Sprint Change Proposal — Upload Stepper, Plain Wording, Progress Spinner & Default Subjects

- **Date:** 2026-10-12
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-12; applied to epics.md, EXPERIENCE.md, sprint-status.yaml
- **Scope classification:** Minor (four new stories; one UX-spec edit; no API contract or schema change)

## 1. Issue Summary

**Trigger.** On prod, Rvnadela opened Parent View → Upload a test, chose a grade level, and got *"No subjects are offered for that grade level yet. Choose another grade level."* The "Order" card (add pages, page strip) was still on screen below it, inviting an upload that can never be submitted.

**Two separate problems.**

1. **Data.** Prod has the 13 seeded grade levels but no Subject and no Subject–Grade Level link. `apps/api/prisma/seed.ts` seeds the operator and grade levels only; subjects were expected to be entered by the operator through Admin → Taxonomy, and never were. Every grade level therefore offers zero subjects.
2. **UX.** `apps/web/src/app/parent/capture/page.tsx` renders every phase of the flow at once: classification, Order (pages), legibility, generate. `EXPERIENCE.md` already models these as sequential screens (Upload → Classify → Capture pages → Legibility check → Generate), but the build collapsed them onto one scrolling page. A parent sees page controls before the upload is even classifiable.
3. **Wording.** The "How the pages read" step speaks system language — *"Continuing commits this upload and uses one upload allowance."*, *"This is a warning, not a block."*, *"Committing the upload…"*. An average parent cannot tell what "commits" means for them, and nothing shows how many uploads they have left. The copy comment says no figure is shown because "the Allowances surface is Story 9.6's"; 9.6 is now done and `GET /parent/allowances` returns used, limit (`null` = unlimited) and reset date, so that constraint no longer applies.
4. **No visible loading.** On the capture page's *Generate a practice test* step, the "pages are being read" state is a plain line of text (`capture/page.tsx:1147`, `extraction-reading`). The generation page (`parent/generate/[sourceTestId]/page.tsx`, *Making the practice tests*) also has no motion, though `EXPERIENCE.md` calls for "progress motion" there. A parent cannot tell at a glance that anything is happening.

**Decisions taken (with Rvnadela, 2026-10-12).**
| Decision | Choice |
|---|---|
| Stepper shape | 4 steps: **Details** (child, grade level, subject) → **Pages** (add, reorder, retake, delete) → **Check** (legibility + commit) → **Generate** |
| Navigation | Back and Next free **until upload commit**; after commit (Upload Allowance spent) steps 1–3 are read-only |
| Check-step wording | Plain everyday words; replace "commit" (→ "consumes" / "saving"); **keep the term "upload allowance"** (matches Settings); show what is left as a figure (e.g. *Upload allowance: 4 of 5 left this month*) with the reset date. Settings unchanged. |
| Waiting states | A large, obvious spinner on both waits (reading pages; making practice tests) |
| Generation progress visual | Replace the bare "0 of 5 are ready" line with a **sheet tally**: one sheet icon per requested practice test; ready sheets show a checkmark; the sheet being made carries the spinner ring. Mock: `mockups/key-generation-progress.html` |
| Empty-subjects fix | **Seed default PH K–12 subjects** and their grade-level links, create-only |
| Review mode | Batch |

## 2. Impact Analysis

### Epic impact
- **Epic 2 (Admin Content Governance):** add Story 2.3 — Default Subject Seed. Taxonomy mechanism (Story 2.1) unchanged.
- **Epic 3 (Source Test Capture, Upload & Extraction):** add Story 3.7 — Upload Stepper, and Story 3.8 — Plain-Language Check Step & Upload Allowance Left. Epic reopens from `done` to `in-progress` until 3.7 and 3.8 land.
- **Epic 4 (Practice Test Generation):** add Story 4.7 — Obvious Progress Spinner (covers the Epic 3 reading wait too, so one component serves both). Epic reopens to `in-progress`.
- Epics 1, 5–10: no change.

### Story impact
- No completed story is reopened. Stories 3.1–3.4 acceptance criteria all still hold; 3.7 changes *presentation and sequencing*, not behaviour.
- Story 3.3 AC "Subject or Grade Level unset → submission blocked" is now enforced earlier (cannot leave step 1), which is stricter, not conflicting.

### Artifact conflicts
| Artifact | Conflict | Update |
|---|---|---|
| PRD | FR-5…FR-9 describe capabilities, not layout. | **None.** |
| Architecture | Taxonomy ownership (admin module owns Subject/GradeLevel) — a seed is out-of-band, same as grade levels. | **None.** |
| `EXPERIENCE.md` | Screen table already sequential; no stepper pattern defined; no rule for "no subjects" dead end. | **Add Upload stepper pattern row** (4.3). |
| `DESIGN.md` | No stepper component token. | **None** — MUI Stepper on existing tokens; flag if visual pass needs one. |
| `EXPERIENCE.md` Legibility result row | Says proceeding "consumes an Upload Allowance" — wording rule, no figure. | **Amend**: plain words + uploads-left figure (4.4). |
| `EXPERIENCE.md` Generation in flight | Requires progress motion; no visual for the count. | **Amend**: add "one sheet per requested practice test, each ticked as it lands" and link `mockups/key-generation-progress.html`. |
| Mockups | No generation-progress mock. | **Added** `mockups/key-generation-progress.html`. |
| `epics.md` | — | **Add Stories 2.3, 3.7, 3.8 and 4.7** (4.1–4.3, 4.6). |
| `sprint-status.yaml` | — | Add `2-3-default-subject-seed`, `3-7-upload-stepper`, `3-8-plain-language-check-step`, `4-7-obvious-progress-spinner` as `backlog`; `epic-2`, `epic-3`, `epic-4` → `in-progress`. |

### Technical impact
- **Web:** `capture/page.tsx` restructured into steps; existing sub-components (`AddPages`, `PageStrip`, `CameraViewfinder`, `ThinExtractionWarning`) reused. `copy/parent.ts` gains step labels. `page.spec.tsx` (1.5k lines) and E2E capture spec need updating for step navigation.
- **Copy:** `copy/parent.ts` `capture.legibility` strings rewritten; the "no figure" comment removed. Check step reads `parentApi.allowances` (already exists, charges nothing).
- **API:** no endpoint or DTO change. The Source Test draft is still created/updated the same way.
- **Seed:** `seed.ts` gains `seedSubjects` (create-only on `nameKey` and on the `(subjectId, gradeLevelId)` pair).
- **Deploy:** `scripts/deploy.sh` never runs the seed. After Story 2.3 ships, the seed must be run once on prod (`docker compose run --rm api … seed`) — an explicit, confirmed prod step.

## 3. Recommended Approach

**Direct Adjustment** — add two stories inside existing epics.

- **Rationale:** the flow and data model are correct; the defects are a missing data step and a page that ignores the sequencing the UX spec already defines. No rollback or MVP change warranted.
- **Effort:** Story 2.3 small (≈ half day incl. tests). Story 3.7 medium (≈ 1–2 days, mostly spec rework). Story 3.8 small (≈ half day). Story 4.7 small (≈ half day).
- **Risk:** low–medium. Main risk is regressions in the large capture spec; mitigated by keeping sub-components and API calls unchanged.
- **Order:** 2.3 first — unblocks prod uploads immediately once seeded; then 3.7; then 3.8 (same screen, lands on the stepper's Check step); 4.7 independent, any time.
- **Interim unblock:** subjects can be added today via Admin → Taxonomy without waiting for 2.3.

## 4. Detailed Change Proposals

### 4.1 `epics.md` — add Story 2.3 (after Story 2.2)

```
### Story 2.3: Default Subject Seed

As the operator,
I want the standard Philippine K to 12 subjects present out of the box,
So that a fresh environment can accept uploads without manual taxonomy entry.

**Acceptance Criteria:**

**Given** the seed runs on an environment with no subjects
**Then** the default subjects are created enabled, and each is linked, enabled, to the grade levels in the default mapping

**Given** the seed runs again
**Then** nothing is created twice, keyed on Subject `nameKey` and on the (Subject, Grade Level) pair

**Given** an operator has renamed, disabled, or unlinked a subject or link
**When** the seed runs again
**Then** that change is preserved: nothing is recreated, re-enabled, or relinked

**Given** a grade level in the mapping does not exist (renamed or never seeded)
**Then** its links are skipped and the seed still succeeds, reporting the skip

**Given** the seed output
**Then** it reports subjects created and links created
```

**Default mapping (approved 2026-10-12):**
| Grade levels | Subjects |
|---|---|
| Kindergarten | Mathematics, English, Filipino |
| Grade 1–2 | Mathematics, English, Filipino, Makabansa, GMRC |
| Grade 3 | Mathematics, Science, English, Filipino, Makabansa, GMRC |
| Grade 4–6 | Mathematics, Science, English, Filipino, Araling Panlipunan, MAPEH, GMRC, EPP |
| Grade 7–10 | Mathematics, Science, English, Filipino, Araling Panlipunan, MAPEH, Values Education, TLE |
| Grade 11–12 | Mathematics, Science, English, Filipino, Social Sciences |

### 4.2 `epics.md` — add Story 3.7 (after Story 3.6)

```
### Story 3.7: Upload Stepper

As a parent,
I want uploading a test broken into clear steps,
So that I only see what I can act on right now.

**Acceptance Criteria:**

**Given** Upload a test
**Then** a 4-step stepper is shown — Details, Pages, Check, Generate — with the current step named in text and announced on change

**Given** step 1 (Details: child, grade level, subject)
**When** no subject is chosen, or the chosen grade level offers no subjects, or no grade levels exist
**Then** only the classification controls and their message are shown; the page controls (Order, add pages, page strip) are not rendered, and Next is disabled

**Given** a subject and grade level are set
**When** I press Next
**Then** step 2 (Pages) shows add pages and the ordered page strip; Next is disabled at zero pages

**Given** step 3 (Check)
**Then** the batch legibility check and the commit confirmation behave exactly as Story 3.4

**Given** any step before commit
**When** I press Back
**Then** I return to the previous step with everything already entered kept

**Given** the upload is committed
**Then** steps 1–3 are read-only and the stepper shows them complete; step 4 (Generate) behaves as Stories 3.5, 3.6 and 4.1

**Given** I reload or return to an in-progress draft
**Then** the stepper opens on the furthest step the draft's saved state allows

**Given** keyboard and screen reader use
**Then** focus moves to the new step's heading on each step change, and Back/Next are real buttons with accessible names
```

### 4.3 `epics.md` — add Story 3.8 (after Story 3.7)

```
### Story 3.8: Plain-Language Check Step & Upload Allowance Left

As a parent,
I want the page check to use everyday words and show how much upload allowance I have left,
So that I know exactly what continuing will cost me.

**Acceptance Criteria:**

**Given** the Check step
**Then** no parent-facing string uses "commit", "block", or other system terms; every sentence says what happens to the parent in everyday words. The term "upload allowance" is kept, matching Settings

**Given** a limited plan
**When** the Check step opens
**Then** it shows the allowance left as a figure with the reset date, e.g. "Upload allowance: 4 of 5 left this month. Resets 1 November.", read from `GET /parent/allowances` and never computed in the app

**Given** an unlimited plan (`limit: null`)
**Then** it says "Your upload allowance is unlimited." and shows no figure

**Given** the allowance read fails
**Then** the step still works, the figure is omitted, and the cost sentence alone is shown

**Given** a successful continue
**Then** the figure shown afterwards reflects the upload just used (re-read, not decremented locally)

**Given** zero upload allowance left
**Then** the existing Story 9.3 at-cap behaviour applies unchanged
```

**Copy changes (`copy/parent.ts` → `capture.legibility`):**
| Key | Old | New |
|---|---|---|
| `heading` | How the pages read | Check your pages |
| `advisory` | This is a warning, not a block. Continuing is allowed. | You can still continue. Blurry pages may give less accurate practice questions. |
| `cost` | Continuing commits this upload and uses one upload allowance. | Continuing saves this test and consumes 1 upload allowance. |
| `allowanceLeft` *(new)* | — | `Upload allowance: ${left} of ${limit} left this month. Resets ${date}.` |
| `allowanceUnlimited` *(new)* | — | Your upload allowance is unlimited. |
| `noCost` | Nothing is used if you leave without continuing. | If you leave now, no upload allowance is consumed. |
| `committing` | Committing the upload… | Saving your test… |
| `checking` | Checking how clearly the pages read… | Checking your pages… |
| `failed` | The pages could not be checked. Try again. | We couldn't check your pages. Try again. |
| `allReadable`, `flagged`, `retakeFor`, `continueWith` | — | Unchanged (already plain). |

### 4.4 `EXPERIENCE.md` — amend Legibility result row

OLD (end of row):
```
States plainly that proceeding is allowed, and that proceeding consumes an Upload Allowance.
```
NEW:
```
States plainly, in everyday words, that continuing is allowed and that it consumes one upload allowance, and shows how much upload allowance is left this month with the reset date (from the Allowances read; unlimited plans say so instead of a figure). System terms such as "commit" are not used on this step; "upload allowance" is kept, matching Settings.
```

### 4.5 `EXPERIENCE.md` — add pattern row (Patterns table, after "Legibility result")

```
| Upload stepper | Upload → Classify → Capture pages → Legibility check → Generate | The upload flow is one screen with a **4-step stepper**: Details, Pages, Check, Generate. Only the current step's controls render. A step's Next is disabled until it is complete; Details is complete only when a subject is chosen, so a grade level offering no subjects is a stated message with no page controls under it. Back is free until commit; after commit earlier steps are read-only. *Why:* showing page controls before an upload can be classified invites work that cannot be submitted. |
```

### 4.6 `epics.md` — add Story 4.7 (after Story 4.6)

```
### Story 4.7: Obvious Progress Spinner & Sheet Tally

As a parent,
I want an obvious spinner while my pages are read, and to see each practice test arrive as a ticked sheet,
So that I can see at a glance the app is working and how far along it is.

**Acceptance Criteria:**

**Given** the capture page's Generate step while the pages are being read
**Or** the generation page while practice tests are being made
**Then** a large spinner (MUI `CircularProgress`, accent colour from `tokens.ts`, at least 48px) is centred above the status sentence, and nothing else on the card competes with it

**Given** the wait settles (ready, failed, or done)
**Then** the spinner is removed in the same render the result appears

**Given** `prefers-reduced-motion`
**Then** the spinner does not rotate; a static progress mark is shown with the same status sentence, so the wait is still obvious without motion

**Given** a screen reader
**Then** the spinner is `aria-hidden`; the existing `role="status"` sentence is what is announced, unchanged

**Given** one shared component
**Then** both waits use it, and no hex value is introduced outside `tokens.ts`

**Given** the generation page while a job runs or after it settles
**Then** a row of sheet icons is shown, one per requested practice test (`requestedCount` from the job view), wrapping on narrow screens:
- **Ready** (index < `producedCount`): sheet with a checkmark, `success` colour, light `success` tint fill
- **Being made** (index = `producedCount`, job running): sheet with the spinner ring around it, accent colour — this is the generation page's spinner
- **Waiting** (job running, later index): dashed outline sheet, `divider` colour
- **Not made** (job Partially complete or Failed, index ≥ `producedCount`): sheet with an ×, `textSecondary`

**Given** a sheet turns ready
**Then** the checkmark draws in and the sheet settles from 85% scale over `motion.durationStandard` with `motion.easing`; under `prefers-reduced-motion` it appears with no motion

**Given** colour removed
**Then** each state is still told apart by shape alone (check, ×, dashed outline, ring)

**Given** a screen reader
**Then** the tally is `aria-hidden`; the existing progress sentence (`role="status"`, unchanged words) is the announcement, shown directly under the tally

**Given** the visual reference `mockups/key-generation-progress.html`
**Then** the build matches it in states, colours and order; the spines win where they differ
```

### 4.7 `sprint-status.yaml`

```
epic-2: in-progress
2-3-default-subject-seed: backlog
epic-3: in-progress
3-7-upload-stepper: backlog
3-8-plain-language-check-step: backlog
epic-4: in-progress
4-7-obvious-progress-spinner: backlog
```

## 5. Implementation Handoff

- **Scope:** Minor — Developer agent implements directly (`bmad-build` / bmad-loop).
- **Sequence:** Story 2.3 → run seed on prod (explicit, confirmed step; deploy does not seed) → Story 3.7 → Story 3.8 → Story 4.7 → deploy.
- **Success criteria:**
  - Prod: choosing any seeded grade level offers at least one subject.
  - Upload page: with no subject chosen, no Order / page controls are visible.
  - Stepper walks Details → Pages → Check → Generate; Back works pre-commit; locked after.
  - Check step: no "commit" wording; shows e.g. "Upload allowance: 4 of 5 left this month. Resets 1 November."
  - Reading pages and making practice tests each show a large spinner; static mark under reduced motion.
  - Generation page shows N sheets; each landed test turns its sheet into a ticked sheet (0 of 5 = five plain sheets, 1 of 5 = one ticked).
  - Existing capture unit + E2E suites pass after update.

## Open Questions

None. Resolved 2026-10-12: subject mapping approved as proposed; prod seed run by Claude after explicit go-ahead; "allowance" kept, "commit" replaced, Settings unchanged.
