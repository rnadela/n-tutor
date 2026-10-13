---
title: 'Story 10.5: Student Results Tab'
type: 'feature'
created: '2026-10-13'
baseline_revision: '80679891a31c97bae0bcac81eef95992eb164ede'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/apps/web/AGENTS.md']
warnings: ['oversized']
deferred:
  - summary: >-
      Everything the Results screen does at runtime is pinned only by regex over
      its own source text, so a change that keeps the spelling and breaks the
      behaviour ships green.
    evidence: |-
      `apps/web` runs vitest with `environment: 'node'` and no DOM, a repo-wide
      convention older than this story, so `app/student/results/page.spec.tsx`
      reads the page as a string. A reviewer moved the stale-request guard below
      its setter — killing it — and all 19 tests still passed, because the
      assertion counts occurrences of the guard's text, not its position. The
      same holds for the unbound-device routing, the retry that re-issues both
      reads, and the silent run-read failure: none is executed by any test. The
      new `e2e/tests/student-results.spec.ts` closes the rendered-rows and
      ordering half of this; the error, loading and retry paths remain
      source-text only. Closing it means either a jsdom environment for this
      route or extracting the load/settle logic into a framework-free module
      with the reads injected.
    location: >-
      apps/web/src/app/student/results/page.spec.tsx
    severity: medium
  - summary: >-
      `studentCopy.resultsList.failed` is effectively unreachable, so a failed
      list read shows Home's generic sentence instead of the screen's own.
    evidence: |-
      `setTestsError(cause instanceof Error ? cause.message : resultsList.failed)`
      — and `parentApi.call()` always rejects with a `ParentApiError extends
      Error` whose message is either the server's or the `studentCopy.failed`
      string handed to the call site. The `instanceof Error` branch therefore
      always wins. Student Home has the identical shape, so this is a pattern
      rather than a slip, and fixing it properly means letting a call site state
      its own failure sentence in `parent-api.ts` — which this story's
      boundaries put out of scope.
    location: >-
      apps/web/src/app/student/results/page.tsx
    severity: medium
  - summary: >-
      The Results route imports `deviceIsUnbound` from Home's page module,
      coupling one route file to another.
    evidence: |-
      `import { deviceIsUnbound } from '../page'` pulls Home's module (and its
      import graph) into the Results route's client chunk unless the bundler
      tree-shakes it. The helper is framework-free and belongs beside
      `student-results.ts` in `@/lib`. Directed by this story's intent contract,
      so moving it is a spec-level change rather than a patch.
    location: >-
      apps/web/src/app/student/results/page.tsx
    severity: low
  - summary: >-
      Swapping the loading alert for the empty state announces nothing, and
      pressing Retry drops keyboard focus to the body.
    evidence: |-
      The loading `Alert` carries `role="status"`; the empty-state `Box` that
      replaces it carries no live region, so a screen-reader user hears
      "Loading…" and then silence. Retry calls `load()`, which clears
      `testsError`, which unmounts the alert the focused button lives in, and
      nothing moves focus to the replacement. Student Home has both behaviours
      too, so the fix belongs to both screens at once.
    location: >-
      apps/web/src/app/student/results/page.tsx
    severity: low
  - summary: >-
      A read that rejects with an unbound device after the child has already
      left the screen still routes them to sign-in.
    evidence: |-
      The `requestId` ref guards staleness within the screen but nothing
      cancels on unmount, so a late `notBound` rejection from either read can
      fire `router.replace('/auth/sign-in')` from whatever screen the child
      moved to. Student Home carries the same hazard, which is why this is
      filed rather than patched here.
    location: >-
      apps/web/src/app/student/results/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Student Home is one flat list in the server's order — everything still to do, then everything finished — so a child going back to an answer key has to scroll past every unstarted test to reach it, and below `lg` the bar built by Story 10.4 has only two tabs with nowhere to put that shortcut.

**Approach:** Add a `/student/results` route that reads the same two student endpoints Home reads, filters to `Completed` on the client through one pure helper, and renders the result with Home's own `PracticeTestRow`; add a third `Results` tab to `STUDENT_TABS` between Home and Parent, and a Home link to it that shows from `lg` up where the bar does not exist.

## Boundaries & Constraints

