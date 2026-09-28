---
title: 'Story 7.4: Analytics Dashboard'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: '1f06f95a508b6d57bcda1f7bb1dfdc69a794a7bf'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The trend's Attempt source reads every handed-in Attempt of a child before
      the window narrows it to five.
    evidence: |-
      `qualifyingScoresFor` calls `parentSubmittedRunsFor`, which loads every
      submitted Attempt for the profile and batch-resolves a Subject label for each
      across the module boundary, and only then filters retakes and slices to
      `MASTERY_ATTEMPT_WINDOW`. The work grows with how much a child has sat rather
      than with what the chart shows, and the label batch is discarded entirely.
      Fixing it needs a limited reader on `practicetest` — a new shape on another
      module's service, which this story has no basis to design alone. It is the
      same class of unbounded read Story 7.3 already deferred for `masteryFor`.
    location: >-
      apps/api/src/grading/grading.service.ts (qualifyingScoresFor)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Stories 7.1–7.3 canonicalize Topics, store per-Topic Mastery and classify Weak Areas, but nothing reads any of it: `masteryFor` has no caller but its int-spec, is deliberately unauthorized, and no parent surface exists at all — so the epic's whole parent-facing promise ("see *where* my child is weak") is unreachable, and the activity summary, score trend, dispute/flag digest and Explanation Allowance counter have no home.

**Approach:** One parent-scoped composition read behind PIN elevation — a new `analytics` module that fixes `masteryFor`'s signature to carry the parent scope, ranks Topics weakest-first, scores the profile's 5 most recent qualifying Attempts through `grading`'s one `scoreOf`, and joins the activity summary, awaiting-disputes and awaiting-flags counts and the account-level Explanation Allowance — plus the Parent View page that renders it: Mastery table with every figure carrying its own unanswered count, one dashboard-level sparkline stating its own scope, a digest band and a mechanism-stating empty state.

## Boundaries & Constraints

**Always:** Every read is scoped by `parentAccountId` in the same statement it reads with; a foreign or unknown profile answers an empty dashboard, never a 404 and never a 403 (AD-18). `masteryFor`'s signature is fixed here to take `ParentScope` — after this story no unauthorized Mastery read exists. The Weak Area verdict and the two figures come from `weak-area-policy.ts` only, never re-compared or re-stated anywhere else; the response carries the figures so the web restates neither. The score is `scoreOf`'s, over effective grade states (`effectiveStateOf`), so no second denominator exists (FR-37). The trend window is `MASTERY_ATTEMPT_WINDOW` and qualifying means `countsTowardMastery(ordinal)` — the same constants, per-profile scope, and each figure states its own scope on itself. Every Mastery figure travels with its unanswered count wherever it is rendered. Every analytics string is a function of the address (`resolveAddress('parent', profileName)`), never a fixed literal naming the child; grade-state labels stay the sole literal exception. The empty state states the mechanism and the progress toward it, names no Account Tier and carries no upsell.

**Block If:** nothing in this story requires a human decision.

