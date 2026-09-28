---
title: 'Story 7.1: Topic Canonicalization'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: '96450325d333e23c59155469f095c024a5119f41'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The api integration suite is flaky as a whole run: a shifting set of 2 to 6 parent-scoped
      requests answer 404 or 401 for a parent the fixture had just created.
    evidence: |-
      Reproduced on master with this story's changes stashed: `pnpm --filter api run test` failed
      6 tests across test/explanation-suppression.int-spec.ts, test/grade-dispute.int-spec.ts and
      test/student-explanation-flag.int-spec.ts. Patched runs fail a different set each time,
      usually inside test/practice-test.int-spec.ts, and every affected file passes when run alone.
      The failures always land on a parent-scoped route immediately after a fixture created the
      parent, which is the signature of a truncate-based reset racing an in-flight request rather
      than of any one story's code.
    location: >-
      apps/api/test/harness.ts (resetParentAccounts / resetTaxonomy)
    severity: medium
  - summary: >-
      TopicService.cacheVectorFor's own database write failure (the vector-cache backfill
      onto a matched Topic) has no test forcing it, unlike AiService's parallel recordCall
      failure which does.
    evidence: |-
      Confirmed by a verification-gap review pass reading topic-normalization.int-spec.ts,
      ai.service.openai.spec.ts and the whole repo for `cacheVectorFor`/`topic.update`/
      `prismaThrows` references: only the success path is exercised. An attempt to add
      integration coverage by spying on `h.prisma.topic.update` (mirroring the
      `prismaThrows` pattern from ai.service.openai.spec.ts) left the mock unrestored
      after `mockRestore()`, corrupting a later, unrelated test in the same file
      ('declines stage 2 when every cached vector came from another snapshot') even
      inside a try/finally. The shared PrismaService instance has no seam for this kind
      of failure injection at the integration tier the way AiService's mockable client
      does, so the test was reverted rather than shipped in a state that destabilizes
      the suite.
    location: >-
      apps/api/src/topics/topic.service.ts (cacheVectorFor)
    severity: medium
  - summary: >-
      Two concurrent normalize() calls for the same concept under different labels that
      tokenize to different match keys (e.g. simultaneous first-time submissions of
      "Fraction Addition" and "Fractions Addition" before either has a cached vector) can
      both fall through to stage 3, both find no comparable candidate, and both mint
      separate provisional Topics for the same concept.
    evidence: |-
      Confirmed by reading normalize()'s cascade in topic.service.ts: the unique index on
      (subjectId, matchKey) only prevents two mints from landing on the *same* key (the
      "Mint races another mint" row already covered by the I/O matrix and its own test).
      A race between two different, never-before-seen labels for the same concept has no
      such guard — each computes its own matchKey, each misses stage 1, each has no
      comparable vector yet, and each proceeds to mint independently. This is inherent to
      the AD-11 three-stage design (no cross-request lock across the cascade) rather than
      a coding defect, and resolving it would need a broader dedup mechanism than this
      story's scope allows.
    location: >-
      apps/api/src/topics/topic.service.ts (normalize, mint)
    severity: medium
  - summary: >-
      No test exercises the Topic-to-Subject foreign key's ON DELETE RESTRICT behavior;
      a regression that weakened it to CASCADE (or removed it) would go unnoticed.
    evidence: |-
      apps/api/prisma/migration.sql and schema.prisma assert RESTRICT by comment, but
      topic-normalization.int-spec.ts never attempts to delete a Subject that owns
      canonical Topics to confirm the constraint actually blocks it.
    location: >-
      apps/api/prisma/migration.sql, apps/api/prisma/schema.prisma (Topic.subjectId FK)
    severity: low
  - summary: >-
      TopicService.offer()'s "no comparable vector" fallback ordering (newest-first via
      the createdAt tiebreak, when embedded is null) is never exercised past
      TOPIC_CANDIDATE_LIMIT candidates by any test — only the cosine-ranked branch is
      tested at that scale.
    evidence: |-
      topic-normalization.int-spec.ts's only over-the-cap test ("caps the stage-3
      candidate list and offers the strongest candidates first") gives every filler and
      the target Topic a real embedding, so embedded is never null in that test. The two
      tests that do produce embedded === null each use only 1-2 candidates, well under
      TOPIC_CANDIDATE_LIMIT, so the newest-first ordering never determines what gets
      dropped. A regression in that branch's tiebreak (e.g. reverting to oldest-first,
      the same class of bug the first review pass already fixed for the cosine-ranked
      branch) would ship undetected and could silently drop a Subject's newest Topics
      from the stage-3 offer, minting duplicates for concepts already present but
      excluded by the cap.
    location: >-
      apps/api/src/topics/topic.service.ts (offer)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Generation emits free-form Topic labels per Question (`practice_test_question_topic.label`), so one concept arrives spelled four ways and would fragment into four Mastery values as history grows — the slow rot that makes the Epic 7 dashboard useless. There is no canonical Topic set and no mapping from an emitted label to one.

