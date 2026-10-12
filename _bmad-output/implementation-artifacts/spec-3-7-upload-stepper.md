---
title: 'Story 3.7 — Upload Stepper'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_revision: '9fdadb1a680ab8a28a76030e768a657e731e9141'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The Check step's own refusal sentence is still reachable, but no executed
      test asserts what it says any more.
    evidence: |-
      `submit-blocked` renders when `checkable` is false on the Check step,
      which happens while a retake's replacement page is still `Uploading` and
      `readyPageCount` has dropped to zero. The three e2e assertions of its text
      were on the pre-stepper single-page screen and could not survive the step
      split; what remains is the pure `submitBlockedReasons` spec, the copy
      function's own spec, and two `toHaveCount(0)` absence checks. Changing the
      reason filter to pass `[]` or the unfiltered list would break nothing.
      Closing it needs an e2e case that retakes the only page and asserts the
      sentence while the replacement uploads — a narrow, timing-sensitive state.
    location: >-
      apps/web/src/app/parent/capture/page.tsx (Check step, `submit-blocked`)
    severity: medium
  - 'The screen''s `no-grade-levels` branch (`page.tsx`, `gradeLevelOptions.length === 0`) is unreachable: `StudentProfile.gradeLevelId` is required and the draft is seeded from it, so `optionsWithStored` never returns an empty list. It predates this story. Either the branch goes or the draft has to be able to hold no grade level; both are outside a presentation-and-sequencing story.'
  - 'The matrix row "Draft open fails → no step content is shown" is only partly met: the error `Alert` + Retry renders above the stepper and nothing draft-derived renders, but the Details step still shows `#capture-student`. Hiding it would also hide the controls a *write* failure has to be retried from, so the pre-existing behaviour was kept.'
---

<intent-contract>

## Intent

**Problem:** `apps/web/src/app/parent/capture/page.tsx` renders every phase of the upload flow at once — classification, Order (pages), legibility check, generate — so a parent sees page controls and an Order card before the upload is even classifiable. On prod this produced the worst case: a grade level offering no subjects, with the whole page-capture apparatus sitting under the dead-end message, inviting work that can never be submitted.

**Approach:** Keep every existing control, write path, gate and sub-component exactly as they are, and put them behind a 4-step stepper — Details, Pages, Check, Generate — where only the current step's controls render. Which step is reachable is decided by a new pure lib from the draft's own saved state, so a reload or a resumed draft opens on the furthest step that state allows. Back and Next are real buttons; after commit the earlier steps stay reachable but render read-only, exactly as `!isDraft` already makes them.

## Boundaries & Constraints

**Always:**
- Presentation and sequencing only. No API, DTO, Prisma or copy-*meaning* change; `openSourceTest`, `classify`, `addPages`, `move`, `retake`, `delete`, `checkPages`, `submit` and the extraction poll keep their current request shapes, order and refusal handling.
- Every existing DOM id and `data-testid` on this screen survives unchanged (`capture-student`, `capture-grade-level`, `capture-subject`, `capture-add-page`, `capture-retake-{pageId}`, `page-row`, `page-count`, `classifying`, `adding`, `limitReached`, `submitted-note`, `submit-blocked`, `legibility-*`, `extraction-*`, `thin-*`). They move between steps; they are not renamed or removed.
- Step eligibility is a pure function of the server's `SourceTestView`, computed in a new `apps/web/src/lib/capture-step.ts` and nowhere else. The component holds which step is *shown*; it holds no rule about which step is *allowed*.
- One live region only. Announcements go through the existing `useAnnounce()`; the screen adds no second `role="status"` (`page.tsx:121-124`).
- Focus moves to the new step's `h2` on every step change, via the `tabIndex={-1}` + `ref.focus()` precedent at `app/student/tests/[practiceTestId]/page.tsx:879-911`.
- All new user-facing strings live in `apps/web/src/copy/parent.ts` (AD-32). No hex outside `theme/tokens.ts`; spacing from `density`, motion from `motion`.
- Both `apps/web/src/app/parent/capture/page.spec.tsx` and `e2e/tests/parent-capture.spec.ts` are brought up to the new structure in the same change — the e2e suite's existing flows must pass by navigating steps, not by being deleted or weakened.