**Never:** No drill-down, no missed-Question list and no "generate more on this" action — Story 7.5 owns those; a Mastery row's tap target may exist but must lead nowhere yet. No Admin curation surface (7.6). No new table, column or migration. No second Mastery formula, window, ranking or Weak Area comparison. No write of any kind: this story reads. No per-Topic trend line, no chart library added to `apps/web`, no fill, gradient or draw-in animation on the sparkline. No notification, no cost, tier, model name or grading rationale on any response (AD-20, AD-26). No change to `recomputeMastery` or to any grade-writing path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ranked table | One Topic at 40% weak, one at 90% healthy | `topics` weakest-first: the Weak Area first, `isWeakArea` true on it alone | No error expected |
| Rank with no fraction | A Topic whose window was all skipped (`value` null) | Sorted after every Topic carrying a fraction, never first | No error expected |
| Skipped count travels | 2 correct, 2 incorrect, 3 unanswered | Row carries `unanswered: 3`; the rendered row states the count beside the percentage | No error expected |
| Foreign profile | Elevated parent A asks for parent B's profile id | Empty dashboard: `topics: []`, zeroed activity and digest, allowance still account-level | 200, never 404/403 |
| Trend excludes retakes | 3 first Attempts and 4 retakes submitted | `trend.points` holds the 3 first Attempts only, oldest-first | No error expected |
| Trend window caps | 8 qualifying Attempts | The 5 most recent by `submittedAt`, oldest-first | No error expected |
| Trend vs Mastery scope | A profile whose Mastery window and profile window select different Attempts | Both stated, each labelled with its own scope; no reconciliation attempted | No error expected |
| Activity summary | 5 released tests: 2 unstarted, 1 in progress, 2 completed | `{ released: 5, unstarted: 2, inProgress: 1, completed: 2 }` | No error expected |
| Digest counts | 2 disputes, one overridden; 3 flags, one disposed | `disputesAwaiting: 1`, `explanationFlagsAwaiting: 2` | No error expected |
| Unlimited allowance | Tier with no Explanation ceiling | `limit: null`; the counter states unlimited, not "0 left" | No error expected |
| Empty dashboard | Profile with no completed Attempts | `topics: []` and the page states the mechanism and progress, naming no tier and offering no upgrade | No error expected |
| Vanished Topic row | A `topic_mastery` row whose `Topic` was deleted | Row still returned with `topicName: null`; the row renders its fallback label rather than disappearing | No error expected |
| Not elevated | No/expired elevation token | 401 from `ParentElevationGuard`; the page returns the parent to the PIN | Guard's own response |

</intent-contract>

## Code Map

**API — what exists to reuse**