**Approach:** Add a `Topic` canonical set scoped per Subject, and one `topics` module exposing a single interface — `normalize(label, subjectId, parentAccountId) -> canonical Topic id` — implementing the AD-11 three-stage cascade (exact match on a normalized key → cached-embedding cosine ≥ 0.85 compared in application code → one `TopicNormalization` structured-output call over the candidate list, the only stage that may mint). A minted Topic carries `provisional: true`. Generation is untouched.

## Boundaries & Constraints

**Always:**
- One public entry point: `normalize`. Stages are private; no caller may reach a stage, a vector, or a threshold.
- Canonical Topics are scoped by Subject only — never by Grade Level.
- `topics` is the sole writer of `topic`; it reads `Subject` read-only (AD-17).
- Vectors live in an ordinary Prisma column (`Json`), cosine computed in TypeScript.
- Every provider call goes through `AiService` (AD-9/AD-22 seam), call class `TopicNormalization`, prompt and Zod schema owned by `topics`.
- Stage 3 uses the Responses API with a `zodTextFormat` schema. Fencing of the label and of every candidate name, exactly as `explanation-prompt.ts` fences untrusted spans.
- Only stage 3 may conclude "none of these fit". The single exception, which must be commented as such: when the Subject's canonical set is empty there are no candidates, the answer is forced, and the Topic is minted without a call.
- Matching an existing Topic never changes its `provisional` flag or its name.
- No log line, error message, or cost row carries a provider string or model output (AD-20).

**Block If:** nothing — every decision here is settled by AD-11/AD-12 and the epic context.