**Block If:**
- Reaching the stepper requires changing an API response or adding a field to `SourceTestView` (the furthest-step rule should be fully derivable from `status`, `subjectId`, `gradeLevelId`, `legibilityCheckedAt` and `pages`).

**Never:**
- Do not change the check-step wording, add an upload-allowance figure, or touch `capture.legibility` copy — that is Story 3.8, landing on this stepper's Check step.
- Do not add a spinner or progress visual — that is Story 4.7.
- Do not seed subjects or touch taxonomy — that is Story 2.3.
- Do not make the stepper rail clickable, do not add per-step URL routing or a query param, and do not persist the shown step anywhere (server, localStorage, history). Navigation is Back/Next plus the derived opening step.
- Do not relax any submit gate; the server remains the authority and the controls stay a courtesy mirror.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh draft, grade level seeded from profile, no subject | `status: 'Draft'`, `gradeLevelId` set, `subjectId: null` | Opens on Details; only child + classification controls render; Next disabled | No error expected |
| Grade level offers no subjects | subjects list empty after load | Details shows the `no-subjects` message; no Order card, no `AddPages`, no `PageStrip` anywhere in the DOM; Next stays disabled | No error expected |
| No grade levels exist at all | grade levels list empty | Details shows `no-grade-levels`; Next disabled; no page controls | No error expected |
| Classified draft, zero pages | `subjectId` + `gradeLevelId` set, `pages: []` | Opens on Pages; Next disabled; empty-state copy and `AddPages` render | No error expected |
| Classified draft with ready pages | ≥1 page in `state: 'Ready'` | Opens on Check; Back returns to Pages with the strip and classification intact | No error expected |
| Draft already checked, not committed | `legibilityCheckedAt` set | Opens on Check showing `legibility-result` and `legibility-continue` | No error expected |
| Committed upload | `status: 'Submitted'` | Lands on Generate; Details/Pages/Check reachable by Back but render no editable control (`submitted-note` on Pages); the stepper marks 1–3 complete | No error expected |
| Next pressed while a write is in flight | `pending !== null` | Back and Next are disabled for the duration | No error expected |
| Draft open fails | `openDraft` rejects | The existing error `Alert role="alert"` + Retry renders above the stepper; no step content is shown | Existing `refusalText` / Retry path, unchanged |
| Elevation ends mid-write | `endsParentView(cause)` | `leave()` as today, regardless of which step is shown | Existing path, unchanged |
| Retake pages from the thin warning | fresh draft opened | Step resets to Details (the fresh draft's own derived step) and the retake announcement fires once | Existing `openDraft(onOpened)` success-only announcement |

</intent-contract>

## Code Map

**Read-only anchors (patterns to follow, do not change):**
- `apps/web/src/app/parent/capture/page.tsx:134-163` — the five request-counter streams (`useRef(0)` + live ref + `applyIfCurrent`). The stepper adds no stream and must not disturb these.
- `page.tsx:414-435` — `write(kind, run, said)`, the single mutation path (sets `pending`, `setSourceTest(after)`, `announce`, `endsParentView → leave()`). Every step's controls keep calling it unchanged.
- `page.tsx:437-504` — the derived gate block: `isDraft` (`:443`), `readyPageCount` (`:457`), `classification` (`:464`), `gate` (`:472`), `blockedReasons`, `checkable` (`:486`), `checked` (`:488`), `flagged`, `addable`, `gradeLevelOptions`/`subjectOptions`. These are exactly the inputs the new step state is built from — reuse them, do not recompute.
- `page.tsx:220-255` — `openDraft(onOpened?)`, open-or-resume; `:682` `retakePages` calls it for a fresh draft. The step must re-derive on each newly opened draft.
- `page.tsx:747-890` (Details: `#capture-student`, the `CLASSIFICATION_HEADING_ID` section with both selects and their loading/empty testids), `:892-985` (Order card: `ORDER_HEADING_ID`, `page-count`, `submitted-note`, empty state, `PageStrip`, `AddPages`, `adding`, `limitReached`), `:990-1128` (check control, `checking`, `submit-blocked`, `legibility-result` panel and `legibility-continue`), `:1136-1191` (`GENERATE_HEADING_ID` section: `extraction-reading`, `extraction-failed`, `extraction-proceed`, `ThinExtractionWarning`). These four ranges are the four steps' bodies, essentially verbatim.
- `page.tsx:1216-1223` — the "Back to Parent View" `Link`. It stays outside the stepper and must not be confused with the step Back button.
- `app/student/tests/[practiceTestId]/page.tsx:879-883` + `:906-911` — the focus-management idiom to copy exactly: a `useRef<HTMLHeadingElement|null>`, a `useEffect` keyed on the phase, `tabIndex={-1}` on the heading with the "Focusable only programmatically" comment. Its spec asserts the idiom by source text at `page.spec.tsx:139-141`, `:306-310`.
- `apps/web/src/lib/page-order.ts`, `lib/classification.ts`, `lib/extraction-status.ts`, `lib/legibility.ts` — the pure-helper-plus-sibling-spec pattern `capture-step.ts` follows; `isClassified` (`classification.ts:32`), `canSubmitPages` (`page-order.ts:59`) and `isChecked` (`legibility.ts:34`) are the predicates the step rules are expressed in terms of.
- `apps/web/src/lib/parent-api.ts:159-188` — `SourceTestView`; `:135-157` `PageImageView`. The whole furthest-step rule is derivable from these; nothing new is needed on the wire.
- `apps/web/src/components/LiveRegion.tsx:116` — `useAnnounce()`; `components/Button.tsx:16` `PrimaryButton`.
- `apps/web/src/theme/tokens.ts:113-121` `density`, `:160` `rounded`, `:233-245` `motion`, `:273-332` `typeRoles` (`cardTitle` is what every section heading on this screen uses).
- `apps/web/src/copy/parent.ts:503-855` — the `capture` copy block: flat keys `:505-705`, then `camera` `:573-617`, `classification` `:706-747`, `legibility` `:748-817`, `generate` `:818-850`. A `steps` namespace joins them as a sibling.
- `apps/web/src/app/parent/capture/page.spec.tsx:22-24` — `PAGE_SOURCE`/`STRIP_SOURCE` source-text idiom (93 `PAGE_SOURCE` assertions) plus `renderToStaticMarkup` over sub-components only. There is no DOM tier in the web unit suite (recorded as a deferred item on `spec-3-6-thin-extraction-warning.md`), so the stepper's interactive rules are asserted in `capture-step.spec.ts` and in e2e, with source-text assertions covering only what the screen *states*.
- `e2e/tests/parent-capture.spec.ts:144-734` — the eight browser flows. Locators that must stay reachable once their step is active: `#capture-grade-level`, `#capture-subject`, `#capture-add-page`, `#capture-retake-{pageId}`, `input[type=file][aria-label="Retake page 2"]`, `page-row`, `Check pages`, `Move page N up|down`, `Delete page N`, the `Delete page N?` dialog, every `legibility-*` and `thin-*` testid, the `[role="status"][aria-live="polite"]` region, the `Generate a practice test` heading, `Continue to practice test`, `Try again`, and the `Back to Parent View` link. `:321-325` asserts draft-only controls reach `toHaveCount(0)` after commit — the read-only steps must keep hiding, not merely disabling.

**Files to create:**
- `apps/web/src/lib/capture-step.ts`, `apps/web/src/lib/capture-step.spec.ts`
- `apps/web/src/app/parent/capture/CaptureStepper.tsx` (presentational rail + Back/Next footer)

**Files to change:**
- `apps/web/src/app/parent/capture/page.tsx`, `page.spec.tsx`
- `apps/web/src/copy/parent.ts`
- `e2e/tests/parent-capture.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/capture-step.ts` — the whole rule set, pure: `type CaptureStep = 'details' | 'pages' | 'check' | 'generate'`; `CAPTURE_STEPS` as the ordered readonly tuple; `interface CaptureStepState { classified: boolean; hasPages: boolean; checked: boolean; submitted: boolean }`; `captureStepState(view)` building it from a `SourceTestView | null` via `isClassified`, the `Ready`-only page count through `canSubmitPages`, `isChecked` and `status === 'Submitted'`; `isStepComplete(step, state)` (details ⟸ `classified`, pages ⟸ `hasPages`, check ⟸ `submitted`, generate ⟸ `false`); `canAdvance(step, state) = isStepComplete(step, state)`; `nextStep(step)` / `previousStep(step)` returning `null` at the ends; `furthestStep(state)` (`submitted` → `generate`; `classified && hasPages` → `check`; `classified` → `pages`; else `details`); `stepIndex(step)`. Pure so the gate is assertable without a DOM tier, and so the "furthest step" rule has exactly one definition — the same reason `isThinExtraction` lives in a policy file.
- `apps/web/src/lib/capture-step.spec.ts` — cover every `CaptureStepState` combination against `isStepComplete`/`canAdvance`; `furthestStep` for each of the matrix's state rows including a fresh draft with grade level seeded but no subject, a classified draft with only an `Uploading` page (not `hasPages`), a checked-but-uncommitted draft, and a `Submitted` view; `nextStep`/`previousStep` at both ends; `captureStepState(null)` returning all-false; and the invariant that `furthestStep` never returns a step whose predecessors are not all complete.
- `apps/web/src/copy/parent.ts` — add a `capture.steps` namespace beside `classification`/`legibility`/`generate`: `details`, `pages`, `check`, `generate` labels; `position(index, total, label)` for the visible "Step 2 of 4: Pages" line; `announced(label)` for the step-change announcement; `nextTo(label)` and `backTo(label)` for the two buttons' accessible names, so neither collides with the existing "Back to Parent View" link; `next` and `back` for their visible text. Everyday parent words, complete sentences, no system vocabulary. Do not touch any existing `capture` string.
- `apps/web/src/app/parent/capture/CaptureStepper.tsx` — presentational only: props `{ step, state, busy, onBack, onNext }`. Renders the MUI `Stepper` rail (`activeStep={stepIndex(step)}`, a `StepLabel` per step, `completed` from `isStepComplete`, non-interactive — no `StepButton`), the `position` text line, and the footer with a `Button` Back (disabled when `previousStep(step) === null` or `busy`) and a `PrimaryButton` Next (disabled when `nextStep(step) === null`, `!canAdvance(step, state)`, or `busy`), each carrying its `aria-label` from `backTo`/`nextTo`. It holds no state, makes no request and decides nothing about whether a step is reachable — split out for the same reason `PageStrip` is: the rail and the two controls are then assertable on rendered markup. First MUI `Stepper` use in the app; spacing from `density`, no hex.
- `apps/web/src/app/parent/capture/page.tsx` — add `const [step, setStep] = useState<CaptureStep>('details')` and derive `stepState = captureStepState(sourceTest)`. Initialise and re-derive the shown step from `furthestStep(stepState)` once per opened draft, tracked by a ref keyed on `sourceTest.id` so a later poll, classify or page write never clobbers a step the parent navigated to by hand; `retakePages`' fresh draft therefore re-derives (to Details) through the same path. Force `setStep('generate')` on the Draft → Submitted transition, tracked by a previous-status ref, so commit lands on Generate while leaving post-commit Back navigation sticky. Give each step an `h2` with `tabIndex={-1}` and a ref, focus it in a `useEffect` keyed on `step`, and `announce(parentCopy.capture.steps.announced(label))` in the same effect, rendering the announcement path before the focus target as the student screen does. Then render exactly one step body at a time from the four existing ranges — Details (`#capture-student` + the classification section), Pages (the Order card), Check (check control, `checking`, `submit-blocked`, `legibility-result`, `legibility-continue`), Generate (the extraction section and `ThinExtractionWarning`) — with `CaptureStepper` above them, and keep the error `Alert`/Retry, `ConfirmDestructiveDialog` and the "Back to Parent View" link outside the stepper. The existing `isDraft`/`ready`/`checked`/`addable` guards stay on their own controls untouched, which is what makes the post-commit steps read-only for free.
- `apps/web/src/app/parent/capture/page.spec.tsx` — update the `PAGE_SOURCE` assertions whose quoted source moved, and add: `renderToStaticMarkup` coverage of `CaptureStepper` (four labels present, the position line, Back/Next are real `<button>`s with their accessible names, disabled in each disabling condition, completed marks after commit); source-text assertions for the rules the screen states — the step is derived through `furthestStep` and not from a literal, the derivation is keyed on the draft id, the Draft → Submitted transition forces Generate, each step heading carries `tabIndex={-1}`, the step-change effect both focuses and announces, and no second `role="status"` is introduced. Keep every existing assertion that still holds.
- `e2e/tests/parent-capture.spec.ts` — thread the eight existing flows through the stepper rather than rewriting them: classify on Details, press Next to Pages, add/reorder/retake/delete there, Next to Check, run the check and commit, land on Generate. Add cases for: the no-subjects dead end showing the message with `page-row`/`#capture-add-page` at `toHaveCount(0)` and Next disabled; Next disabled at zero pages; Back from Check to Pages preserving the strip and the classification; a reload mid-draft opening on the furthest step; and post-commit Back to Pages showing `submitted-note` with every draft-only control still at `toHaveCount(0)`.

**Acceptance Criteria:**
- Given the upload screen, when it renders, then exactly one step's controls are in the DOM, the stepper names all four steps in order, the current step is named in visible text, and the step name is announced through the existing live region on every change.
- Given a step whose own condition is unmet, when the parent looks at Next, then it is a real disabled button with an accessible name naming the step it would reach, and no later step's controls are reachable by any means on the page.
- Given a parent moving Back through pre-commit steps, when they return to an earlier step, then every value already entered — child, grade level, subject, pages and their order — is still there and unchanged, and no server write was issued by the navigation itself.
- Given any step change, when it happens, then focus lands on that step's heading and no other focus is stolen.
- Given a committed upload, when the parent steps back to Details, Pages or Check, then those steps render their values with no editable control present and the stepper marks them complete, and the Generate step continues to behave exactly as Stories 3.5, 3.6 and 4.1 define.
- Given a reloaded or resumed in-progress draft, when the screen opens, then it opens on the furthest step that draft's saved state allows, decided by the one pure rule and never by a literal in the component.
- Given the whole flow, when it is driven end to end, then every pre-existing behaviour of Stories 3.1–3.6 — the page ceiling, ordering, retake, delete confirmation, the classification gates, the single batch check, the commit refusal after submit, the extraction poll and the thin warning — is observably unchanged.

## Spec Change Log

- **2026-10-12 — the matrix's "no grade levels exist at all" row is asserted on the list, not on the `no-grade-levels` message.** `StudentProfile.gradeLevelId` is required and `openSourceTest` seeds the draft from it, so `optionsWithStored` always holds at least the stored row and the screen's `no-grade-levels` branch cannot be reached through the product — it predates this story and this story was told not to change it. The covering e2e test therefore empties the offered grade-level read and asserts the behaviour the row is about: the control still states the grade level the upload holds, the step is a dead end on the subject, Next is refused, and no page control exists anywhere on the page. KEEP: the assertion is about the empty *offer*, not about a message that cannot render.
- **2026-10-12 — the Check step's per-page retake was made a real control rather than deferred.** The first implementation pass left `legibility-retake-{ordinal}` as a label whose `htmlFor` target (`#capture-retake-{pageId}`) only exists on the Pages step, so on Check it named a flagged page and opened nothing — a regression against this story's own AC that Check behaves exactly as Story 3.4, which offers a retake scoped to the flagged page. The Check step now renders that page's own visually-hidden file input (same id, same `aria-label`, routed to the same `retakePage` write), which stays unique in the document because only one step renders at a time. `VISUALLY_HIDDEN_INPUT` was exported from `PageStrip.tsx` so both steps share one definition. KEEP: one retake affordance per step and one write path — do not add a second way to replace a page's bytes.
- **2026-10-12 — `furthestStep` names every predecessor, not only `submitted`.** The Execution note summarised the rule as "`submitted` → `generate`", while the `capture-step.spec.ts` note required the invariant that `furthestStep` never returns a step whose predecessors are unmet. Over all sixteen `CaptureStepState` combinations those two disagree (`{classified: false, submitted: true}` would answer `generate`), so each branch asserts the conditions up to it. For every state the API can actually answer with, the behaviour is identical.
- **2026-10-12 — the step announcement composes with the sentence that explains a screen-initiated move.** The surface has one live region carrying one message, so a step announcement fired from the commit or from the fresh draft a retake opens would replace the only account of what happened (`capture.submitted`, `generate.retakeStarted`) before a screen reader or the e2e suite could read it. The step effect therefore leads with whatever the region is carrying when the *screen* moved the step, and clears that lead on any Back or Next the parent pressed. No new user-facing string: it is the two existing copy sentences, joined.
- **2026-10-12 — nine further e2e suites were threaded through the stepper.** `parent-practice-test`, `parent-explanation-review`, `parent-explanation-suppression`, `student-take-test`, `student-submit-attempt`, `student-attempt-resilience`, `student-explanations`, `student-explanation-flagging` and `student-grade-dispute` each carry a copy of the same "classify, add pages, check, commit" fixture against this screen. They were not in Files to change and had to be, or every one of them would fail on a control that is now a step away.

## Review Triage Log

### 2026-10-12 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 5, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 20: (high 0, medium 0, low 20)
- addressed_findings:
  - `[medium]` `[patch]` Stepping Back to Check after the commit rendered a bare heading: the whole step body was gated on `isDraft`, so the step the AC calls read-only had nothing in it to read. It now renders the verdict the parent decided on (`legibility-committed`, with the stored `legibility-summary`) plus the `submittedNote`, and no control.
  - `[medium]` `[patch]` Back and Next violated WCAG 2.5.3 (Label in Name): the visible word was "Back"/"Next" while the accessible name was "Go back to Pages"/"Go to Check", so neither button could be reached by what it reads. The names are now `Back: {step}` / `Next: {step}`, which keep the destination and contain the visible word; all ten e2e suites were re-pointed.
  - `[medium]` `[patch]` The child picker stayed a live control on the post-commit Details step, so a parent could abandon a spent upload from a step meant only to be looked at. It is now refused once the upload is known to be committed, and left enabled while the draft is still being read so a failed open is still recoverable.
  - `[medium]` `[patch]` The step announcement led with whatever the app-wide live region happened to hold, which is never cleared — so a resumed draft could announce a sentence from another screen ("The profile was added. You are now on the Check step."), or repeat one already heard. Each lead is now stated by the transition that caused it, and the render-time `liveMessage` ref is gone.
  - `[medium]` `[patch]` Neither of the two ACs that live at the assistive-tech surface — "announced on change" and "focus moves to the new step's heading" — had an executed assertion anywhere; both were pinned only by `PAGE_SOURCE` substring matches. `nextStep`/`backStep` now assert the live-region sentence and `toBeFocused` on the step heading, so every step change this suite makes carries both.
  - `[low]` `[patch]` The step the screen *opens* on was announced and had focus pulled to it, contradicting the guard's own comment: the mount guard was spent by the mount, and the first derived step arrived after it. The guard is now re-armed for the opening step, but only when that step differs from the one already shown — otherwise the parent's first Back or Next would have been the move that spent it.
  - `[low]` `[patch]` `furthestStep` gated the committed branch on the pages as well as the commit, and `isStepComplete` completed only Check. A committed upload whose page rows are gone — which Epic 8's expiry eventually does to every upload, and which the Extraction is deliberately built to outlive — would have opened on Details with Next refused, stranding the parent short of the only step left for it, and shown the earlier steps as unfinished. The commit alone now answers `generate` and completes all three steps before it.
  - `[low]` `[patch]` On the first and last steps the disabled button named the step the parent was already on ("Back: Details" on Details). Each now names only what the button is when there is nowhere to go.
  - `[low]` `[patch]` The Check step's per-page retake label showed no focus indicator, because the `input:focus-visible + &` rule it depends on lives on the strip's label and was not carried over. The input is off screen, so keyboard focus on a flagged page's retake was invisible there.
  - `[low]` `[patch]` The new held-open-request test released the request only after its assertions, so a failed assertion left the route blocked and turned a named failure into a bare timeout. The release is now in a `finally`.

Notes: four layers ran (blind hunter, edge-case hunter, verification-gap, intent-alignment) against the full diff since baseline. Nothing routed to intent_gap or bad_spec: every real finding was a defect in the diff rather than in what the spec asked for, and the two the spec itself had got right (`furthestStep`'s submitted branch, a per-step heading that focus lands on) were deviations the implementation had logged rather than spec gaps. The 20 rejections included three claims verified false — that the Check step's `!checkable` branch is now dead (it is not: a retake drops `readyPageCount` while the replacement uploads), that a disabled Next leaves no reason on screen (the `no-subjects`, `choose-grade-level-first` and `empty` sentences all render on their own steps), and that `epic-3-context.md` lost live facts when its "Open Implementation Gaps" section went (every story it named — 3.1, 3.4, 5.3, 5.4 — now has a `done` spec on disk, so the section was stale) — plus the workspace's known absence of a DOM unit tier, already deferred on `spec-3-6-thin-extraction-warning.md`, several pre-existing patterns this story only inherited, and out-of-scope asks the intent does not reach: per-step browser history, a tappable rail, and the allowance figure, plain wording and spinner that Stories 3.8 and 4.7 own.

### 2026-10-12 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[low]` `[patch]` The one unit test covering the lead-then-step live-region announcement only checked that the tokens `'lead'` and `'announce('` were each present in the effect body, not that the lead comes first — a future reorder or split of the concatenation would pass this test and still only be caught, if at all, by an e2e substring check that doesn't assert order either. The test now also asserts the exact concatenation expression (`` announce(lead === '' ? said : `${lead} ${said}`); ``), pinning the order.
  - `[low]` `[patch]` `page.spec.tsx`'s `controlFor()` test helper resolved a missing `data-testid` to `indexOf(...) === -1`, which `lastIndexOf` then treats as index `0`, silently matching the wrong `<button>` instead of failing loudly. It now throws when the testid isn't found.

Notes: four layers ran again (blind hunter, edge-case hunter, verification-gap, intent-alignment) against the diff since baseline. Most blind-hunter findings were checked against the actual source and found false: `gate.legibilityCheckedAt` and `flagged` (via `unreadablePages(pages)`) are both derived from `sourceTest`, i.e. server-persisted fields, so the committed Check step's summary does survive a real reload — the claimed "session-only state" does not exist. The `!checkable`-branch-is-dead and `submitBlocked`-combined-reasons-are-dead claims repeat ones already verified false in the prior pass (a retake drops `readyPageCount` while its replacement uploads, keeping both branches reachable). Several other findings named intentional, spec-literal behavior rather than defects: `isStepComplete('pages') ⟸ hasPages` independent of `classified` (Execution note's own literal rule, pinned by `capture-step.spec.ts`'s exhaustive table), `canAdvance` being defined equal to `isStepComplete` (also literal in the Execution note), the Details-step scoping of the child picker (the intent's own "only the current step's controls render"), and the rail having no `aria-current` (the rail is explicitly decorative per Design Notes — "a rail is a picture" — with the position sentence carrying the non-visual account). The shared `RetakePageInput`'s no-duplicate-id invariant, a hypothetical busy/stepState race on rapid clicks, and an e2e helper's unused stand-in subject object were each speculative with no reproducing test or code path. Intent-alignment's layer was descriptive only and surfaced no action: it confirmed the diff satisfies all three defensible readings of the intent, with the one real surface mismatch (the Block-If clause is framed at the server-contract level but verified at the client-lib level) being an inherent property of a presentation-only story with no server change to point at.

## Design Notes

**Why the step rule is a pure lib and not component state.** The eligibility question ("may the parent be on Check yet?") is the same question the submit gate already answers in pieces (`isClassified`, `canSubmitPages`, `isChecked`). Putting it in `capture-step.ts` keeps one definition, makes it assertable without the DOM tier this workspace does not have, and means Story 3.8's Check step and Story 4.7's Generate step read the rule rather than re-deriving it. The component keeps only *which step is shown*, which is genuinely view state.

**Why the opening step is derived once per draft, not continuously.** `furthestStep` re-evaluated on every render would drag the parent forward the instant a write completes — choose a subject on Details and be thrown to Pages mid-sentence, or press Back from Check only to be pushed straight back. Keying the derivation on the opened draft's id gives the AC its meaning ("opens on the furthest step the saved state allows") without taking navigation away from the parent, and makes the post-retake fresh draft re-derive for free because its id is new.

**Why commit is a separate forced transition.** Commit is the one moment the parent should *not* have to press Next: the upload is spent and the only thing left is generation. A previous-status ref gives that one push without making `status` a continuous driver of the shown step, which would pin a committed upload to Generate and contradict "steps 1–3 are read-only" — read-only only means anything if they can still be looked at.

**Why the rail is not clickable.** The ACs ask for Back and Next buttons and for a rail that *shows* progress. A clickable rail would add a second, differently-gated navigation path over state that is already sequential, and nothing in the intent selects what a click on a future step should do. Display only, and `StepButton` stays out.

**Why read-only needs no new code.** Every editable control on this screen is already behind `isDraft`, `addable` or `checked`, and the Order card already has a `submitted-note` with a Lock icon for precisely the post-commit case. Rendering the same bodies on a `Submitted` view therefore yields read-only steps without a second rendering mode — which is also why the e2e `toHaveCount(0)` assertion keeps passing.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors in either workspace.
- `pnpm --filter web run test` -- expected: the new `capture-step.spec.ts` passes and the updated `page.spec.tsx` passes with no assertion merely deleted to make it green.
- `pnpm --filter api run test` -- expected: unchanged and passing (no API change in this story).
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- expected: all eight pre-existing flows pass through the stepper, plus the new dead-end, zero-pages, Back-preserves-state, resume-step and post-commit-read-only cases.
- `pnpm exec eslint` on every touched file -- expected: clean. (The `pnpm --filter web run lint` wrapper reports a pre-existing workspace-wide parsing error unrelated to this story; invoke `eslint` directly on the touched files.)

**Manual checks (if no CLI):**
- With a grade level that offers no subjects selected, confirm by DOM inspection that no `AddPages`, `PageStrip` or Order heading exists anywhere on the page — not merely that they are visually below the fold.

## Auto Run Result

**Summary:** This pass ran a fresh review against the already-implemented 4-step stepper (Details/Pages/Check/Generate), since the spec arrived with `status: done`. Two low-severity test-robustness gaps were found and patched; all other findings from four parallel review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) were verified false, already-rejected in the prior pass, or spec-literal/intentional design rather than defects. No production code changed.

