# Epic 8 Context: Retention & Deletion

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic makes the product's privacy promise real: photographs of a child's schoolwork do not linger, and a parent can remove what they choose to remove — completely. Page Images expire automatically 90 days after their Source Test was uploaded, with no user action; a parent can delete them earlier, delete a Student Profile and everything under it, or delete the Parent Account entirely. The hard part is not the delete button but the propagation: deletion must reach the stored bytes and the derived rows together, leave no orphaned files, and — for image deletion — leave every derived artifact (Extraction, Practice Tests, Attempts, Mastery) working and intact. Without this epic the system is an indefinite, unreachable store of children's data.

## Stories

- Story 8.1: Automatic Page Image Expiry
- Story 8.2: Early Image Deletion
- Story 8.3: Student Profile Deletion
- Story 8.4: Parent Account Deletion

## Requirements & Constraints

**Page Image expiry (automatic and early are the same behavior)**
- Page Images are deleted 90 days after the upload of their Source Test, without any user action. Early parent-initiated deletion of a Source Test's Page Images behaves identically — one mechanism, two triggers.
- Deletion covers the **stored image bytes**, not merely a database reference. A partial deletion that leaves bytes on disk fails the requirement.
- The Source Test, its persisted Extraction, and every derived Practice Test, Attempt, Explanation, and Mastery value **survive intact**. Regeneration continues to work afterward because it reads the Extraction, never the images — so image loss costs the parent nothing functional.
- Surfaces showing a deleted Page Image must render a designed **expired state**, never a broken-image glyph, error color, or retry affordance. The Source Test row states the Page Image state as available, or deleted with the date.
- Early image deletion is the **one destructive action that does not require the account password**, precisely because derived data survives it unchanged. It still names what goes.

**Student Profile deletion**
- Removes that profile's Practice Tests, Attempts, Explanations, and Mastery. Explicitly **distinct from archiving**, which hides the profile from Student Mode and preserves history — the UI must make the two visibly different and say which is which.
- What survives is an anonymous usage record keyed only to Parent Account, period, call class, and count — enough to keep allowance counting honest, carrying no child data. Deletion therefore **never refunds allowance**, and delete-and-recreate must not become a path to unlimited free usage.
- A flagged Explanation belonging to the deleted profile leaves the Admin queue with it.

**Parent Account deletion**
- Removes the account, every Student Profile under it, and all Source Tests, Page Images, Extractions, Practice Tests, Attempts, Explanations, and Mastery — plus any retained uncommitted Parent View state still held server-side (captured pre-commit pages, their order, and classification).
- Erases **fully, including the anonymous usage records** that a Student Profile deletion leaves behind.
- Completes leaving no orphaned stored files.

**Confirmation and authorization (8.3, 8.4)**
- Every deletion requires an explicit confirmation that **names exactly what will be destroyed, by count and kind** ("this deletes Noah's profile, his 6 practice tests, every attempt, and his mastery data") and states that it cannot be undone. "Are you sure?" fails.
- Student Profile and Parent Account deletion require the **account password**, never the Parent PIN — the PIN gates a mode, not a destructive action.

## Technical Decisions

- **Deletion erases; it does not soft-delete or husk.** Rows are removed and files unlinked. Student Profile deletion collapses countable facts into the anonymous usage tombstone and hard-deletes everything else; Parent Account deletion removes tombstones too. Uncommitted-capture rows are removed outright and never leave a tombstone, because they never charged anything.
- **Cleanup is one sweeper over rows, never a scan over directories.** Every stored artifact carries an owner, a created timestamp, and a state; a Page Image row exists before any byte is written and its storage path is derived from the row identifier (never client-supplied). Orphan cleanup, 90-day retention, and parent-initiated deletion all go through this row-driven path.
- **Scheduled work runs as pg-boss schedules on the existing job queue** — the same mechanism as every other scheduled sweep, never a second ad-hoc scheduler and never `@nestjs/schedule`. The 90-day expiry and the uncommitted-state TTL sweep are schedules, not a new service. A second worker process must not cause duplicate work.
- The uncommitted-capture TTL sweep and the restorable-parent-state mechanism are **the same mechanism at two moments**: a row is restorable state until its TTL elapses and an orphan after it. Epic 8 deletion paths must reach that same row set rather than modelling a parallel one.
- Deletion is owned by the module that owns the entity cluster; other modules go through its service. Bytes and rows must come away **together** — treat partial deletion as a failure mode to test, not an acceptable outcome.
- Concurrency and lifecycle behavior here belongs in the real-Postgres integration tier: deletion that must not refund, the TTL sweep, and orphan cleanup are named test targets.

## UX & Interaction Patterns

- **Destructive-confirm dialog** is a defined component: title, body naming exactly what is destroyed, an account-password field for re-authentication, and a destructive confirm control. Destructive intent is carried by the **label text first, color second**; cancel is visually quieter but never below the tap-target floor.
- **Expired page thumbnail** is a flat neutral tile with the literal caption `Photo deleted`, in caption type — no broken image, no error color, no retry. This tile is the precedent other "designed removal" states in the product follow.
- Entry points: **Parent View → Settings → Data & deletion** (delete Page Images early, delete a Student Profile, delete the Parent Account); **Source Test detail** (Page Images in order, expired state, early deletion, regenerate); **Student Profile detail** (name, Grade Level, archive state, and delete — archive presented as *hides from Student Mode, keeps history* and visibly distinct from delete).
- Voice: plain complete sentences, facts only, no reassurance theater, no error codes.

## Cross-Story Dependencies

- **8.1 → 8.2:** early deletion must invoke 8.1's expiry path, not a parallel implementation; the two are required to be indistinguishable in outcome.
- **8.1 ← Extraction persistence (Epic 3):** expiry is only safe because the Extraction is persisted separately and regeneration reads it; verify regeneration after image deletion.
- **8.1/8.2 → capture and Source Test surfaces (Epic 3):** every surface that renders Page Images must handle the expired state.
- **8.3 ← Story 1.3 archiving:** deletion is defined against archiving; both must exist and be distinguishable in the same surface.
- **8.3/8.4 ← allowance model (Epic 9):** deletion must produce the anonymous usage tombstone and must not refund allowance; account deletion must also remove tombstones.
- **8.3/8.4 ← Epic 6 Admin flag queue:** flagged Explanations belonging to deleted profiles/accounts must leave the queue.
- **8.4 ← Story 1.6 uncommitted parent state:** account deletion must reach server-side uncommitted capture state, including pre-commit Page Images, which no other clock covers.
- **8.3/8.4 ← Story 1.1 account credentials:** password re-authentication uses the existing account password verification, not the PIN path.
- **All stories ← job scheduling infrastructure:** the 90-day expiry needs the pg-boss schedule mechanism in place; if it is not yet established, this epic establishes it as the single scheduler.