**Never:**
- No pgvector: no `Unsupported(vector(...))`, no vector index, no `prisma-extension-pgvector`.
- No constraint on what generation emits; no change to `practice_test_question_topic`.
- No Mastery model, no Mastery computation, no recompute path (Story 7.2).
- No confirm / merge / rename, no admin route, no provisional queue surface (Story 7.6).
- No HTTP route, no DTO, no web app change in this story.
- No alias/label cache table, and no second matching path beside `normalize`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stage 1 hit | Subject has Topic `Long Division` (key `division long`); label `long  DIVISION!` | That Topic's id; zero provider calls | No error expected |
| Stage 2 hit | Topic `Fraction Addition` with cached vector; label `Fractions Addition` (different key, cosine ≥ 0.85) | That Topic's id; one embed call, no stage-3 call | No error expected |
| Stage 3 match | Candidates present, cosine below threshold, model names a candidate | The named candidate's id; nothing minted | Model names an id not in the candidate list → treat as no match and mint |
| Stage 3 mint | Candidates present, model answers "none fit" | New Topic, `provisional: true`, vector cached | No error expected |
| Empty canonical set | Subject has no Topic rows; any label | New provisional Topic; no embed call, no stage-3 call | No error expected |
| Idempotent repeat | Same label normalized twice | Same id both times; second call makes zero provider calls | No error expected |
| Label is only stopwords/punctuation | label `the of` | Key falls back to the normalized text rather than empty; mint/match on that | No error expected |
| Blank label | label `''` or whitespace | Refused before any provider call | Domain error, message constant, never retried |
| Unknown Subject | `subjectId` matches no row | Refused before any provider call | Domain error, message constant |
| Embedding call fails upstream | `AiService.embed` exhausts retries | Stage 2 is skipped, cascade falls through to stage 3 | Warn with call class only; normalize still returns an id |
| Mint races another mint | Two concurrent normalizes, same key + Subject | One row exists; both return its id | Catch unique-violation, re-read by `(subjectId, matchKey)` |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:1` -- `Subject` (id/nameKey/enabled, back-relation comment convention), `PracticeTestQuestionTopic` (free-form `label`, the upstream this maps from), `AiCall` + `AiCallClass` enum (already carries `TopicNormalization` — no enum change needed).
- `apps/api/prisma/migrations/` -- timestamped dirs, `migration.sql` each; newest `20260929120000_add_grade_dispute_and_override`.
- `apps/api/src/ai/ai-config.ts` -- `AI_CALL_CLASSES` already lists `TopicNormalization`; `DEFAULT_MODEL_PINS` pins it to `gpt-5.6-luna`; `ModelPin`, `envSuffixFor`, `positiveInt`, `costMicrosFor`, `resolveAiConfig` are the extension points for an embedding pin.
- `apps/api/src/ai/ai.service.ts` -- `run()` (Responses API + `zodTextFormat` + retry + `recordCall`), `AiUpstreamError`/`AiInputError`/`AiRejectedError`, `callFake`, `recordCall` (sole `ai_call` writer). `embed()` is added alongside `run()` and reuses the retry loop, `statusOf` classification, and `recordCall`.
- `apps/api/src/explanation/explanation-schema.ts` -- the schema + `fake…Payload` pairing to copy (strict-Structured-Outputs rules: nothing optional, no bounds).
- `apps/api/src/explanation/explanation-prompt.ts` -- `FENCE_OPEN`/`FENCE_CLOSE`, `fenced()` fencing convention for untrusted spans.
- `apps/api/src/explanation/explanation-policy.ts` -- message-constant + bounds file convention.
- `apps/api/src/app.module.ts` -- module registration list with per-module ownership comments.
- `apps/api/test/harness.ts:83` `createHarness`, `:246` `CapturedAiCall`/`captureAi` (wraps `ai.run`, `failNext`), `:424` `createSubject`, `resetTaxonomy` -- what the int-spec extends.
- `apps/api/test/*.int-spec.ts` -- integration tier (real Postgres, `fake` AI transport); `apps/api/src/**/*.spec.ts` -- unit tier. Both run under `vitest.config.ts`.
- `.env.example:116-130` -- per-call-class pin/price override block to extend.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `model Topic` (`id`, `subjectId`, `name`, `matchKey`, `provisional Boolean @default(true)`, `embedding Json?`, `embeddingModel String?`, timestamps, `subject` relation `onDelete: Restrict`, `@@unique([subjectId, matchKey])`, `@@index([subjectId, provisional])`, `@@map("topic")`) and the `topics Topic[]` back-relation on `Subject` with the ownership comment the other back-relations carry -- the canonical set AD-11 matches against.
- `apps/api/prisma/migrations/2026…_add_canonical_topic/migration.sql` -- hand-written migration for that table, its unique index and FK -- migrations are checked in, never generated at deploy.
- `apps/api/src/ai/ai-config.ts` -- add `DEFAULT_EMBEDDING_PIN` (`text-embedding-3-small`, input price only) and `embeddingPin` on `AiConfig`, resolved from `AI_MODEL_TOPIC_EMBEDDING` / `AI_PRICE_TOPIC_EMBEDDING_IN` -- the embedding model is a different snapshot from the stage-3 pin and must be recorded per row.
- `apps/api/src/ai/fake-embedding.ts` (+ `.spec.ts`) -- deterministic unit-length character-trigram vector, fixed dimension -- the `fake` transport must make *similar* labels genuinely similar so stage 2 is testable without a provider.
- `apps/api/src/ai/ai.service.ts` -- add `embed({ text, parentAccountId })` returning `number[]` and the model used: `client.embeddings.create` on the `openai` transport, `fakeEmbedding` on `fake`, through the existing retry/backoff and error classification, writing one `ai_call` row (class `TopicNormalization`, the embedding model, output tokens 0) -- keeps `ai` the only provider-call site and the only `ai_call` writer.
- `apps/api/src/topics/topic-match-key.ts` (+ `.spec.ts`) -- stage 1: lowercase, strip punctuation, collapse whitespace, drop stopwords, dedupe and sort tokens, with the all-stopwords fallback -- one key derivation, used for both lookup and insert.
- `apps/api/src/topics/topic-similarity.ts` (+ `.spec.ts`) -- cosine over two `number[]`, and best-candidate selection against the threshold, tolerating dimension mismatch and zero vectors -- stage 2 compares in application code.
- `apps/api/src/topics/topic-policy.ts` -- `TOPIC_SIMILARITY_THRESHOLD = 0.85`, stage-3 candidate cap, message constants, `TopicInputError` -- figures and strings stated once.
- `apps/api/src/topics/topic-resolution-schema.ts` -- Zod payload (a chosen candidate id or the explicit none-fit marker, no optionals, no bounds) + `TOPIC_RESOLUTION_SCHEMA_NAME` + `fakeTopicResolutionPayload` -- stage 3's wire contract and its fake answer.
- `apps/api/src/topics/topic-resolution-prompt.ts` -- the stage-3 prompt, label and every candidate name fenced -- labels are model-written text and must be data, not instruction.
- `apps/api/src/topics/topic.service.ts` -- `normalize`, the cascade, minting, unique-violation re-read; sole writer of `topic` -- the single AD-11 interface.
- `apps/api/src/topics/topics.module.ts`, `apps/api/src/app.module.ts` -- register the module with its ownership comment -- boot must fail, not drift, if it is missing.
- `apps/api/test/harness.ts` -- expose `topics: TopicService` and capture embed calls beside `captureAi`'s `run` capture -- the int-spec asserts *which* stages fired.
- `apps/api/test/topic-normalization.int-spec.ts` -- cover every I/O & Edge-Case Matrix row against real Postgres and the `fake` transport, asserting provider-call counts and `provisional` state -- the matrix is the contract.
- `.env.example` -- document the embedding pin and price overrides beside the existing per-class block.

**Acceptance Criteria:**
- Given a Subject with an existing canonical Topic, when `normalize` is called with a label whose normalized key matches it, then the existing Topic's id is returned, no `Topic` row is created, and no `ai_call` row is written.
- Given a label that reaches stage 3 and a model answer of "none fit", when `normalize` returns, then exactly one new `Topic` row exists for that Subject with `provisional: true`, a cached vector, and the label as its name.
- Given any completed `normalize` that made a provider call, when the cost table is read, then each call wrote one `ai_call` row with `callClass: TopicNormalization` and the model actually sent, and no row carries model output.
- Given the same Subject and two labels that map to the same canonical Topic, when both are normalized, then both return the same id and the Subject's canonical set has exactly one row for them.
- Given `grep -rn "vector(\|pgvector\|prisma-extension-pgvector" apps/api/prisma apps/api/src`, when it runs, then it returns nothing.
- Given `apps/api/src/practicetest` and the generation prompt, when the diff is read, then neither is changed by this story.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 5, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 10: (high 0, medium 3, low 7)
- addressed_findings:
  - `[high]` `[patch]` `TOPIC_CANDIDATE_LIMIT` was applied as `take:` over `createdAt asc`, so past 50 canonical Topics per Subject every newer Topic became invisible to stage 2 and stage 3 and duplicates would mint without bound — the exact Mastery fragmentation this story exists to prevent. Stage 2 now compares against every Topic of the Subject; the cap applies only to the stage-3 offered list, strongest-cosine first with a deterministic `id` tiebreak.
  - `[medium]` `[patch]` Stage 2 bought an embedding before checking whether any candidate carried a comparable vector, so an all-vectorless or post-re-pin set paid for a hopeless call; comparability is now checked first.
  - `[medium]` `[patch]` A Topic minted with no vector could never acquire one, leaving it permanently unmatchable at stage 2; a stage-3 match against a vectorless candidate now backfills that candidate's vector from its stored name.
  - `[medium]` `[patch]` `AiService.embed` hardcoded `TopicNormalization` in its retry log and its cost row; `AiEmbedRequest` now carries `callClass`.
  - `[medium]` `[patch]` `topicMatchKey` did no Unicode normalization, so one accented label in NFC and NFD keyed twice and split its Mastery history; NFC is applied before tokenizing, with spec cases.
  - `[medium]` `[patch]` A model-generated label was unbounded into `name`, the indexed `matchKey` (btree row limit), the embedding and every later prompt; it is now reduced once to a stated maximum rather than refused.
  - `[medium]` `[patch]` Coverage gaps that let real regressions ship green: the `openai` embedding branch was executed by nothing, the embedding pin's env overrides were resolved by nothing, the stage-3 prompt's fence escaping had no spec, the `embeddingModel` staleness guard was a no-op in every setup, and the candidate cap was never exceeded. All five are now covered (unit tier 23 → 108 tests, int-spec 14 → 19).
  - `[low]` `[patch]` `normalize` took three positional strings; it now takes one object, as `ai.run` and `ai.embed` do.
  - `[low]` `[patch]` `.env.example` gained its own `Topic canonicalization` banner instead of appending inside the Legibility region.
  - `[low]` `[patch]` `embedFake` billed from the untrimmed text while the vector used the trimmed string.
  - `[low]` `[patch]` `failNextEmbed` accepted latch kinds the embed path ignores, so a latched spec could pass for the wrong reason.
  - `[low]` `[patch]` The fake-embedding spec asserted an exact `0` cosine, an accident of the hash rather than a property; it now asserts below the threshold.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 12: (high 0, medium 1, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `AiService.embedOpenAi` sent `request.text` untrimmed while `embedFake` trimmed before embedding and billing, so a label's leading/trailing whitespace billed and vectorized differently between transports; `embedOpenAi` now trims exactly as the fake does.
  - `[medium]` `[patch]` `AiService.embedOpenAi` accepted `response.usage.prompt_tokens` at `0` or negative alongside a valid vector, so a real embedding could be cached and billed as free; it now requires a positive count and raises `AiUpstreamError` otherwise.
  - `[low]` `[patch]` The `topic_subjectId_provisional_idx` comment in `schema.prisma` and its migration claimed stage 2's read benefits from the `provisional` column; stage 2 actually reads by `subjectId` equality alone, so the comment now says the index serves that read by its `subjectId` prefix only, with `provisional` earning its place once Story 7.6's queue exists.
  - `[medium]` `[defer]` `TopicService.cacheVectorFor`'s own database write failure has no test forcing it (see the new `deferred` entry) — a safe integration-tier failure-injection seam does not exist for `PrismaService` the way `AiService`'s mockable client has one, and an attempt to add one destabilized an unrelated test in the same file.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 3: (high 0, medium 2, low 1)
- reject: 13: (high 0, medium 3, low 10)
- addressed_findings:
  - none

## Design Notes

**Why no label-alias cache.** Stage 2/3 resolve a label whose key differs from the canonical Topic's key, so the same spelling re-embeds next time. A per-label cache table is a real cost saving and is deliberately not built: AD-11 names three stages and one interface, and an alias table is a fourth matching path that a later caller could read directly. It is cheaper to add behind `normalize` later than to un-share once two call sites know about it.

**Stage ordering vs. transactions.** `normalize` makes provider calls and writes its own row, so it must be called *before* the Mastery transaction opens, never inside it — AD-10's "recompute inside the transaction of whatever changed a grade" governs Mastery, not canonicalization. Story 7.2 resolves ids first, then opens its transaction.

**Fake embedding shape.** A hashed bag-of-words fake makes near-duplicates score ~0.5 and stage 2 untestable. Character trigrams put `fraction addition` and `fractions addition` above 0.85 while keeping `long division` and `fractions` well below it, so both branches are reachable with no provider.

## Verification

**Commands:**
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm --filter api run typecheck` -- expected: clean.
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies to a fresh database.
- `pnpm --filter api run test` -- expected: all unit and integration specs pass, including `topic-normalization.int-spec.ts`.
- `grep -rn "vector(\|pgvector" apps/api/prisma apps/api/src` -- expected: no matches.

