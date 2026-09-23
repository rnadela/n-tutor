---
title: 'Story 1.4: Student Mode ↔ Parent View Switching'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_revision: '6e9430dc678d6dc9db5bf51050452b28ca577770'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Web unit specs assert component source text with regexes instead of rendering and driving
      the component.
    evidence: |-
      apps/web/vitest.config.ts runs environment 'node' with no jsdom and no testing-library
      anywhere under apps/web/src, so BackToStudentMode.spec.tsx and student/page.spec.tsx pin
      behaviour as readFileSync + regex matches. They break on reformatting and pass on code that
      is structurally right but behaviourally wrong. Pre-existing repo-wide convention, not
      introduced here; fixing it means adding a jsdom test environment.
    location: >-
      apps/web/vitest.config.ts
    severity: medium
  - summary: >-
      GET /api/student/session sends no Cache-Control: no-store though it returns a named child's
      profile keyed only on a cookie.
    evidence: |-
      grep for Cache-Control across apps/api/src returns nothing: no route in the API sets it, so
      this is an API-wide gap rather than a student-route one. An intermediary or bfcache can
      re-serve the profile after the binding changed.
    location: >-
      apps/api/src/identity/student-mode.controller.ts
    severity: medium
  - summary: >-
      isFirst can be observed as true by two concurrent first-profile creates under read-committed
      isolation.
    evidence: |-
      StudentProfileService.create counts active profiles inside its own transaction; two
      simultaneous POST /api/parent/students can each see a count of 1 and each mint a binding,
      last response winning. Both bindings name a profile of the same account, so the consequence
      is a nondeterministic choice rather than a leak.
    location: >-
      apps/api/src/identity/student-profile.service.ts
    severity: low
  - summary: >-
      The API integration suite fails one shifting test per run when executed under full parallel
      load against the shared Postgres container.
    evidence: |-
      Reproduced on the pre-change tree (changes stashed): the baseline run failed
      parent-account.int-spec.ts's row-lock test, while the post-change run failed
      admin-auth.int-spec.ts. Every implicated spec passes when run alone. Pre-existing contention,
      not a regression from this story.
    location: >-
      apps/api/test
    severity: medium
  - summary: >-
      The exit's live-region announcement can go unheard: the component unmounts on navigation to
      /student before assistive tech has a chance to perceive it.
    evidence: |-
      BackToStudentMode.bindAndLeave calls setAnnounced(...) then router.replace('/student') in the
      same tick. That navigation leaves the /parent route group and unmounts the component — and its
      live region — along with it. No test renders the component to observe whether the announcement
      is perceived before the unmount; the existing spec only asserts on the component's source text.
    location: >-
      apps/web/src/app/parent/_components/BackToStudentMode.tsx
    severity: medium
  - summary: >-
      A profile archived between the deliberate exit's ownership check and the mint can leave the
      binding cookie briefly naming an already-archived profile.
    evidence: |-
      student-profile.controller.ts's bind() calls findSelectable(...) to validate the profile, then
      mintBinding(...) and setStudentModeCookie(...), with no re-check between them. A concurrent
      archive in that gap lets the 204 response set a cookie for a profile that is no longer
      selectable. Self-correcting: the next GET /api/student/session read finds the profile
      unselectable and refuses with the cookie cleared, the same outcome archiving-after-bind already
      produces.
    location: >-
      apps/api/src/identity/student-profile.controller.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** The product has a Parent View behind a PIN but no Student Mode at all: nothing binds the device to a Student Profile, `/` sends every visitor to sign-in, and "Back to Student Mode" — the control the UX says always exists in Parent View — has nowhere to go. Without the binding there is no default device state for a child, and the mode boundary the epic calls a real security boundary is unenforced because only one of the two modes exists.

**Approach:** Carry the mode in a credential, exactly as AD-13 requires. A second cookie — `student_mode`, httpOnly/Secure/SameSite=Strict, its own audience — names the Parent Account *and* the one Student Profile the device is bound to; it is minted when the account's first profile is created and re-minted by the deliberate exit from Parent View (prompting for the profile when more than one is active, defaulting to the last-bound). A `StudentModeGuard` reads the profile from that token and never from a parameter, and a new `/student` surface renders the bound child's home. Parent-scoped authority stays exactly where it is: the elevation bearer, which Student Mode never holds.

## Boundaries & Constraints