- `apps/api/src/grading/grading.service.ts:1262` `masteryFor(studentProfileId)` -> `TopicMasteryView[]` (`topicId`, `correct`, `incorrect`, `unanswered`, `answered`, `attemptsCounted`, `value`, `isWeakArea`), ordered `topicId asc`. Its doc block (`:1225-1261`) states that **this story fixes the signature** and owns the scope check; that block must be rewritten, not left contradicting the new signature. Only caller today: `apps/api/test/weak-area.int-spec.ts`.
- `apps/api/src/grading/grading.service.ts:895` `gradeDisputesFor(scope: ParentScope, studentProfileId)`, `:1004` `runHistoryFor(scope: StudentScope)` (the two-round-trip read + `effectiveStateOf` + `scoreOf` recipe to imitate for the trend), `:74-92` `GradingScope`/`ParentScope`.
- `apps/api/src/grading/grading-score.ts:50` `scoreOf(states)` -> `AttemptScore { correct, denominator, excludedUngraded }` — the only score there may be.
- `apps/api/src/grading/grading-override.ts` `effectiveStateOf(row)` — resolve before counting, as `runHistoryFor` does.
- `apps/api/src/grading/mastery.ts:36` `MASTERY_ATTEMPT_WINDOW = 5`; `apps/api/src/grading/mastery-eligibility.ts:55` `countsTowardMastery(ordinal)`.
- `apps/api/src/grading/weak-area-policy.ts:70` `weakAreaRuntime()` -> `{ ceilingPercent, answeredFloor }`, `:107` `answeredOf`, `:127` `isWeakArea`.
- `apps/api/src/grading/parent-results.ts` `GradeDisputeListEntry` — awaiting == `overriddenAt === null`.
- `apps/api/src/explanation/explanation.service.ts:1003` `studentFlagsFor(scope: ParentScope, studentProfileId)` -> `StudentFlagListEntry[]` (`:156`) — awaiting == `disposition === null`.
- `apps/api/src/allowance/allowance.service.ts:135` `consumptionFor(accountId, now?)` -> `{ resetAt, timezone, tier, allowances: { explanation: { used, limit: number | null } } }`; `limit: null` is unlimited. No controller exposes it yet.
- `apps/api/src/practicetest/practice-test.service.ts:1044` `releasedFor(parentAccountId, studentProfileId)` -> `PracticeTestReleasedSummary[]` (`:245`) with `state: StudentListState` (`practice-test-policy.ts:569` — `'NotStarted' | 'InProgress' | 'Completed'`); `:1448` `parentSubmittedRunsFor(parentAccountId, studentProfileId)` -> `ParentAttemptSummary[]` (`attemptId`, `practiceTestId`, `ordinal`, `submittedAt`, `questionCount`, `subjectName`), released-only, newest-first, parent-scoped — the trend's Attempt source.
- `apps/api/src/topics/topic.service.ts:106` `normalize(...)` — the only method; **no id -> name reader exists**. `topics` is the sole owner of `Topic` (AD-11/AD-17), so the reader is added there, not read through another module's Prisma.
- `apps/api/src/identity/parent-elevation.guard.ts` `ParentElevationGuard` / `ElevatedRequest` (`req.elevated!.parentAccountId`); `apps/api/src/identity/student-profile.service.ts:70` `list(parentAccountId)` (already exposed to the web as the profile picker's source).
- `apps/api/src/grading/parent-grade-disputes.controller.ts` — the exact controller shape to copy (`@Controller('parent')`, `@SkipThrottle({ login: true })`, `@UseGuards(ParentElevationGuard)`, `ParseUUIDPipe`, AD-18 empty answer).
- `apps/api/src/grading/grading.module.ts` / `apps/api/src/app.module.ts:1-60` — module registration and the boot-time policy-resolve convention.
- `apps/api/prisma/schema.prisma` `model TopicMastery` (has `studentProfile` relation — the scope filter's join), `model Topic` (`name`, `subjectId`, `provisional`), `model Subject` (`name`). Read-only here.
- `apps/api/test/harness.ts:50-123` (`app`, `prisma`, `grading`, `topics`, `allowance`, `students`), `apps/api/test/weak-area.int-spec.ts`, `apps/api/test/mastery.int-spec.ts` — the graded-hand-in fixture recipe; `apps/api/test/grade-dispute.int-spec.ts` — the supertest-through-`harness.app` route recipe with an elevation token.

**Web — what exists to reuse**

- `apps/web/src/app/parent/grade-disputes/page.tsx` — the page skeleton to imitate whole: two staged reads (profiles, then the dependent read), `requestId`/`applyIfCurrent` staleness guard, `endsParentView(cause)` -> PIN, inline `<TextField select>` child picker (`:256-268`) defaulting to `found[0]?.id`, Retry `attempt` counter, `cause.reason` preferred over generic copy, `loaded` flags gating empty/loading/error. Its `page.spec.tsx` is the test convention: `environment: 'node'`, no render — `readFileSync` the source, strip comments, assert substrings/regex counts.
- `apps/web/src/lib/parent-view.ts` `applyIfCurrent`, `endsParentView`, `readableInstant`; `apps/web/src/lib/elevation.tsx:82` `useElevation()`.
- `apps/web/src/lib/parent-api.ts:864` `API_BASE`, `:869` `ParentApiError`, `:995` `call<T>`, `:1046` `parentApi`, `:2020` `gradeDisputes(token, studentProfileId)` (the method shape), `:2054` `elevated(token)`.
- `apps/web/src/components/Address.tsx:49` `resolveAddress(surface, rawSubject)`, `:65` `AddressProvider`, `:87` `useAddress`, `:99` `Addressed` — Parent View is third person by name.
- `apps/web/src/components/GradeStateMarker.tsx:31` — the five-carrier marker pattern (frame/border/glyph/rule/color, every non-color carrier mirrored as a `data-*` attribute, glyph `aria-hidden`, label real text) to copy for the Weak Area marker. `grep -rn "weak" apps/web/src` confirms **no Weak Area marker exists**.
- `apps/web/src/theme/tokens.ts:25` `colorTokens.warning`, `:67` `density`, `:249` `typeRoles.dashboardBody` (declared for this feature, no consumer yet), `:256` `typeRoles.tableCell` (`tabular: true`); `apps/web/src/theme/theme.ts:212/223` `MuiTableCell` / `MuiTableRow` density overrides.
- `apps/web/src/app/parent/students/page.tsx:240+` — the MUI `Table` (`size="small"`, `aria-label`) convention. **No chart library is installed** (`apps/web/package.json`) — the sparkline is hand-built inline `<svg>`.
- `apps/web/src/components/Screen.tsx:11-12` — names "Take Test and Analytics" as the two deliberate exceptions to its single-column-at-every-width rule; breakpoints are `sx` keys (`app/student/tests/[practiceTestId]/page.tsx:1147,1177`), never `useMediaQuery`.
- `apps/web/src/lib/consumption-format.ts:25` `dateOnly(iso, timezone)`, `:38` `limitLabel(limit)` — the allowance counter's formatters, account-timezone based.
- `apps/web/src/copy/parent.ts` — `parentCopy` namespaces, parameterized copy as arrow functions; `apps/web/src/app/parent/page.tsx` — the Parent View link list the dashboard is reached from.
- `e2e/tests/parent-explanation-review.spec.ts`, `e2e/fixtures.ts` (`createGradeLevelFixture`, `createSubjectFixture`, `uniqueParentEmail`) — the Playwright journey recipe.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/topics/topic.service.ts` -- add `describe(topicIds: readonly string[]): Promise<Map<string, TopicDescription>>` (`TopicDescription = { topicId, name, subjectId, subjectName, provisional }`), one `topic.findMany` with the Subject's name selected through the relation, empty input short-circuiting to an empty map -- `topics` owns `Topic` (AD-17), so the dashboard's names come from a reader here rather than another module reaching for the delegate.
- `apps/api/src/grading/grading.service.ts` -- change `masteryFor` to `masteryFor(scope: ParentScope): Promise<TopicMasteryView[]>` filtering `where: { studentProfileId: scope.studentProfileId, studentProfile: { parentAccountId: scope.parentAccountId } }`, and rewrite its doc block so the "deliberately unauthorized / Story 7.4 owns the check" passage is replaced by what is now true; add `qualifyingScoresFor(scope: ParentScope): Promise<AttemptScorePoint[]>` (`{ attemptId, submittedAt, score: AttemptScore }`) — `parentSubmittedRunsFor`, keep `countsTowardMastery(ordinal)`, take the newest `MASTERY_ATTEMPT_WINDOW`, one `questionGrade.findMany` over those ids selecting `attemptId`/`state`/`overrideState` only, `effectiveStateOf` then `scoreOf`, returned oldest-first -- the trend is a score, and a score is `grading`'s to compute once.
- `apps/api/src/analytics/analytics-view.ts` -- new: the response interfaces (`MasteryTopicView`, `TrendPointView`, `ActivitySummaryView`, `DigestView`, `ExplanationAllowanceView`, `ProfileAnalyticsView`) and the pure assembly functions — `rankTopics(rows)` (Weak Areas first; within a group ascending `value` with `null` last; ties by `answered` desc, then `topicName` asc, then `topicId` asc), `activityOf(released)` and `countAwaiting` helpers -- ranking is behaviour, so it is assertable with no database.
- `apps/api/src/analytics/analytics.service.ts` -- new: `profileAnalyticsFor(parentAccountId, studentProfileId): Promise<ProfileAnalyticsView>` composing the five parent-scoped reads plus `TopicService.describe` and `weakAreaRuntime()`, and assembling through `analytics-view.ts` -- one composition in one place so no surface assembles a second dashboard.
- `apps/api/src/analytics/parent-analytics.controller.ts` -- new: `GET parent/students/:studentProfileId/analytics` with `@UseGuards(ParentElevationGuard)`, `@SkipThrottle({ login: true })` and `ParseUUIDPipe`, copying `ParentGradeDisputesController`'s shape and its AD-18 answer -- the dashboard is one read, so it is one route.
- `apps/api/src/analytics/analytics.module.ts` -- new: imports `JwtModule` (parent secret), `IdentityModule`, `GradingModule`, `PracticeTestModule`, `ExplanationModule`, `AllowanceModule`, `TopicsModule`; provides `AnalyticsService` + `ParentElevationGuard` -- a composition module, so the arrows point out of it and no existing module gains one.
- `apps/api/src/app.module.ts` -- register `AnalyticsModule` -- a module absent from the list is a module whose boot never fails.
- `apps/api/src/analytics/analytics-view.spec.ts` -- new: every ranking rule including `value: null` placement and each tie-break, plus the activity and awaiting-count tallies from the I/O matrix.
- `apps/api/test/analytics.int-spec.ts` -- new: drive a real graded hand-in (the `weak-area.int-spec.ts` recipe), then assert through `harness.app` with an elevation token — ranked topics with names and unanswered counts, the retake-excluded 5-point trend oldest-first, the activity tally, both awaiting counts, the account-level allowance (including the unlimited case), the empty dashboard for a profile with no history, and that a **foreign** profile id answers an empty dashboard rather than another parent's figures.
- `apps/api/test/weak-area.int-spec.ts` -- update the `masteryFor` calls to the new scope argument and add a case proving a foreign `parentAccountId` reads `[]` -- the signature change is what closes the IDOR 7.3 left open.
- `apps/web/src/lib/parent-api.ts` -- add the view interfaces mirroring the API's and `profileAnalytics: (token, studentProfileId) => call<ProfileAnalyticsView>(...)` -- the one place the web knows the route.
- `apps/web/src/copy/parent.ts` -- add a `parentCopy.analytics` namespace: title, the activity-summary sentence, the trend's own scope statement, the Mastery figure's sentence taking the unanswered count, the Weak Area label, the Subject-filter heading when narrowed, the digest's three lines, the allowance counter (account-level wording, unlimited case, reset date) and the empty state as a function of the answered floor and the progress -- every string describing student work is a function, never a literal (UX-DR31).
- `apps/web/src/lib/analytics-view.ts` -- new pure module: `subjectOptions(topics)`, `filterBySubject(topics, subjectId | null)`, `masteryPercent(value)` (null-safe), `emptyStateProgress(topics, answeredFloor)` -- the presentation rules tested without a DOM.
- `apps/web/src/lib/sparkline.ts` -- new pure module: `sparklineGeometry(points, box)` -> polyline coordinates, one marker per point, and the endpoint's printed value; stable for one point and for a flat series -- geometry is arithmetic and belongs in a spec, not a render.
- `apps/web/src/components/WeakAreaMarker.tsx` -- new: triangle frame, exclamation glyph (`aria-hidden`), the literal words "Weak Area", warning color, every non-color carrier mirrored as a `data-*` attribute, copying `GradeStateMarker`'s pattern -- 7.5 reuses this, so it is shared from the start.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.tsx` -- new: MUI `Table`, one row per Topic in the order the API returned, Topic name, percentage in tabular figures, inline bar (warning fill on a Weak Area), answered count, and the unanswered count wherever any exist; phone stacks the sub-line, tablet (`sx` breakpoint keys) promotes answered / unanswered / Weak Area to columns at the same row density -- a bare percentage is explicitly rejected.
- `apps/web/src/app/parent/analytics/_components/TrendSparkline.tsx` -- new: inline `<svg>` from `sparklineGeometry`, a visible marker per plotted Attempt, endpoint value in tabular figures, its window and per-profile scope stated with the chart, no fill, gradient or animation, and an accessible text equivalent -- one dashboard-level trend and no per-Topic lines.
- `apps/web/src/app/parent/analytics/page.tsx` -- new: the grade-disputes skeleton (staged reads, `applyIfCurrent`, `endsParentView`, Retry) with the profile picker, an `AddressProvider surface="parent"` around the content, the Subject filter, activity summary, sparkline, Mastery table, the digest band (disputes and flags each linking to their existing screen, the allowance counter stated as account-level) and the empty state -- one page, reachable only from Parent View.
- `apps/web/src/app/parent/page.tsx` -- add the dashboard link beside its neighbours, client-side as they are, with the comment convention they carry -- a dashboard a parent cannot reach is a dashboard that did not ship.
- `apps/web/src/app/parent/analytics/page.spec.tsx`, `.../_components/MasteryTable.spec.tsx`, `.../_components/TrendSparkline.spec.tsx`, `apps/web/src/components/WeakAreaMarker.spec.tsx`, `apps/web/src/lib/analytics-view.spec.ts`, `apps/web/src/lib/sparkline.spec.ts`, `apps/web/src/lib/parent-api.spec.ts` (extend) -- source-assertion specs in the house style for the pages/components, real behaviour specs for the pure modules.
- `e2e/tests/parent-analytics.spec.ts` -- new: sign up, set a PIN, create a profile, enter Parent View, reach the dashboard from the Parent View list, and assert the empty state states the mechanism and the progress, names no Account Tier, offers no upgrade, and that the profile switcher is present -- the device claims (reachability behind the PIN, what a parent with no history actually reads) live nowhere else.

**Acceptance Criteria:**

- Given an elevated parent and a profile of another account, when `GET parent/students/:id/analytics` is called with that id, then the response is 200 with an empty dashboard and no figure of the other child, and `grep -n "masteryFor" apps/api/src` shows no call that passes a bare profile id.
- Given the dashboard response, when the Mastery table renders a Topic with unanswered Questions, then the rendered row states the unanswered count beside the percentage, and no rendered Mastery figure anywhere on the page appears without it.
- Given `grep -rln "WEAK_AREA_MASTERY_CEILING_PERCENT\|WEAK_AREA_ANSWERED_FLOOR" apps/api/src` and `grep -rn "0\.6\|60" apps/web/src/lib/analytics-view.ts`, when they run, then only `apps/api/src/grading/weak-area-policy.ts` states either figure and the web states neither — both arrive on the response.
- Given the sparkline and the Mastery table on one page, when both are read, then each states its own window and scope on itself, the sparkline is the only trend on the page, and nothing labels it a record of everything the student did.
- Given a profile with no completed Attempts, when the dashboard loads, then it states the mechanism and the progress toward it, and `grep -riE "tier|upgrade|free plan" apps/web/src/app/parent/analytics apps/web/src/lib/analytics-view.ts` plus the `analytics` namespace of `apps/web/src/copy/parent.ts` return nothing.
- Given `git diff --name-only`, when this story is complete, then no file under `apps/api/prisma` is listed, `recomputeMastery`'s body is unchanged, and no dependency was added to `apps/web/package.json`.

## Spec Change Log

- **`masteryFor` / `qualifyingScoresFor` take `(scope: ParentScope, studentProfileId: string)`, not `(scope: ParentScope)`.** The spec's signature and its own `where` clause contradict each other: `ParentScope` is defined at `grading.service.ts:104` as `{ parentAccountId }` alone and deliberately carries no child's id ("a type that *could* carry a child's id would be a type inviting a student route to call it"), so `scope.studentProfileId` does not exist on it. Implemented in the shape the spec's own model, `gradeDisputesFor(scope: ParentScope, studentProfileId)`, already uses. Behaviour is identical and the acceptance criterion holds: no caller passes a bare profile id.
- **"Vanished Topic row" is unit-specced, not int-specced.** `TopicMastery.topicId` is `onDelete: Cascade` (`schema.prisma:1755`), so deleting a `Topic` takes its Mastery row with it — the matrix row cannot be staged through the database. The `topicName: null` path is real (the name lookup is a second statement after the Mastery read, so a Topic deleted between the two comes back unnamed rather than dropping the figure) and is asserted in `analytics-view.spec.ts`; the int-spec asserts the stageable half, that `TopicService.describe` omits an id it cannot find.

## Review Triage Log

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 0, medium 5, low 8)
- defer: 1: (high 0, medium 1, low 0)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The empty state's progress branch was unreachable — `emptyStateProgress` was fed the (always empty) topic rows, so a child who had finished work but had no Mastery rows was told no test had been finished. It now takes the activity counts off the response, and both sentences are reachable and true.
  - `[medium]` `[patch]` The Mastery table's phone layout used `display: { xs: 'none' }` on its header cells, removing them from the accessibility tree while claiming to keep them — replaced with a visually-hidden treatment, with the phone sub-line marked `aria-hidden` so nothing is announced twice.
  - `[medium]` `[patch]` The Mastery figures stated no window or scope of their own while the sparkline did — a table-level and a per-row scope sentence were added through copy functions, saying explicitly that it is not the chart's window.
  - `[medium]` `[patch]` The page mutated the staleness guard's ref during render — the write now happens only inside the read effect.
  - `[medium]` `[patch]` Nothing rendered the three new components: real `renderToStaticMarkup` specs were added for `WeakAreaMarker`, `MasteryTable` and `TrendSparkline`, following `GradeStateMarker.spec.tsx`'s precedent.
  - `[low]` `[patch]` A Retry that dropped the selected profile from the list left the dashboard blank with no message — the selection is kept when still present, else falls back to the first.
  - `[low]` `[patch]` `activityOf` counted any unknown `StudentListState` as finished — now an exhaustive switch with a `never` default, pinned by unit cases.
  - `[low]` `[patch]` `qualifyingScoresFor`'s grade read was scoped only by Attempt id — the account now travels in the same `where` through the Attempt relation.
  - `[low]` `[patch]` `sparklineGeometry` had no guard for a degenerate box, which inverted the span and put markers outside the viewBox.
  - `[low]` `[patch]` The sparkline carried a redundant `role`, distorted below its nominal width, and recomputed an endpoint the geometry already supplied.
  - `[low]` `[patch]` The chart's text equivalent labelled points by position index and never stated `excludedUngraded` — points are now dated and the excluded count is stated where non-zero.
  - `[low]` `[patch]` Three assertions could not fail for the reason they claimed (a tunable pattern that never matches, a bare `60` and a bare `value` matching unrelated text, and a copy rule asserted against a component holding no prose).
  - `[low]` `[patch]` Three integration gaps closed: the override now provably moves a trend point, a sibling's disputes and flags are proved excluded from the digest, and the read is proved to make no provider call.

Reject notes: the `masteryFor(scope, studentProfileId)` shape (the spec's literal one-parameter form does not compile, since `ParentScope` carries no child id, and the implemented shape is the one `gradeDisputesFor` already uses); inlining `countAwaiting`; a claimed shared error slot between the two reads (they are separate state); `dateOnly` throwing on a malformed timezone (the zone is the server's own account record); pagination of the Mastery table (the same unbounded read Story 7.3 already deferred, not something this story introduced); and a `display:none` render assertion that MUI's own emitted stylesheet makes unfalsifiable.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 11
- addressed_findings:
  - `[medium]` `[patch]` A failed profiles read left `error` set forever once Retry then answered zero profiles — the dashboard effect that clears `error` never runs when `studentProfileId` stays `''`. The profiles-read success handler now clears `error` itself.
  - `[low]` `[patch]` Retry alone (no student switch) re-ran the dashboard effect on its `attempt` dependency and reset `subjectChoice` to "every subject" every time, discarding a parent's chosen filter for no reason tied to the student changing. A ref now tracks which student the last read was issued for, and the filter resets only when that id actually changes.

Reject notes: digest links to `/parent/grade-disputes` and `/parent/explanation-flags` not carrying the selected student (neither route accepts a student query param today, and the intent states no linking requirement); `AnalyticsService.profileAnalyticsFor`'s `Promise.all` failing the whole read if one of six sources rejects (ordinary fail-fast behaviour, no partial-degrade requirement in the intent); `qualifyingScoresFor`'s account-only defense-in-depth `where` (the `attemptId`s it restates against are already narrowed to one profile's window before that clause runs, so the claimed gap needs an unrelated future rewrite to exist); `activityOf`'s `never`-default throwing on an unhandled `StudentListState` (documented, intentional exhaustiveness, not a missing guard); `TopicService.describe` reading `row.subject.name` unconditionally (`Topic.subjectId` is required and the `Subject` relation is `onDelete: Restrict`, so an orphaned Subject cannot occur); the "Vanished Topic row" case being unit- not integration-tested (the Spec Change Log already records this as deliberate — the row cannot be staged through the database because of `onDelete: Cascade`); the Mastery row's phone sub-line allegedly double-announcing its figures (it is `aria-hidden`, so a screen reader never reaches it — nothing is announced twice); a Mastery row missing `tabIndex`/`role` for Story 7.5 (the intent says a tap target "may exist," not must); the trend and Mastery table both stating the constant window size rather than the actual point/attempt count in their top-level scope sentences (an established, deliberate split in this diff: the top-level sentence states the *rule*, the per-row/per-point figures already state the actual count — `masteryRowScope`, `mastery-figure`); and a claim that no test exercises the `applyIfCurrent` staleness guard's actual race behaviour (`apps/web/src/app/parent/students/page.spec.tsx` already unit-tests `applyIfCurrent` itself, including the superseded-response case, per `parent-view.spec.ts`'s own doc comment — this page's source-assertion spec only needs to prove it is wired in correctly, matching this repo's established pattern for `environment: 'node'` screen specs).

## Design Notes

**Why a new `analytics` module rather than a route on `grading`.** The dashboard is a composition over five modules. Hanging it on `grading` would give that module new arrows to `explanation` and `allowance` for a read that is not about grades, and `grading` is the sole owner of `QuestionGrade` precisely so its edges stay narrow. A composition module points outward at everything and is pointed at by nothing, so no existing arrow changes and no cycle is possible.

**Why `masteryFor`'s signature changes here.** Its own doc block says this story fixes it and owns the scope check. A controller-side check plus an unauthorized method would leave the IDOR one careless caller away; folding `studentProfile: { parentAccountId }` into the same statement makes the scope part of the read, which is how every other read in the codebase is scoped.

**Why the trend is computed and not stored.** It is five scores over the profile's most recent qualifying Attempts — the same arithmetic `runHistoryFor` already does per test, at a different scope. Storing it would be a second window definition to keep in step with `recomputeMastery`'s.

**Why the response carries `weakArea: { ceilingPercent, answeredFloor }`.** The empty state has to say "Mastery appears once N questions are answered on a topic", and the only correct N is the one the API resolved at boot. Sending it keeps the web from restating a tunable figure that would silently drift the first time an operator changed it.

## Verification

**Commands:**
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm --filter api run typecheck` -- expected: clean.
- `pnpm --filter web run lint` -- expected: clean.
- `pnpm --filter web run typecheck` -- expected: clean.
- `pnpm --filter api exec vitest run src/analytics src/grading` -- expected: all pass.
- `pnpm --filter api exec vitest run test/analytics.int-spec.ts test/weak-area.int-spec.ts test/mastery.int-spec.ts` -- expected: all pass, 7.2's and 7.3's suites still green.
- `pnpm --filter web run test` -- expected: all pass.
- `pnpm exec playwright test e2e/tests/parent-analytics.spec.ts` -- expected: pass.

## Auto Run Result

**Summary:** Follow-up review pass (triggered by the prior pass's `followup_review_recommended: true`) over the story 7.4 diff since baseline. No code changes were needed for the feature itself; two small parent-analytics-page bugs surfaced by review were patched.

**Files changed this pass:**
- `apps/web/src/app/parent/analytics/page.tsx` — clear the stale profiles-read error once a Retry succeeds (even with zero profiles); stop Retry alone from discarding the Subject filter when the student hasn't changed.
- `_bmad-output/implementation-artifacts/spec-7-4-analytics-dashboard.md` — this pass's Review Triage Log entry and Auto Run Result.

**Review findings breakdown:** 2 patched (1 medium, 1 low), 0 deferred, 11 rejected (all reviewed against the actual code/schema and found to be either already handled by existing design, already recorded in `deferred`, or not supported by the intent-contract — see Review Triage Log reject notes above).

**Follow-up review recommendation:** `false`. Score: 1 medium × 3 + 1 low × 1 = 4 (< 5), no high-severity patch.

**Verification performed:**
- `pnpm --filter web run lint` — clean.
- `pnpm --filter web run typecheck` — clean.
- `pnpm --filter web run test` — 64 files, 1281 tests, all passed (includes updated `page.spec.tsx` assertions, unchanged).
- `pnpm exec playwright test e2e/tests/parent-analytics.spec.ts` — 1 passed.
- API lint/typecheck/vitest and the `pnpm --filter web run lint`'s equivalent for `apps/api` were not re-run: no file under `apps/api` changed in this pass.

**Residual risks:** None newly introduced. Pre-existing, already-deferred: the unbounded `parentSubmittedRunsFor` read behind the trend (recorded in `deferred` frontmatter) and the unpaginated Mastery table (recorded in the prior pass's reject notes) remain open, unchanged by this pass.