**Always:**
- **Newest-first is the server's order, preserved — never a sort taken here.** `GET /student/practice-tests` states band 2 (the finished tests) most-recently-submitted first (`StudentPracticeTestController.released`, and the service it calls says why at length). The helper filters and keeps relative order; nothing in `apps/web` sorts, reverses, re-orders or compares a `submittedAt` to produce this screen, exactly as Home does not.
- The completed-only rule is one pure exported function in `apps/web/src/lib/student-results.ts`, argument-in/value-out, so the filter and the order are assertable without a DOM (`environment: 'node'`, the reason `practice-test-runs.ts` and `bottom-nav.ts` exist as modules).
- Rows are `PracticeTestRow` via `PracticeTestList`, unchanged and un-forked: same Subject line, same state label, same run line, same `/student/tests/{id}` destination — which is where a completed test's results already live.
- Reads are `parentApi.studentPracticeTests()` and `parentApi.practiceTestRuns()` only. No new API, no new endpoint, no profile id in any request, no bearer — the binding cookie names the child server-side.
- The three failure behaviours are Home's, because this screen is the same two reads: `deviceIsUnbound(cause)` (imported from `app/student/page.tsx`, already exported) routes to `/auth/sign-in`; any other list failure is an inline retryable alert that never routes; a failed run read says nothing at all and renders rows without their figure.
- `tests === null` (unanswered) is held apart from `[]` (answered, nothing finished): the empty state is a claim only an answered read may make.
- The empty state says what will appear and how to make it appear — never a bare absence — and every string on the screen lives in `apps/web/src/copy/student.ts` (UX-DR31). No sentence is written in a component.
- The Results tab is `STUDENT_TABS[1]`, between Home and Parent, `match: 'exact'`, href `/student/results`, label from `studentCopy.bottomNav.results`, no `onPress` (nothing is being left behind — this is inside Student Mode).
- Home's new Results link sits in the same control cluster as the Parent View link and the colour-mode switch, and is gated `display: { xs: 'none', lg: 'inline-flex' }` by the same reasoning: below `lg` the tab is that control, and two controls for one destination is one too many.
- Accessibility Floor in light and dark: the heading is the page's `h1`, the list keeps `PracticeTestList`'s explicit `role="list"`, controls meet `comfortableDensity.tapTarget`, and no state is told by colour alone (the row already handles that).
- Every figure from `@/theme/tokens` (`comfortableDensity`, `rounded`, `typeRoles`); no new hex, no bare px for colour or spacing.

**Block If:**
- `GET /student/practice-tests` turns out not to state the finished band most-recently-submitted first, because then "newest first" would need either an API change or a client sort, and both are outside this story.

**Never:**
- No change to Student Home's list: it stays one flat server-ordered list that still includes completed tests (FR-16). No sort, no filter, no grouping and no second heading added there.
- No change to `PracticeTestRow`, `PracticeTestList`, `parent-api.ts`, any API handler, any schema or migration, any architecture decision, or any dependency.
- No change to `bottomNavShown` — `/student/results` is an ordinary Student Mode route and carries the bar; only `/student/tests/*` does not.
- No new client persistence, no caching of the two reads, no polling, no retry timer: the one retry is the control beside the alert.
- No score, percentage, denominator or ranking computed anywhere on this screen; figures are the server's, rendered by the row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mixed list | `[NotStarted, Completed A, InProgress, Completed B]` | `completedTests(...)` → `[Completed A, Completed B]` | No error expected |
| Order preserved | server order `[C-newest, C-older, C-oldest]` | same three, same order — no re-ordering of any kind | No error expected |
| Nothing finished | `[NotStarted, InProgress]` | `[]` → the empty state renders | No error expected |
| Nothing at all | `[]` | `[]` → the empty state renders | No error expected |
| Unanswered read | `tests === null` | loading status, never the empty state | No error expected |
| Unknown state tag | a row whose `state` is none of the three | excluded — only `'Completed'` is admitted | No error expected |
| List read fails | 500 / network | inline retryable alert, no routing, heading stays | `studentCopy.failed`, `Try again` re-issues both reads |
| Device unbound | `ParentApiError.notBound` on either read | `router.replace('/auth/sign-in')` | The one failure that routes |
| Run read fails | `practiceTestRuns()` rejects (not unbound) | rows render with no run line, no alert, nothing re-issued | Silent by design |
| Tab is current | `tabIsCurrent('/student/results', { href: '/student/results', match: 'exact' })` | `true`; on `/student` → `false` | No error expected |
| Bar on the screen | `bottomNavShown('/student/results')` | `true` | No error expected |

</intent-contract>

## Code Map