**Always:**
- The bound Student Profile is read from the `student_mode` token, never from a request parameter, query, body or path — every student-scoped route takes it from `request.student`.
- The token is minted server-side only. The web app never writes it, never reads it (httpOnly) and never restates its contents; the binding is observable solely through `GET /api/student/session`.
- Minting a binding requires a valid elevation bearer (the deliberate-exit path) or is a side effect of the elevation-guarded first-profile creation. There is no unelevated route that changes what the device is bound to.
- A binding whose profile is archived, deleted, no longer owned by the account, or whose account `sessionEpoch` has moved is refused as if no binding existed — the same claim-by-claim shape the other two guards use.
- `density.comfortable` and the 48px student tap-target floor come from tokens; no component restates a figure.
- Student Mode copy is second-person; Parent View copy names the child in the third person. Both live in copy modules, never as literals in components.
- An explicit "Back to Student Mode" control is present on every Parent View surface.

**Block If:**
- The intent would require a student-authored credential (a child signing in), or any student-scoped write beyond the binding itself.

**Never:**
- Never persist the binding, the bound profile id, or any profile name in `localStorage`, `sessionStorage` or a JS-readable cookie.
- Never implement the idle expiry, its clock, its refresh loop, or any timeout-driven fallback — that is Story 1.5. This story only makes the last-bound profile a durable fact that 1.5 can fall back to.
- Never build the uncommitted-input retention mechanism (Story 1.6), tier caps (Epic 9), or any test/upload/analytics surface (Epics 3–7).
- Never server-render parent-scoped data, and never let the student surface fetch a parent-scoped endpoint.
- Never change the elevation token's shape, TTL, ceiling, or the PIN cool-down rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First profile creation binds | Elevated parent with zero profiles; `POST /api/parent/students` | 201 with the profile, and a `student_mode` cookie is set naming that profile | No error expected |
| Second profile does not rebind | Elevated parent already bound to profile A; creates profile B | 201; the cookie still names A — binding changes only by the exit prompt | No error expected |
| Deliberate exit, one active profile | Elevated parent, one active profile; `POST /api/parent/student-mode` with its id | 204 and the cookie names it | No error expected |
| Deliberate exit, multi-profile choice | Elevated parent, profiles A and B; body names B | 204 and the cookie names B; a later read reports B as bound | No error expected |
| Bind to an archived profile | Elevated parent; body names an archived profile id | 404 with the not-found sentence; the existing cookie is untouched | Archived profiles are not bindable (they are hidden from Student Mode) |
| Bind to another account's profile | Elevated parent B; body names account A's profile | 404, never 403; nothing read into the response, no cookie change | A 403 would confirm the row exists |
| Bind without elevation | Session cookie only, no bearer | 401 with `elevated: false`; no cookie change | The elevation guard refuses before the handler |
| Student session read, bound | `student_mode` cookie only | 200 with the bound profile's id, display name and current Grade Level name | No error expected |
| Student session read, unbound | No `student_mode` cookie | 401 with the not-bound sentence and `bound: false` | The web routes to sign-in rather than to a broken Student Mode |
| Bound profile then archived | Bound to A; a parent archives A; student reads the session | 401 `bound: false` — archiving hides the profile from Student Mode | The stale cookie is cleared on the refusal |
| Student Mode reaches a parent route | `student_mode` cookie, no bearer, `GET /api/parent/students` | 401 with `elevated: false`; no profile data in the body | The mode boundary is server-side, on every parent route |
| Direct URL to a parent screen | Browser holding only `student_mode`; navigates to `/parent/students` | The PIN gate renders; no parent data is fetched or shown | The elevation context is empty on a fresh load |
| Sign-out clears the binding | Signed-in parent; `POST /api/auth/sign-out` | Both the session and the `student_mode` cookies are cleared | The device stops being attached to that account |
| Password reset invalidates it | Bound device; the account completes a password reset (epoch bumped) | The student session read is refused and the cookie cleared | Same stale-epoch rule the other two guards apply |

</intent-contract>

## Code Map