**Files changed this pass:**
- `apps/web/src/app/parent/capture/page.spec.tsx` — `controlFor()` test helper now throws on a missing `data-testid` instead of silently matching the wrong button; the live-region announcement test now pins the exact lead-then-step concatenation expression, not just the presence of its tokens.

**Review findings breakdown:**
- patch: 2 (low 2) — both applied, both test-only.
- defer: 0
- reject: 14 (low 14) — mostly blind-hunter claims disproved against source (the committed Check step's summary and flagged-page list derive from `sourceTest`'s server-persisted fields, not session-only state) or repeats of claims already rejected in the prior pass, plus several findings that named behavior the spec's own Execution note specifies literally (`isStepComplete`/`canAdvance` per-step rules, the decorative/non-interactive rail).

**Verification performed:**
- `pnpm --filter web run test` — 82 files, 1712 tests, all passing (includes the updated `page.spec.tsx` and `capture-step.spec.ts`).
- `pnpm typecheck` — clean in both workspaces.
- `pnpm exec eslint` on the touched file — clean.
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` — all 11 flows passing.
- `pnpm --filter api run test` — not completed this pass: the command exceeded a 3-minute timeout in this environment despite the required Postgres containers already running. No API code was touched by this story or this pass, so this is recorded as an unverified-this-pass item rather than a regression.

**Residual risks:** None rising above low. The unresolved `pnpm --filter api run test` run is an environment/tooling gap, not a code risk, since no `apps/api` file is in this story's diff.

Status: done