- `apps/web/src/app/student/page.tsx:36-38,78-186,326-349` -- Home. `deviceIsUnbound` (`:36-38`) is already exported and is imported by the new page rather than re-stated. `load()` (`:111-186`) is the three-read pattern to copy minus the session read: independent settlement, a `requestId` ref guarding against a superseded response, the list's own `testsError`, and the run read that says nothing when it fails. `:326-349` is the control cluster (`Divider`, Parent View `Button` gated `display: { xs: 'none', lg: 'inline-flex' }`, `<ColorModeSwitch />`) the Results link joins. **Nothing about the list itself changes here.**
- `apps/web/src/app/student/_components/PracticeTestList.tsx` + `PracticeTestRow.tsx` -- reused verbatim: `PracticeTestList` already takes `tests` + an optional `runs` map and renders a flat `role="list"`; the row links to `/student/tests/{id}`, which is the results screen for a completed test. Read-only in this story.
- `apps/web/src/lib/practice-test-runs.ts:runsById` -- the id→runs map the page hands to the list; already exported, used unchanged.
- `apps/web/src/lib/parent-api.ts:332-337,1477-1518` -- `StudentPracticeTestSummary` (`id`, `subjectName`, `questionCount`, `state`) and the two calls. Note the summary carries **no timestamp**: newest-first can only come from the server's order, which is the Block-If above.
- `apps/api/src/practicetest/student-practice-test.controller.ts:66-93` -- the contract this screen leans on, in its own words: "Band 1 is newest *made* first … band 2 is most recently submitted first", and "Completed rows are returned unconditionally and forever". Read-only evidence; do not touch the API.
- `apps/web/src/app/student/_components/StudentBottomNav.tsx:22-40` -- `STUDENT_TABS`, the two-entry array that gains Results in the middle. Its doc comment currently says "There is no Results tab and no `/student/results` route — that is Story 10.5" and must be rewritten, not left lying.
- `apps/web/src/app/student/_components/StudentBottomNav.spec.tsx:44-49,53-57,70-78` -- the spec that pins the two hrefs, the labels and `expect(CODE).not.toContain('/student/results')`. That negative assertion and the href list are this story's to update; the file is otherwise the idiom to follow (`SOURCE`/`CODE` comment-stripped read, `renderToStaticMarkup` under `studentTheme`, emotion sheet via `css()`).
- `apps/web/src/lib/bottom-nav.ts:69-83,96-104` -- `bottomNavShown` (`/student/results` is not excluded, so it already answers `true` — add a spec row, change no rule) and `tabIsCurrent`.
- `apps/web/src/copy/student.ts:8-22,240+,737-751` -- `title`/`empty`/`practiceTestsTitle` as the voice to match; the existing `results:` block is **one Attempt's** results screen (`heading: 'Your results'`, `retake`, `explain`…) and is not where this screen's copy goes; `bottomNav` (`:745-751`) gains `results`. Second person, no exclamation marks, no figures in a sentence.
- `apps/web/src/app/student/page.spec.tsx:1-18` -- the source-read spec idiom for a page this workspace cannot render (no DOM, no router): `SOURCE`, comment-stripped `CODE`, plus executing assertions on whatever the page exports as a pure function.
- `apps/web/src/app/student/layout.tsx` -- already mounts `StudentBottomNav` and its spacer for every Student Mode route; the new page needs nothing from it.
- `e2e/tests/bottom-nav.spec.ts:295-346` -- the Student Mode case: sign-up → PIN → add profile → "Back to Student Mode", then asserts `studentBar.getByRole('link')` has text `['Home', 'Parent']` and the 48px floor per label. Both lists are this story's to extend. `PHONE`/`DESKTOP` viewports and `bar(page)`/`drawerPanel(page)` helpers are at the top of the file. Playwright runs one Chromium worker with a 60s timeout — reuse this flow; never generate a practice test.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/student-results.ts` -- new, framework-free: `export function completedTests(tests: readonly StudentPracticeTestSummary[]): StudentPracticeTestSummary[]` returning `tests.filter((t) => t.state === 'Completed')`, with a doc comment stating that the order is the server's band-2 order (most recently submitted first) and that nothing here sorts -- the filter is the screen's one rule, and a rule in a component is a rule this workspace cannot test.
- `apps/web/src/lib/student-results.spec.ts` -- new: every pure row of the I/O matrix — mixed list, order preserved across a filter, nothing finished, empty input, an unrecognised state tag — plus `expect(SOURCE).not.toMatch(/\.sort\(|\.reverse\(|toSorted|submittedAt/u)` so "newest first" cannot quietly become a client sort.
- `apps/web/src/app/student/results/page.tsx` -- new client page: the two reads settled independently with Home's `requestId` guard, `deviceIsUnbound` imported from `../page`, a list error alert with a retry that re-issues both, a silent run-read failure, `completedTests(...)` into `PracticeTestList` with `runsById(...)`, an `h1` from copy, and the empty state (dashed-border block, `BookOpen` glyph, `data-testid="student-results-empty"`) only once `tests !== null` -- one screen, every rule it follows already written down somewhere this file can point at.
- `apps/web/src/app/student/results/page.spec.tsx` -- new, `page.spec.tsx` idiom: the page calls only `studentPracticeTests` and `practiceTestRuns` (no `studentSession`, no profile id, no `fetch`), filters through `completedTests` rather than inline, renders `PracticeTestList`, holds `tests === null` apart from `[]` before showing the empty state, routes only on `deviceIsUnbound`, states nothing on a failed run read, and writes no sentence of its own (`not.toMatch(/'[A-Z][a-z]+ .{10,}'/u)`-style copy-module check consistent with the file's existing conventions).
- `apps/web/src/copy/student.ts` -- add a `resultsList` block (heading, empty-state sentence naming what appears and how, loading, failed, the Home link's label and the back-to-practice link if one is rendered) and `bottomNav.results` -- a separate block from `results:`, which belongs to one Attempt's answer key; sharing it would make two screens one rename apart.
- `apps/web/src/app/student/_components/StudentBottomNav.tsx` -- insert the Results tab between Home and Parent (`/student/results`, `studentCopy.bottomNav.results`, a `ClipboardCheck` glyph, `match: 'exact'`, no `onPress`) and rewrite the comment that currently promises no Results tab -- three tabs, in the order the story names them.
- `apps/web/src/app/student/_components/StudentBottomNav.spec.tsx` -- update the href list to the three tabs in order, the label list to the three copy keys, drop the `not.toContain('/student/results')` assertion, extend the 48px-floor loop, and add `expect(bottomNavShown('/student/results')).toBe(true)` -- the spec that named this story must now name what it got.
- `apps/web/src/app/student/page.tsx` -- add a Results `Button` (`component={NextLink}`, `href="/student/results"`, same glyph as the tab) beside the Parent View link, gated `display: { xs: 'none', lg: 'inline-flex' }`, label from copy -- at `lg` and above there is no bar, so without this the screen would be reachable only on a phone.
- `apps/web/src/app/student/page.spec.tsx` -- assert the Results link is present, gated to `lg` and above like the Parent View link, labelled from copy, and that nothing about the list, its order or its contents changed in this file -- FR-16 is a claim about Home, so Home's own spec is where it is kept.
- `e2e/tests/bottom-nav.spec.ts` -- extend the Student Mode case: at 390×844 the bar's three tabs read `['Home', 'Results', 'Parent']`, each clears 48px; pressing Results performs a client-side navigation to `/student/results`, the Results heading is visible, the Results tab carries `aria-current="page"`, and with no finished tests the empty state is shown; at 1280×800 the Results link on Home is visible and the bar is not -- the story's own acceptance says this E2E is extended rather than duplicated.

**Acceptance Criteria:**
- Given Student Mode below `lg`, when the bar is read, then its tabs are Home, Results and Parent View in that order, Results links to `/student/results`, and every label comes from `copy/student`.
- Given `/student/results` with finished tests, when it loads, then it lists only `Completed` practice tests in the order the server stated them, each rendered by the same `PracticeTestRow` Home uses with the same Subject, state word and run line, and opening one lands on that test's results — with no new endpoint called and no profile id sent in any request.
- Given `/student/results` with nothing finished, when the read answers, then an empty state says what will appear here and how to make it appear; and while the read has not answered, that sentence is not on screen.
- Given a failed list read, when it fails for any reason but an unbound device, then the heading stays, one retryable alert is shown, the child is not routed anywhere, and a failed run read alone changes nothing on screen at all.
- Given Student Home, when it is opened at any width, then its flat list is unchanged and still includes completed practice tests (FR-16), and from `lg` up a Results link sits beside the Parent View link.
- Given the Results screen in light and dark mode, when it is read by assistive technology, then the heading is the page's `h1`, the list keeps its list semantics, controls meet the 48px floor, and the Accessibility Floor holds in both schemes.
- Given the whole web suite, when `pnpm --filter web test`, `typecheck`, `lint`, `build` and `pnpm e2e` run, then every pre-existing result is unchanged and the new unit specs and the extended E2E pass.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 5: (high 0, medium 2, low 3)
- reject: 7: (high 0, medium 1, low 6)
- addressed_findings:
  - `[medium]` `[patch]` No test rendered the Results screen with a finished test on it — the central claim was pinned only by driving `completedTests()` and by source-text greps, and a reviewer hid the list behind a breakpoint with the whole suite still green. Added `e2e/tests/student-results.spec.ts`: two seeded completed papers plus one unsat one, asserting the two rows, their newest-first order, the absent unsat paper, both row hrefs and the navigation into one test's results; `seedGradedTopicFixture` gained an optional `submittedMinutesAgo` and now returns `practiceTestId`, and `seedReleasedPracticeTestFixture` was added for the unsat row. The reviewer's mutation now fails.
  - `[low]` `[patch]` `completedTests` returned a mutable array from a `readonly` input, re-opening the array it documents as handed back untouched — return type is now `readonly StudentPracticeTestSummary[]`.
  - `[low]` `[patch]` The module header in `student-results.ts` sat below the import and above a second block comment, attaching to nothing — moved above the import.

### 2026-10-13 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 18: (high 0, medium 1, low 17)
- addressed_findings:
  - none

## Design Notes

**Why no client sort.** `StudentPracticeTestSummary` carries no timestamp, so a client sort would need `runs.latest.submittedAt` — a figure that is absent whenever the run read failed, which would make the *order* of the screen depend on a read that is allowed to fail silently. The server already states finished tests most-recently-submitted first; filtering preserves that, and the screen degrades to "right rows, right order, no figures" instead of "re-ordered by whatever came back".

**Shape of the helper** — the whole rule, so the spec can drive it with no DOM:

```ts
export function completedTests(
  tests: readonly StudentPracticeTestSummary[],
): StudentPracticeTestSummary[] {
  // Order is the server's (band 2: most recently submitted first). Filtering
  // preserves relative order; nothing here sorts, reverses or compares a date.
  return tests.filter((test) => test.state === 'Completed');
}
```

## Verification

**Commands:**
- `pnpm --filter web test` -- expected: all specs pass, including the new `student-results` and `results/page` specs and the updated `StudentBottomNav`/`page` specs; no other pre-existing spec changes result
- `pnpm --filter web typecheck` -- expected: no errors
- `pnpm --filter web lint` -- expected: no errors (including `jsx-a11y`)
- `pnpm --filter web build` -- expected: build succeeds, `/student/results` appears in the route list
- `npx prettier --check` on every changed file -- expected: clean
- `pnpm e2e` -- expected: `bottom-nav.spec.ts` passes with the extended Student Mode case and every other spec's result is unchanged
- `grep -rn "sort(\|reverse(\|toSorted\|submittedAt" apps/web/src/app/student/results apps/web/src/lib/student-results.ts` -- expected: no match outside the spec asserting their absence
- `git diff --stat apps/web/src/app/student/_components/PracticeTestRow.tsx apps/web/src/app/student/_components/PracticeTestList.tsx apps/web/src/lib/parent-api.ts apps/api` -- expected: empty

**Manual checks (if no CLI):**
- At 390×844 and 1280×800, light and dark: the Results screen shows only finished tests, newest first, the current tab reads as current with colour removed, nothing sits under the bar, and Home's list is byte-for-byte the screen it was.

## Auto Run Result

**Summary:** Follow-up review pass over the already-implemented Story 10.5 (`/student/results` route, three-tab bar, Home link). No code changes this pass — four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) re-ran against the committed diff (`80679891a31c97bae0bcac81eef95992eb164ede`..`08a59a9`); every finding was triaged `reject`.

**Files changed:** none this pass.

**Review findings breakdown:** patch 0, defer 0, reject 18 (medium 1, low 17) — control-order cosmetics, test-coverage nitpicks on new code, and out-of-scope additions (metadata exports, fixture robustness), plus one restatement of the already-logged `deferred` item on source-text-only pinning of the page's runtime behaviour.

**Follow-up review recommendation:** `false` (no patched findings this pass; score 0).

**Verification performed:** No code changed, so the full command suite from `## Verification` was not re-run; the prior pass's green run stands. Working tree re-checked: clean aside from this spec file and the orchestrator-owned `deferred-work.md` / `sprint-status.yaml`.

**Residual risks:** Unchanged from the `deferred` list in frontmatter — most notably that the Results page's runtime behaviour (stale-request guard, unbound-device routing, retry re-issue, silent run-read failure) is pinned only by source-text assertions in a DOM-less test environment.