- `apps/api/src/identity/pin-policy.ts:36-44` -- the precedent for a credential's audience constant, TTL constant and one-message-per-rejection block. `student-mode-policy.ts` mirrors it exactly.
- `apps/api/src/identity/auth-policy.ts:44-58` -- `PARENT_SESSION_AUDIENCE`, `PARENT_SESSION_ISSUER`, `PARENT_SESSION_COOKIE`, `DEFAULT_PARENT_SESSION_TTL_SECONDS`. The student credential reuses the **issuer** and gets its own audience and cookie name; the issuer being shared is what makes the audience the discriminator.
- `apps/api/src/identity/parent-session.guard.ts:36-86` -- the guard shape to copy: cookie-only read, `verifyAsync` with audience+issuer, then claim-by-claim checks, then the `findSessionSubject` epoch check, then `request.<principal> = …`. The student guard adds one more lookup: the profile must still be active and still owned.
- `apps/api/src/identity/parent-elevation.guard.ts:28-45` -- `notElevated()`: the rejection body that carries a machine-readable flag (`elevated: false`) beside the message. The student guard's refusal carries `bound: false` in the same shape.
- `apps/api/src/identity/parent-session.cookie.ts` -- `baseOptions()` (httpOnly, `COOKIE_SECURE`, SameSite=Strict, path `/`), `setSessionCookie`, `clearSessionCookie`. `student-mode.cookie.ts` is the same file for the second cookie; do not generalise the existing one into a shared helper — two named cookies stated plainly beat one parameterised writer.
- `apps/api/src/identity/parent-auth.service.ts:85-101` -- `mintSession`: `signAsync` with subject/audience/issuer/expiresIn and the `epoch` claim. `StudentModeService.mintBinding` is this plus a `profile` claim.
- `apps/api/src/identity/parent-auth.controller.ts` -- where sign-out clears the session cookie; it must clear the student cookie in the same handler (`@Res({ passthrough: true })` is already the pattern there).
- `apps/api/src/identity/student-profile.service.ts:74-92` -- `list`/`listSelectable` and the "Grade Level is never copied, resolved on every read" rule; the student session read resolves the Grade Level the same way. Add `findSelectable(parentAccountId, id)` returning the view or `null`, and `countFor(parentAccountId)` (or have `create` report whether it was the first) so the controller knows when to bind.
- `apps/api/src/identity/student-profile.controller.ts:30-63` -- `@Controller('parent')` + class-level `@SkipThrottle({ login: true })` + `@UseGuards(ParentElevationGuard)`; `create` is the handler that gains the binding side effect, and the new `POST student-mode` route belongs on this controller.
- `apps/api/src/identity/identity.module.ts:29-50` -- registers controllers, providers and the `PARENT_JWT` alias; the new controller, service and guard register here. `StudentProfileService` is already exported.
- `apps/api/src/app-setup.ts` -- `cookie-parser` and credentialed CORS are already configured; the second cookie needs nothing new.
- `apps/api/test/harness.ts:224-250,340-368` -- `createGradeLevel`, `createStudentProfile`, `setPinFor`, `elevate`, `bearer`. Add a `studentCookie(response)` reader that pulls `student_mode` out of `set-cookie`, and a `bindDevice(h, bearerToken, profileId)` helper.
- `apps/api/test/parent-pin.int-spec.ts:1-45` -- the integration-spec shape (env before dynamic imports, `server()`, per-test reset) the new spec follows.
- `apps/web/src/lib/elevation.tsx` -- the in-memory-only elevation context and *why*; the student binding deliberately does the opposite and lives in an httpOnly cookie, so nothing here changes.
- `apps/web/src/app/parent/layout.tsx` -- `ParentThemeProvider` + `ElevationProvider` + the `density`-driven main box; the always-present "Back to Student Mode" control mounts here, inside the provider.
- `apps/web/src/app/parent/page.tsx:26-80,74-84` -- the elevation-gated page pattern (token from context, `router.replace('/parent/pin')` when absent, `requestId` staleness guard) and `onLeave()`, which today clears the token and goes to `/auth/signed-in`. Leaving now goes through the binding control instead.
- `apps/web/src/app/parent/pin/page.tsx:118-131` -- the one place elevation is minted; unchanged, but it is the "only path out of Student Mode" the AC names.
- `apps/web/src/lib/parent-api.ts:145-175,228-290` -- `call()` (credentials always included, `ParentApiError`, `NETWORK_STATUS`), `elevated(token)`, and the parent-scoped call block. Add `studentSession()` and `bindStudentMode(token, id)`; a `notBound` flag joins `notElevated` in `failureDetailFrom`.
- `apps/web/src/app/parent/students/page.tsx` -- the `endsParentView(cause)` convention (only the elevation guard's own refusal evicts to the PIN) and the live-region/real-control conventions the new screens follow.
- `apps/web/src/theme/tokens.ts:38-49` -- `density` is the **compact** set; add `comfortableDensity` (row 56, card 20, gap 16, section 32, tapTarget 48) beside it rather than renaming or refactoring the existing export.
- `apps/web/src/theme/theme.ts:153,172-176` -- `baseTheme` already carries the student accent (`primaryStudent`), so the student surface nests `baseTheme`; no new palette is created.
- `apps/web/src/app/page.tsx` -- today a server-side `redirect('/auth/sign-in')`. It becomes the device's front door: ask the API what this device is bound to, then go to `/student` or `/auth/sign-in`.
- `apps/web/src/copy/parent.ts:103-113,119-167` -- `parentView` and `students` copy blocks; the exit/bind strings join `parentView`. Student Mode gets its own module.
- `e2e/fixtures.ts:60-120`, `e2e/global-setup.ts:26-31` -- `uniqueParentEmail`, `createGradeLevelFixture`, `readStudentProfile`, and the TRUNCATE list (already naming `student_profile`; no schema change in this story means no new table to add).
- `e2e/tests/parent-students.spec.ts` -- the sign-up → PIN → Parent View → act flow to reuse verbatim as the new E2E's opening.
- `apps/api/src/generated/prisma/**` -- generated; never hand-edited.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/identity/student-mode-policy.ts` -- new: `STUDENT_MODE_AUDIENCE` (`student-mode`), `STUDENT_MODE_COOKIE` (`student_mode`), `STUDENT_MODE_TTL_SECONDS` (the device stays bound until it is rebound or the parent signs out; use the same 30-day cookie ceiling figure the session uses, referenced from `auth-policy.ts`, not re-typed), and `NOT_BOUND` (`'This device is not set up for a student yet.'`). Single source of every student-credential figure and message.
- `apps/api/src/identity/student-mode.cookie.ts` -- new: `setStudentModeCookie(res, token, ttlSeconds)` and `clearStudentModeCookie(res)`, with the same attribute block as `parent-session.cookie.ts` (httpOnly, `COOKIE_SECURE`, SameSite=Strict, path `/`).
- `apps/api/src/identity/student-mode.service.ts` -- new: `mintBinding({ parentAccountId, studentProfileId, sessionEpoch })` → `{ token, ttlSeconds }`, audience `student-mode`, issuer `PARENT_SESSION_ISSUER`, claims `sub` (account), `profile`, `epoch`; and `boundProfile(principal)` → the `StudentProfileView` resolved through `StudentProfileService`. No other method writes or reads the binding.
- `apps/api/src/identity/student-mode.guard.ts` -- new `StudentModeGuard`: cookie only, never `Authorization`; verify audience+issuer, then check `scope`, `sub`, `profile`, `epoch` claim by claim; refuse on a stale epoch; refuse when the profile is missing, archived, or not owned by `sub`. Its one rejection is a 401 carrying `{ message: NOT_BOUND, bound: false }`. Sets `request.student = { parentAccountId, studentProfileId }`.
- `apps/api/src/identity/student-mode.controller.ts` -- new `@Controller('student')`, `@SkipThrottle({ login: true })`, `@UseGuards(StudentModeGuard)`: `GET session` returns `{ profile: StudentProfileView }` for the bound profile only. On the guard's refusal the cookie is cleared, so a stale binding does not survive the first read that rejects it (do this in an exception filter or by clearing in the guard's response — state which in the code comment).
- `apps/api/src/identity/student-profile.service.ts` -- add `findSelectable(parentAccountId, id)` (active + owned, else `null`) and make `create` report whether the created profile was the account's first, so the controller can bind without a second count query racing it.
- `apps/api/src/identity/dto/student-mode.dto.ts` -- new `BindStudentModeDto`: `studentProfileId`, a required UUID.
- `apps/api/src/identity/student-profile.controller.ts` -- `create` now takes `@Res({ passthrough: true })` and sets the student cookie when the created profile is the account's first; add `POST student-mode` (204) taking `BindStudentModeDto`, validating through `findSelectable` (404 on archived/unknown/cross-account) and setting the cookie. Both routes stay elevation-guarded.
- `apps/api/src/identity/parent-auth.controller.ts` -- sign-out clears the student cookie alongside the session cookie: the device stops being attached to the account it was signed out of.
- `apps/api/src/identity/identity.module.ts` -- register `StudentModeController`, `StudentModeService`, `StudentModeGuard`.
- `apps/api/src/identity/student-mode-policy.spec.ts` -- unit-test that the student audience differs from both the session and elevation audiences, and that the TTL is the referenced constant rather than a second literal.
- `apps/api/test/harness.ts` -- add `studentCookieFrom(response)` (reads `student_mode` out of `set-cookie`, returns `null` when absent) and `bindDevice(h, bearerToken, profileId)`; add a claim-varying `studentTokenWithClaims` beside the elevation one so each guard check is observable.
- `apps/api/test/student-mode.int-spec.ts` -- new: every row of the I/O matrix over HTTP — first-creation bind, second creation not rebinding, the exit-bind happy path, archived / cross-account / unknown id → 404 with the cookie untouched, unelevated bind → 401 `elevated: false`, bound read, unbound read → 401 `bound: false`, archive-then-read → refusal with the cookie cleared, a `student_mode` cookie against `/api/parent/students` → 401, an elevation bearer presented to `GET /api/student/session` → still 401 (wrong audience at the wrong guard), sign-out clearing both cookies, and a bumped epoch refusing the binding.
- `apps/web/src/theme/tokens.ts` -- add `comfortableDensity` (rowHeight 56, cardPadding 20, gap 16, sectionMargin 32, tapTarget 48) with a comment naming it Student Mode's set; leave `density` (compact) untouched.
- `apps/web/src/copy/student.ts` -- new: Student Mode copy, second person — home title, a greeting naming the child, the "nothing here yet, practice tests arrive later" empty line, the `parent` control label ("Parent"), the not-bound line, loading and error lines. No exclamation marks, no figures.
- `apps/web/src/copy/parent.ts` -- extend `parentView`: `backToStudent` ("Back to Student Mode"), `chooseProfileTitle`, `chooseProfileIntro` (says the device will be handed to that child), `chooseProfileLabel`, `confirmExit`, `exiting`, `noProfiles` (there is no profile to hand the device to yet) and `boundTo(name)`. Third person, by name.
- `apps/web/src/lib/parent-api.ts` -- add `studentSession()` (no bearer; the cookie carries it) and `bindStudentMode(token, studentProfileId)`; extend `failureDetailFrom` and `ParentApiError` with `notBound` so the student surface can tell "not set up" from any other 401. Export `StudentSession`.
- `apps/web/src/app/student/layout.tsx` + `apps/web/src/app/student/_components/StudentThemeProvider.tsx` -- new route group: `baseTheme` (already the student accent) nested as the other groups do, `comfortableDensity` spacing, no elevation provider — Student Mode never holds a parent credential.
- `apps/web/src/app/student/page.tsx` -- new: reads `GET /api/student/session`, renders the bound child's name and Grade Level in the second person, states that practice tests appear here later, and offers one control — "Parent" — which is a client-side link to `/parent/pin`. A `notBound` refusal routes to `/auth/sign-in`; any other failure renders the error with Retry (the `endsParentView` convention's student-side twin). Tap targets at `comfortableDensity.tapTarget`.
- `apps/web/src/app/page.tsx` -- becomes the device front door: a client page that calls `studentSession()` and `router.replace`s to `/student` when bound, `/auth/sign-in` when not. It renders a status line while deciding, never parent data.
- `apps/web/src/app/parent/_components/BackToStudentMode.tsx` -- new client component mounted in the parent layout, rendered only when elevation is held: loads `selectableStudents` on open; with exactly one active profile it binds straight to it; with more than one it opens a dialog listing them, preselecting the currently bound profile (from `studentSession()`, falling back to the first) — a real radio group, labelled, focus-managed; with none it states `noProfiles` and offers only sign-out-less cancellation. On confirm: `bindStudentMode`, `clearElevation()`, `router.replace('/student')`. Announces the outcome through a live region using the displayed copy.
- `apps/web/src/app/parent/layout.tsx` -- mount `BackToStudentMode` above `{children}` so it exists on every Parent View surface.
- `apps/web/src/app/parent/page.tsx` -- drop the local `leave` button's `/auth/signed-in` exit in favour of the shared control, keeping the staleness guard intact.
- `apps/web/src/app/parent/_components/BackToStudentMode.spec.tsx` -- unit-test: one active profile binds without a dialog; two open a dialog defaulting to the bound one; a superseded response is a no-op; the dialog's copy names the child being handed the device.
- `apps/web/src/app/student/page.spec.tsx` -- unit-test: a `notBound` refusal routes to sign-in; a network failure renders Retry rather than routing; the greeting is second-person and names the bound child.
- `e2e/fixtures.ts` -- no new fixture: the binding lives only in an httpOnly cookie, so the E2E asserts it through the browser's own cookie jar and the rendered Student Mode screen rather than through a database read.
- `e2e/tests/student-mode.spec.ts` -- new: sign up → set PIN → Parent View → create the first profile → Student Mode is now reachable and names that child; create a second profile → "Back to Student Mode" prompts and the chosen child is the one Student Mode shows; from Student Mode, `/parent/students` by direct URL lands on the PIN gate with no profile data on screen; the PIN control is the only route back; reloading Student Mode keeps the child bound; signing out drops the device back to sign-in.

**Acceptance Criteria:**

- Given a Parent Account with no Student Profiles, when the parent creates the first one, then the device is bound to it without any further action, and a second creation leaves the binding on the first.
- Given a device bound to a Student Profile, when the browser is restarted (a full reload with the in-memory elevation lost), then the device opens in Student Mode on that same profile and no Parent View surface renders parent data.
- Given a Parent Account with more than one active Student Profile and a parent in Parent View, when they deliberately leave through "Back to Student Mode", then they are asked which profile the device binds to, with the currently bound one preselected, and the chosen profile is what Student Mode shows and what a later read reports as bound.
- Given a device in Student Mode, when any `/api/parent/*` route is called with only the student credential, then every one of them is refused with `elevated: false` and no profile, account or taxonomy data appears in the response body.
- Given a device in Student Mode, when `/parent`, `/parent/students` or `/parent/pin/change` is opened by direct URL, then the PIN gate is what renders, and the only control that leads out of Student Mode is the one that reaches it.
- Given a device bound to a profile, when that profile is archived by the parent, then the next student session read is refused as not bound and the stale cookie is cleared — an archived profile is not a Student Mode the device can sit in.
- Given a signed-in parent on a bound device, when they sign out, then both credentials are cleared and the device returns to sign-in rather than to a Student Mode belonging to an account it is no longer attached to.
- Given `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` and `pnpm run build && pnpm run e2e` at the repo root, when run on a clean tree, then all pass.

## Spec Change Log

- **Exit does not call `clearElevation()` before navigating.** The task line for
  `BackToStudentMode` said `bindStudentMode` → `clearElevation()` →
  `router.replace('/student')`. Clearing first makes every Parent View screen
  re-run its "no token" branch while still mounted, so its own
  `router.replace('/parent/pin')` races — and wins against — the exit the parent
  asked for (observed: the E2E landed on the PIN gate instead of Student Mode).
  The navigation leaves the `/parent` route group, which unmounts
  `ElevationProvider` and destroys the token unconditionally, so the credential
  still stops existing at the exit; only the explicit clear is dropped.
- **`e2e/tests/parent-pin.spec.ts` updated.** Four of its tests drove the
  now-removed "Leave Parent View" button. Three now end Parent View with a full
  load (`leaveParentView`), and the fourth asserts the new control's
  no-profile branch — leaving is handing the device to a child, and those
  accounts have none.
- **`parentCopy.parentView.leave` removed**, as the only control it named is gone.

## Review Triage Log

Review pass 1 — 11 findings, all applied.

1. Sign-in and sign-up now clear `student_mode` (a binding left by a previous
   account would still satisfy its own guard). Two integration tests added.
2. `isFirst` counts active profiles only, so a replacement after an archive
   binds. Test added.
3. The create path logs and keeps its 201 when minting fails; the
   account-missing branch is a 500 (`BINDING_FAILED`), not the profile's 404.
   Test added with the mint stubbed to reject.
4. `BackToStudentMode` adopts `endsParentView`: the elevation guard's refusal
   clears the token and goes to the PIN; other failures still render.
5. The no-profile branch got a real exit to `/auth/signed-in`. **Deviation:** it
   does not call `clearElevation()` first, for the race documented in the Change
   Log above — leaving the route group unmounts the provider, and clearing first
   made the Parent View screens' own PIN redirect win (reproduced in E2E).
6. The bind-failure alert renders inside `DialogContent` while the dialog is up.
7. `needsProfilePrompt` is now called rather than only exported.
8. A close is ignored while a bind is in flight.
9. The front door uses `deviceIsUnbound`; other failures render a retryable
   status. The setter-less `useState` is gone.
10. `boundProfile()` clears the cookie on its refusal, as the guard does.
11. Integration coverage added: non-UUID id → 400, a rebind replaces rather than
    adds a cookie, and `Max-Age`/`Path`/`Secure` asserted against the constants
    and `COOKIE_SECURE`. `student-profile.int-spec.ts`'s "every route" list also
    gained `POST /api/parent/student-mode`.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 4: (high 0, medium 3, low 1)
- reject: 14: (high 0, medium 4, low 10)
- addressed_findings:
  - `[medium]` `[patch]` The single-active-profile handover — one child, parent presses "Back to
    Student Mode" — was exercised by no test at any level (zero-profile lives in parent-pin.spec,
    two-profile in student-mode.spec). Added an E2E that drives it and asserts no dialog appears,
    the route is `/student`, that child is named, and the binding survives a reload.
  - `[low]` `[patch]` The always-present exit control was asserted only on `/parent`, though the AC
    says every Parent View surface. The new E2E asserts it on `/parent/students` too.
  - `[low]` `[patch]` `studentTokenFrom` was exported from `apps/api/test/harness.ts` and imported by
    no spec. Removed.
  - `[low]` `[patch]` The device front door (`apps/web/src/app/page.tsx`) had no staleness guard,
    unlike its `/student` sibling: a retried request could route or set error over a newer one.
    Added the same `requestId` guard, plus an `<h1>` (its own copy line, so the E2E cannot mistake
    the front door for Student Mode) — the page previously rendered only an alert.
  - `[low]` `[patch]` `BackToStudentMode.onConfirm` returned silently when the chosen id matched no
    profile (a list gone stale behind a concurrent archive): the confirm button did nothing at all.
    It now surfaces `exitFailed`.
  - `[low]` `[patch]` The `STUDENT_MODE_TTL_SECONDS` comment claimed the device stays bound until it
    is rebound or the parent signs out, while the constant is a hard expiry nothing renews. Comment
    corrected to state the ceiling; no sliding renewal added (out of scope, Story 1.5).

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 2: (high 0, medium 1, low 1)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[low]` `[patch]` `BackToStudentMode.bindAndLeave` returned silently when the elevation token
    was `null` (lost while the dialog was open): the confirm button looked dead, with none of the
    feedback the sibling "chosen id matches no profile" failure already gets. It now surfaces
    `exitFailed`, the same copy that branch uses.
  - `[low]` `[patch]` `apps/web/src/app/page.tsx` — the device front door — had no test file at all,
    unlike its `/student` and `BackToStudentMode` siblings, so its retryable-error branch for a
    non-unbound failure was unverified. Added `apps/web/src/app/page.spec.tsx` in the same
    source-text convention the sibling specs use.

Deferred (added to frontmatter `deferred`): the live-region announcement in `BackToStudentMode`
can be lost on the navigation to `/student` before assistive tech perceives it (medium); and a
profile archived in the gap between `findSelectable` and `mintBinding` in `bind()` can leave the
binding cookie briefly naming an already-archived profile, self-correcting on the next session
read (low).

Rejected as noise or already captured: the `isFirst`/concurrent-first-create race (already the
existing `deferred` entry); the source-text test convention across three spec files (already the
existing `deferred` entry naming two of them); a fragile call-count-based mock in one integration
test; the front door's behavior when a parent session exists but no binding does (matches the I/O
matrix's unbound-read row); the create path logging rather than surfacing a failed auto-bind
(matches the spec's own instruction and the prior triage pass); missing DTO edge-case tests for a
missing/extraneous body (covered by the global validation pipe); no TTL-boundary test (the TTL
choice was already reviewed and justified in the prior pass); the doubled profile lookup on
`/api/student/session` (documented, deliberate TOCTOU protection); the `parent-pin.spec.ts`
`leaveParentView` helper bypassing the UI (already logged in the Spec Change Log); no test for a
natural token expiry outside the three credential-clearing endpoints (the JWT's own expiry and the
matching cookie `Max-Age` already enforce this); `refuse(): never` called as a bare statement in
the guard (throws regardless — a style note, not a defect); and no test for a double-click rebind
(last-write-wins, both writes name a profile the caller chose).

## Design Notes

**Why a second cookie rather than reusing the session cookie.** The parent session answers *which account*; the binding answers *which child this device is handed to*. They have different lifetimes (a rebind must not re-mint identity), different audiences, and different guards — and AD-13 says the mode is carried in the token. Folding the profile into the session cookie would make every parent request carry a student claim and would make a rebind an identity operation. Two cookies, two audiences, two guards: the same separation AD-18 already draws between the session and the elevation credential.

**Why the binding is a cookie when elevation must not be.** They are opposite requirements, deliberately. Elevation must die on a reload, so it lives in memory. The binding must *survive* a restart — Student Mode is the device's default state — so it lives in an httpOnly cookie the page can neither read nor forge. Neither is web storage, and neither is readable by JS.

**Why a stale epoch refuses the binding.** Copying the rule from the other two guards costs one lookup and removes a question nobody should have to answer later ("does a password reset end Student Mode?"). A reset is account recovery; the answer is yes, and a guard that behaves like its two siblings cannot drift away from them.

**Why archiving un-binds.** Story 1.3 made archiving's whole observable effect "the profile leaves the list Student Mode may bind to". A device left sitting in an archived profile would make that statement false. Refusing at the guard, rather than sweeping bindings at archive time, keeps `StudentProfileService` the sole writer and needs no second write path.

**What "unreachable in Student Mode" can be anchored to today.** Upload, generation, release and Analytics do not exist yet, so the outermost surface that does exist is the parent API and the `/parent` screens. The ACs observe exactly that: every `/api/parent/*` route refuses the student credential, and every `/parent` URL entered directly renders the PIN gate. Each later epic's new parent surface inherits the same guard rather than re-deciding this.

## Verification

**Commands:**
- `docker compose up -d postgres` -- expected: healthy container
- `pnpm run typecheck` -- expected: clean
- `pnpm run lint` -- expected: clean, or the pre-existing "eslint not installed" gap unchanged (recorded in Story 1.1; not a regression to fix here)
- `pnpm run test` -- expected: all unit + integration specs pass, including `student-mode.int-spec.ts`, `student-mode-policy.spec.ts`, `BackToStudentMode.spec.tsx` and `student/page.spec.tsx`
- `pnpm run build` then `pnpm run e2e` -- expected: `student-mode.spec.ts` passes alongside the existing suites. `pnpm run e2e` does not go through turbo, so the build must run first or it tests a stale `apps/api/dist`.
- `pnpm prettier --write .` -- expected: no unformatted files remain

**Manual checks (if no CLI):**
- No schema change is expected in this story: `git status` after the run must show no new `apps/api/prisma/migrations/` directory.

## Auto Run Result

**Summary of implemented change:** Story 1.4 binds a device to a Student Profile through a second,
httpOnly `student_mode` cookie: minted on first-profile creation and re-minted by a deliberate
"Back to Student Mode" exit from Parent View. `StudentModeGuard` reads the bound profile from the
cookie only. A new `/student` surface renders the bound child's home in the second person, and the
device front door at `/` decides between it and sign-in without ever server-rendering parent data.
This pass is a follow-up review of that already-implemented and already-once-reviewed change: two
small patches were applied and two issues deferred; no spec or implementation defect was found.

**Files changed with one-line descriptions (this review pass):**
- `apps/web/src/app/parent/_components/BackToStudentMode.tsx` — a lost elevation token now surfaces `exitFailed` instead of silently no-opping the confirm button.
- `apps/web/src/app/page.spec.tsx` — new: covers the front door's retry-on-transient-failure branch, previously untested.

**Review findings breakdown:** patch 2 (low, low) — both applied; defer 2 (medium, low) — added to frontmatter `deferred`; reject 14 (noise or already captured by the existing `deferred` list, the Spec Change Log, or the prior triage pass).

**Follow-up review recommendation:** `false`. This pass's patched findings: 0 high, 0 medium, 2 low. Score: 3×0 + 1×2 = 2, below the 5 threshold.

**Verification performed:**
- `docker compose up -d postgres` — healthy container.
- `pnpm run typecheck` — clean.
- `pnpm run lint` — `eslint not installed`, the pre-existing gap from Story 1.1; not a regression.
- `pnpm run test` — 309 passed, 2 failed on the first run (`parent-pin.int-spec.ts`, two tests, both 404s from shared-container contention); re-ran that file alone and all 38 of its tests passed — the pre-existing shifting-test contention already recorded in `deferred`, not a regression.
- `pnpm run build && pnpm run e2e` — 41/41 passed, including `student-mode.spec.ts`'s six scenarios.
- `pnpm prettier --write .` — clean; reformatted `apps/web/src/app/page.spec.tsx`'s one long regex line.
- Manual: `git status` shows no new `apps/api/prisma/migrations/` directory.

**Residual risks:** the two deferred items (a live-region announcement that can be lost on
navigation; a narrow TOCTOU window in the deliberate-exit bind) are both low-consequence and
self-correcting or recoverable, recorded in frontmatter `deferred` for later attention. The
integration suite's shared-container contention (pre-existing, also deferred) means a from-scratch
`pnpm run test` run may need one retry.