## Auto Run Result

**Summary of implemented change:** No code changes made in this pass. This was a fresh review-only pass triggered by re-dispatching a `done` spec (per build-auto's `done` → review-pass routing); prior passes (see Review Triage Log above) already implemented and reviewed the `topics` module (AD-11 three-stage cascade), its schema, and its tests.

**Files changed:** None this pass.

**Review findings breakdown:** 0 patches applied, 3 items deferred (medium: concurrent near-duplicate mints across different match keys; low: untested `Topic.subjectId` `ON DELETE RESTRICT` FK; medium: untested `offer()` newest-first fallback ordering past the candidate cap), 13 items rejected (duplicates of already-deferred entries, out-of-scope per this story's own `Never` boundaries or Story 7.6 exclusion, orchestrator-owned bookkeeping, and findings that turned out to be false positives on closer reading of the code — e.g. `cacheVectorFor`'s embed call already swallows provider errors, and a malformed `subjectId` is already handled as a plain no-match by Prisma rather than a raw error).

**Follow-up review recommendation:** `false`. This pass triaged 0 patched findings (score: high 0, medium×3=0, low×1=0 → 0, below the 5 threshold).

**Verification performed:** No code changed, so the `## Verification` commands were not re-run. Findings were verified by direct code reading (`apps/api/src/topics/topic.service.ts`, `apps/api/src/ai/ai-config.ts`, `apps/api/prisma/schema.prisma`) against each reviewer's claim before triage, which is how three of the four Edge Case Hunter/Blind Hunter findings were downgraded to reject as false positives or already-documented decisions.

**Residual risks:** The three deferred items stand as open, real gaps for future attention — none block this story's own `<intent-contract>`, which the Intent Alignment Auditor confirmed this diff implements faithfully with no divergence in the behavioral (Always/Never) surface, only in the verification/reliability surface already tracked via `deferred`.

