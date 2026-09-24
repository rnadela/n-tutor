---
title: 'Story 3.5 — Structured Extraction'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: '9ce972f10da2149f72060884d53a51faecca3c1f'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The API integration suite carries a pre-existing intermittent failure,
      most often in the PIN cool-down case, unrelated to Story 3.5.
    evidence: |-
      Reproduced by running parent-pin.int-spec.ts, taxonomy.int-spec.ts and
      source-test.int-spec.ts together without any Story 3.5 file: roughly one
      run in four fails "accepts the same correct PIN once the cool-down has
      lapsed". extraction.int-spec.ts ran six times in isolation with zero
      failures. Present before this story's baseline revision.
    location: >-
      apps/api/test/parent-pin.int-spec.ts
    severity: medium
  - summary: >-
      A Submitted Source Test still carries the 72-hour uncommitted-state
      expiresAt, so the general Source Test read 404s three days after capture.
    evidence: |-
      submit() never clears or extends SourceTest.expiresAt, and requireLive()
      rejects any expired row regardless of status
      (apps/api/src/sourcetest/source-test.service.ts). Story 3.5 worked around
      this for its own status route by adding requireReadable, which honours
      expiry only while the row is a Draft; the pre-existing read path was left
      alone because it belongs to Stories 3.2/3.3 and AD-16.
    location: >-
      apps/api/src/sourcetest/source-test.service.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A Submitted Source Test is today a row and a pile of JPEGs and nothing else — there is no `ai` module, no queue, and no persisted structured reading of the pages, so nothing in Epic 4 onward can generate a Practice Test, and the moment Epic 8 expires the Page Images the product forgets what the paper said.

**Approach:** Ship the `ai` module (AD-17/20/22, Responses API + Structured Outputs per AD-9) and the `extraction` module: submitting a Source Test enqueues an Extraction job in the *same* transaction (AD-5), a Postgres-backed worker claims it, sends every Ready page in ordinal order as one vision call, validates the payload deterministically in code (AD-30), and persists Questions, Question Formats, Topic labels, cross-page shared context, uninterpretable regions, and structured fractions — a document that outlives the photographs it came from.

## Boundaries & Constraints

**Always:**
- **One `ai` module owns every provider call** (AD-17): the OpenAI client, the pinned model snapshot per call class, timeout and retry policy, and the `AiCall` cost row. It is the only writer of `ai_call` and the only test seam for nondeterminism (AD-22). Domain modules call it with a typed request; **the prompt text lives in `extraction`**, which is the AD-17 carve-out.
- **Structured output via the Responses API** (AD-9): a JSON schema built from Zod with `zodTextFormat` (`openai/helpers/zod`, SDK `7.8.0`). Never Chat Completions `response_format`, never legacy `json_object`.
- Two transports, resolved and validated **once at boot** exactly as `MailService` resolves its own: `fake` (the default; the seam every unit, integration and E2E tier runs on) and `openai`. `NODE_ENV=production` must state the transport explicitly, and `openai` requires `OPENAI_API_KEY`. The vision per-request timeout defaults to **180 000 ms** (AD-7, AD-33) — a shorter timeout converts a slow success into a retry that pays twice.
- The fake can fail, not only succeed (AD-22): `AI_FAKE_FAILURE` selects `none` (default), `transport`, `schema`, or `unusable`, read per call so a test can drive it.
- **One `AiCall` row per completed provider call** (AD-20): parent account, call class, pinned model snapshot, input/output token counts, computed cost in integer micros, latency, correlation id. No row, log line, or error ever carries image bytes or extracted Question content — identifiers only.
- **AI failures split two ways** (AD-31). *Upstream fault*: transport error, timeout, non-OK response, schema-invalid payload, or post-hoc validation failure — retried with backoff inside `ai`, and on exhaustion the job ends `Failed` and **retryable**. *Client fault*: the model reports every page uninterpretable — terminal, never retried, and the job ends `Failed` and **not** retryable, which is what a later retake prompt reads.
- **Extraction is a queued job** (AD-3, AD-4): `submit` enqueues and returns; the job outlives the connection. **Enqueue and the status mutation share one transaction** (AD-5) — the job row is written inside `submit`'s existing `withTransaction`, so a Submitted Source Test with no job is unreachable.
- Exactly one Extraction job and at most one Extraction per Source Test, enforced by a unique constraint, so a re-run replaces rather than duplicates.
- The job spans **all Ready pages as one document in ordinal order** and preserves cross-page context: a passage or data table is stored once, carries the page range it occupies, and the questions referencing it point at it — including questions on later pages.
- Every extracted Question carries **exactly one Question Format** and **at least one Topic label**, both enforced by deterministic post-hoc validation in code, never trusted from the payload (AD-30). Topic labels are stored raw; canonicalization is Epic 7 (AD-11).
- Content the model cannot interpret is recorded as an **uninterpretable region** (page ordinal + kind), never guessed at, and a Question that depends on one is stored with `usable = false` — `usable` is computed in code from `dependsOnUninterpretable` and low confidence, never read from the payload.
- **Fractions are structured, not strings** (AD-32, UX-DR8): every text-bearing field is stored as a rich-text segment array (`{ kind: 'text' }` / `{ kind: 'fraction', whole?, numerator, denominator }`), validated by one Zod schema, so a spoken alternative is always recoverable.
- The Extraction is **persisted and self-sufficient**: nothing about reading it back may touch Page Image rows or bytes, so it keeps working after Epic 8 expires the images.
- The account comes from `req.elevated` (AD-18); a foreign or unknown Source Test is 404, never 403. User-facing strings live in `src/copy/parent.ts` or the module's policy constants — no hardcoded literal.
- `extraction` is the sole owner and sole writer of every extraction table; it reads Page Image bytes **through `SourceTestService`**, never through a Prisma delegate of its own and never through a storage path (AD-17, AD-15, AD-28).

**Block If:**
- Nothing. The call class, the queue substrate, the transaction rule, the confidence/validation rule, and the fraction rule are all settled by the architecture spine and the epic context.

**Never:**
- Do not build the camera viewfinder or library multi-select (Story 3.1), the legibility check or the Upload-Allowance count (Story 3.4), or the thin-Extraction warning and its copy (Story 3.6).
- Do not build a browsable Extraction surface: no endpoint, page, or response may return extracted Question content in v0. The only read surface is **job status plus counts**.
- Do not add a broker, a second datastore, `pg-boss`, or `@nestjs/schedule` in this story — the job table in the application database is the substrate (AD-5), and AD-33's scheduler arrives with the sweeps that need it.
- Do not implement allowance charging or enforcement, Topic canonicalization, or Practice Test generation.
- Do not let any module other than `ai` construct the OpenAI client or write `ai_call`.
- Do not touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enqueue on commit | `POST /parent/source-tests/:id/submit` on a classified draft with 3 Ready pages | 200; status `Submitted`; exactly one `extraction_job` row, status `Queued`, written in the same transaction | No error expected |
| Submit refused | Unclassified or zero-page draft | Existing 400; **no** `extraction_job` row exists | Whole transaction rolls back |
| Job runs | Worker claims the Queued job | One provider call over all 3 pages in ordinal order; job `Succeeded`; one `Extraction` with its Questions, formats, topics, contexts and regions; exactly one `AiCall` row | No error expected |
| Two workers, one job | Two claim passes racing the same job | Exactly one claims it (`FOR UPDATE SKIP LOCKED`); the other claims nothing; one provider call total | No error expected |
| Cross-page context | Payload with a passage on page 1 referenced by a question on page 2 | The passage is stored once with its page range; both questions point at the same context row | No error expected |
| Fraction in content | Payload with a fraction segment | Stored as `{ kind: 'fraction', numerator, denominator }` in the rich-text column, never as `"1/2"` | No error expected |
| Uninterpretable region | Payload naming a handwriting-only region on page 2 and a question depending on it | The region is stored; that question is stored with `usable = false`; other questions stay usable | No error expected |
| Transport fault | `AI_FAKE_FAILURE=transport` | `ai` retries to exhaustion; job `Failed`, `failureKind = UpstreamFault`, `retryable = true`; **no** partial Extraction, **no** `AiCall` row | Nothing stored |
| Schema-invalid payload | `AI_FAKE_FAILURE=schema` | Same as a transport fault — a model that misbehaved is upstream (AD-31) | Nothing stored |
| Post-hoc violation | Payload with a question carrying zero topics, two formats, an unknown page ordinal, or an unresolvable context id | Payload rejected **whole**; job `Failed`, `UpstreamFault`, retryable; nothing stored | Never a partial store |
| Unusable input | `AI_FAKE_FAILURE=unusable` (every page uninterpretable) | Job `Failed`, `failureKind = ClientFault`, `retryable = false`; no retry is attempted | Terminal by design |
| Status read | `GET /parent/source-tests/:id/extraction` after success | 200 `{ status: 'Succeeded', pageCount, questionCount, usableQuestionCount, uninterpretableRegionCount, completedAt }` — **no** question content | No error expected |
| Status read before the job runs | Same call on a freshly Submitted Source Test | 200 with `status: 'Queued'` and null counts | No error expected |
| Status read on a draft | Source Test still `Draft` | 404 `EXTRACTION_NOT_FOUND` — no job exists yet | Client returns to the capture flow |
| Extraction outlives the images | Every `page_image` row and its bytes deleted after success | The status read and the stored Extraction are unchanged and still complete | No error expected |
| Foreign or unknown Source Test | Valid elevation, another account's id | 404 `SOURCE_TEST_NOT_FOUND` | Never 403 |
| Re-run after failure | The job re-enqueued for a Source Test that already failed | The single job row returns to `Queued`; a prior partial Extraction, if any, is replaced whole | No duplicate job row |

</intent-contract>

## Code Map

**Patterns to follow (read-only anchors):**
- `apps/api/src/mail/mail.service.ts:22-97` -- `MAIL_TRANSPORTS` as a const tuple, `resolveMailConfig(env)` as a **pure function over an env object**, production forced to state itself (`:46-48`), unknown transport rejected rather than defaulted (`:50-54`), numeric validation refusing zero (`:64-69`), config resolved once in the constructor (`:94-97`). `:126-144` is the HTTP transport (`fetch` + `AbortSignal.timeout`); `:12-20` `MailDispatchError` is the transport-fault class shape. `AiService`'s config, transports and fault types mirror this file.
- `apps/api/src/mail/mail.service.spec.ts:4-17` -- `serviceWith(env)` snapshotting and restoring `process.env`, `vi.restoreAllMocks()` / `vi.unstubAllGlobals()` in `afterEach`, `vi.stubGlobal('fetch', …)` (`:109-117`). The unit-spec idiom for `ai-config.spec.ts` and `ai.service.spec.ts`.
- `apps/api/src/mail/mail.module.ts:8-12` -- a module with one provider, one export, no controller. `AiModule` is the same except that it **owns** `ai_call`.
- `apps/api/src/prisma/prisma.service.ts:11-14` -- `TransactionClient`; `:32-34` `withTransaction(fn)`. `apps/api/src/prisma/prisma.module.ts:4-8` is `@Global()`, so a new module needs no Prisma import.
- `apps/api/src/sourcetest/source-test.service.ts:528-566` -- `submit`: `requireDraft` outside the tx, then `withTransaction` with the page-count gate (`:532`), the classification gate (`:539-543`), the `updateMany` whose where-clause carries every gate (`:544-561`), and `written.count !== 1` → `ConflictException` (`:562`). **The enqueue call goes inside this callback, after `:562`.**
- `apps/api/src/sourcetest/source-test.service.ts:631-645` -- `rewriteOrdinals(tx, …)`: the established convention that a cross-service write takes `tx` as its first parameter (documented at `prisma.service.ts:6-10`). `ExtractionService.enqueue(tx, …)` follows it exactly.
- `apps/api/src/sourcetest/source-test.service.ts:678-692` (`storeBytes`) and `apps/api/src/sourcetest/page-ingest.service.ts:114-128` (`write`) / `:139-146` (`remove`) -- how bytes reach and leave disk. `source-test-policy.ts:195-200` `storagePathFor(pageId)` is the only path derivation; `STORED_MIME` / `STORED_EXTENSION` (`:49-51`) mean everything read back is JPEG.
- `apps/api/src/sourcetest/source-test.service.ts:39-46,81-89` -- `PAGE_FIELDS` deliberately excludes `storagePath`: a path never leaves the module. The new byte-reading method returns buffers, never paths.
- `apps/api/src/sourcetest/source-test.service.ts:716-730` -- `requireLive` / `requireDraft` and the 404-not-403 rule; `source-test-policy.ts:288-304` `expiryFrom` / `isExpired` / `liveAt`.
- `apps/api/src/sourcetest/source-test-policy.ts` -- the four-section layout (constants, `// --- Messages ---` `:64`, `// --- Runtime ---` `:137` with the memoised `sourceTestRuntime()` / `resetSourceTestRuntime()` pair, `// --- Rules ---` `:202`) and the plain-`Error`-subclass domain fault (`PageOrderMismatch` `:272-277`). `extraction-policy.ts` copies this shape.
- `apps/api/src/sourcetest/source-test.controller.ts:149-151` -- `@Controller('parent/source-tests')` + class-level `@UseGuards(ParentElevationGuard)`; `:159` and siblings -- the account always comes from `req.elevated!.parentAccountId`. `apps/api/src/identity/parent-elevation.guard.ts:13-24` -- `ElevatedPrincipal` / `ElevatedRequest`.
- `apps/api/src/sourcetest/source-test.module.ts:33-56` -- the module shape a parent-facing module needs: `JwtModule.registerAsync({ useFactory: () => ({ secret: requireParentJwtSecret() }) })`, `IdentityModule`, `providers: [… , ParentElevationGuard]`, `exports: [SourceTestService]`, and a constructor that calls its runtime resolver for fail-fast boot validation (`:54`).
- `apps/api/src/common/env.ts` -- `requireEnv` / `optionalEnv` / `requireIntEnv` / `optionalBoolEnv`; every new variable is read through these and nowhere else.
- `apps/api/src/common/correlation.ts:22` -- `currentCorrelationId()`, the id every `AiCall` row carries (AD-20). It is request-scoped, so a worker-run job has none: the job id is the handle, and the column stays nullable.
- `apps/api/src/allowance/allowance.service.ts:38-56` -- `ArtifactCounter` / `ARTIFACT_COUNTERS`: read-only here, and this story must leave it untouched.
- `apps/api/prisma/schema.prisma:317-334` (`SourceTestStatus`, `PageImageState`), `:349-400` (`SourceTest`), `:413-434` (`PageImage`), `:120-158` (`ParentAccount`) -- the model conventions: `id String @id @default(uuid())` first, `createdAt`/`updatedAt`, `@@map("snake_case")` on every model **and** enum, PascalCase enum members, `Restrict` for durable references and `Cascade` for owned children, `///` doc comments citing AD-nn.
- `apps/api/prisma/migrations/20260924000804_add_source_test/migration.sql:69` -- a partial unique index lives in raw migration SQL, not the schema.
- `apps/api/test/harness.ts:66-103` (`createHarness`), `:124-141` (**both** hand-maintained TRUNCATE lists, which must gain the new tables), `:160-190` (`captureMail` with its `failNext()` latch — the exact seam shape `captureAi` copies), `:218-310` (the fixture helpers), `:421-428` (`elevate`).
- `apps/api/test/source-test.int-spec.ts:70` (`const server = () => request(h.app.getHttpServer())`), `:89-160` (`elevatedParent` / `openDraft` / `addPage` / `classifyDraft`), `:168-171` (`messagesOf`), `:174-201` (`storedPages`), `:549-560` (the submit-then-re-read idiom), `:47-59` (`photo()` building real bytes with sharp). The new int-spec reuses these shapes.
- `apps/api/test/setup.ts` -- where a test-only env default belongs (`UPLOAD_ROOT`, the rate limits). The worker's enable flag gets its default here.
- `apps/api/vitest.config.ts:8` -- `include: ['test/**/*.int-spec.ts', 'src/**/*.spec.{ts,tsx}']`: unit specs are colocated in `src/`, integration specs live in `test/` with the `.int-spec.ts` suffix. `:13` `fileParallelism: false`.
- `e2e/tests/parent-capture.spec.ts:353-410` -- the direct-to-API case (sign-up → PIN → elevate → profile → draft → submit → read back with `fetch` against `API_ORIGIN`). The new E2E case extends this one rather than driving the browser, because this story has no parent-facing surface.
- `.env.example:72-81` -- the Mail group: transport selector, "an unknown value refuses to boot", required-when-remote vars commented out. The `AI_*` group copies it, with the `# --- … (Epic 3, Story 3.5) ---` provenance header the other groups carry.

**Files to create:**
- `apps/api/src/ai/ai-config.ts`, `ai-config.spec.ts`, `ai.service.ts`, `ai.service.spec.ts`, `ai.module.ts`
- `apps/api/src/extraction/extraction-policy.ts`, `extraction-policy.spec.ts`, `rich-text.ts`, `rich-text.spec.ts`, `extraction-schema.ts`, `extraction-prompt.ts`, `extraction-payload.ts`, `extraction-payload.spec.ts`, `extraction.service.ts`, `extraction.runner.ts`, `extraction.controller.ts`, `extraction.module.ts`
- `apps/api/prisma/migrations/<timestamp>_add_ai_call_and_extraction/migration.sql`
- `apps/api/test/extraction.int-spec.ts`

**Files to change:**
- `apps/api/prisma/schema.prisma`
- `apps/api/package.json` (add `openai@7.8.0`, `zod@4.6.5`)
- `apps/api/src/sourcetest/source-test.service.ts`, `source-test.module.ts`
- `apps/api/src/app.module.ts`, `.env.example`
- `apps/api/test/harness.ts`, `apps/api/test/setup.ts`, `apps/api/test/source-test.int-spec.ts`
- `e2e/tests/parent-capture.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/api/package.json` -- add `openai` pinned to `7.8.0` and `zod` pinned to `4.6.5` to `dependencies`, then `pnpm install` -- AD-9 names the SDK and the `zodTextFormat` helper by version; AD-7's rule is that sharp edges are pinned, so neither gets a range.
- `apps/api/prisma/schema.prisma` -- add, with `///` doc comments citing the decisions: enum `AiCallClass { Extraction Generation Grading Explanation Legibility TopicNormalization }` (`@@map("ai_call_class")`) and model `AiCall` owned by `ai` (`parentAccountId` + `Restrict` relation and a back-relation on `ParentAccount`, `callClass`, `model`, `inputTokens`, `outputTokens`, `costMicros Int`, `latencyMs Int`, `correlationId String?`, `createdAt`, `@@index([parentAccountId, createdAt])`, `@@index([createdAt])`, `@@map("ai_call")`); enums `ExtractionJobStatus { Queued Running Succeeded Failed }`, `AiFailureKind { UpstreamFault ClientFault }`, `QuestionFormat { MultipleChoice FillInTheBlank ShortAnswer }`, `ExtractionConfidence { Low Medium High }`, `ExtractedContextKind { Passage DataTable }`, `UninterpretableKind { Diagram Handwriting Cropped Other }`; and models `ExtractionJob` (`sourceTestId String @unique`, `Cascade`, `status`, `attempts Int @default(0)`, `lockedAt DateTime?`, `failureKind AiFailureKind?`, `failureReason String?`, `retryable Boolean @default(false)`, `completedAt DateTime?`, `@@index([status, createdAt])`), `Extraction` (`sourceTestId String @unique`, `Cascade`, `pageCount Int`, `completedAt`), `ExtractedContext` (`extractionId` `Cascade`, `ordinal Int`, `kind`, `body Json`, `startPageOrdinal Int`, `endPageOrdinal Int`, `@@unique([extractionId, ordinal])`), `ExtractedQuestion` (`extractionId` `Cascade`, `ordinal Int`, `pageOrdinal Int`, `format QuestionFormat`, `prompt Json`, `confidence ExtractionConfidence`, `dependsOnUninterpretable Boolean`, `usable Boolean`, `contextId String?` `SetNull`, `@@unique([extractionId, ordinal])`, `@@index([extractionId, usable])`), `ExtractedChoice` (`questionId` `Cascade`, `ordinal Int`, `body Json`, `@@unique([questionId, ordinal])`), `ExtractedTopicLabel` (`questionId` `Cascade`, `label String`, `confidence`, `@@index([questionId])`), `UninterpretableRegion` (`extractionId` `Cascade`, `pageOrdinal Int`, `kind`) -- `Cascade` throughout because every one of these is a child owned by the Source Test or the Extraction, matching `PageImage`; `Restrict` only on the `AiCall` → `ParentAccount` edge, because a cost row must never vanish as a side effect; `costMicros` as an integer because a money column that is a float is a money column that drifts; `Json` for every text-bearing field because AD-32 makes structure the emission, not a rendering concern.
- `apps/api/prisma/migrations/<timestamp>_add_ai_call_and_extraction/migration.sql` -- generate with `pnpm --filter api exec prisma migrate dev --name add_ai_call_and_extraction`; no backfill -- an already-Submitted Source Test from a previous run simply has no job, and nothing in this story reads one that is absent.
- `apps/api/src/ai/ai-config.ts` -- the `AI_TRANSPORTS = ['fake','openai'] as const` tuple, the call-class enumeration, a `MODEL_PINS` record mapping each call class to `{ model, inputMicrosPerMillion, outputMicrosPerMillion }` seeded from `AI_MODEL_<CLASS>` / `AI_PRICE_<CLASS>_{IN,OUT}` with the AD-8 aliases (`gpt-5.6-sol` for Extraction, `gpt-5.6-terra`, `gpt-5.6-luna`) as defaults, `resolveAiConfig(env)` returning `{ transport, apiKey?, timeoutMs, maxAttempts, retryBaseMs, pins }`, and `costMicrosFor(pin, inputTokens, outputTokens)` -- a pure function over an env object exactly like `resolveMailConfig`, so the figures are unit-testable without Nest and a mistyped transport fails the boot rather than the first parent to upload.
- `apps/api/src/ai/ai-config.spec.ts` -- unit-test the resolver across: default `fake`; `NODE_ENV=production` with no transport stated; an unknown transport; `openai` without `OPENAI_API_KEY`; a non-numeric, a zero and a negative timeout; the 180 000 ms default; an env-overridden model pin; and `costMicrosFor` arithmetic (including that it rounds to an integer) -- the figures are the reason this file exists, so they are what is asserted.
- `apps/api/src/ai/ai.service.ts` -- `AiUpstreamError` and `AiInputError` (plain `Error` subclasses setting `this.name`, carrying no content), and one public `run<T>({ callClass, parentAccountId, images: { ordinal, buffer, mimeType }[], prompt, schema: ZodType<T>, schemaName })` returning `{ payload: T, usage }`. It resolves the pin, dispatches through the transport with `AbortSignal.timeout(config.timeoutMs)`, retries an upstream fault with exponential backoff up to `maxAttempts`, and writes exactly one `AiCall` row per **completed** provider call. The `openai` transport uses `client.responses.parse({ model, input: [{ role: 'user', content: [ …text, …input_image data URLs in ordinal order ] }], text: { format: zodTextFormat(schema, schemaName) } })`. The `fake` transport builds a deterministic payload from the image count and honours `AI_FAKE_FAILURE` read per call (`transport` → `AiUpstreamError`, `schema` → a payload the Zod schema rejects, `unusable` → every page uninterpretable). A schema parse failure is an `AiUpstreamError`, never an input fault (AD-31).
- `apps/api/src/ai/ai.service.spec.ts` -- unit-test: a successful fake run parses to the schema; `AI_FAKE_FAILURE=transport` exhausts `maxAttempts` and throws `AiUpstreamError`; `AI_FAKE_FAILURE=schema` throws `AiUpstreamError`; an `AiCall` row is written on success and **not** on an exhausted fault; `costMicrosFor` drives the stored figure; and no error message, thrown value, or logged line contains image bytes.
- `apps/api/src/ai/ai.module.ts` -- exports `AiService`, no controller, no imports (Prisma is global); registered in `apps/api/src/app.module.ts`. It owns `ai_call` and nothing else writes it (AD-17, AD-20).
- `apps/api/src/extraction/rich-text.ts` + `rich-text.spec.ts` -- the Zod `RichTextSegment` union (`{ kind: 'text', value }` | `{ kind: 'fraction', whole?: int, numerator: int, denominator: int }`), `RichText = RichTextSegment[]`, a `parseRichText(value: unknown)` that rejects a denominator of zero and an empty array, and a pure `plainTextOf(rich)` rendering a fraction as `numerator/denominator` -- one mechanism for every text-bearing field, so a spoken alternative is always recoverable (AD-32) and no call site ever decides how a fraction is stored.
- `apps/api/src/extraction/extraction-schema.ts` -- the Zod schema the model must answer: `{ pages: { ordinal, interpretable }[], contexts: { id, kind, body: RichText, startPageOrdinal, endPageOrdinal }[], questions: { pageOrdinal, format, prompt: RichText, choices: RichText[], topics: { label, confidence }[], confidence, contextId: nullable, dependsOnUninterpretable }[], uninterpretable: { pageOrdinal, kind }[] }`, with every field carrying its own confidence where AD-30 requires one and `null` permitted wherever the model must be allowed to decline rather than guess. Used by both transports and by `zodTextFormat`.
- `apps/api/src/extraction/extraction-prompt.ts` -- the prompt text (the AD-17 carve-out: it stays in the domain module), instructing the model to read all pages as one document in the given order, to keep a passage or table shared across pages as one context referenced by id, to emit fractions as structured segments rather than strings, to return `null` and an uninterpretable region rather than guess, and to assign exactly one format and at least one topic per question.
- `apps/api/src/extraction/extraction-payload.ts` + `extraction-payload.spec.ts` -- `validateExtractionPayload(payload, pageOrdinals)`, the deterministic post-hoc pass of AD-30, returning either a normalized document or throwing `ExtractionPayloadInvalid`: every `pages[].ordinal` is exactly the stored set; every question's `pageOrdinal` and every region's `pageOrdinal` is in that set; every `contextId` resolves and its page range covers the referencing question's page or an earlier one; every question has at least one non-blank topic label and exactly one format from the enum; a `MultipleChoice` question has at least two choices and every other format has none; every rich-text field parses. It then **computes** `usable = !dependsOnUninterpretable && confidence !== 'Low'` and never reads a `usable` field from the payload. If every page is `interpretable: false`, it throws `ExtractionInputUnusable` instead -- the one client-fault branch (AD-31). The spec drives every rejection branch and both fault classes.
- `apps/api/src/extraction/extraction-policy.ts` + `extraction-policy.spec.ts` -- message constants (`EXTRACTION_NOT_FOUND`, `SOURCE_TEST_NOT_FOUND`, `EXTRACTION_FAILED`), the memoised `extractionRuntime()` / `resetExtractionRuntime()` pair reading `EXTRACTION_WORKER_ENABLED`, `EXTRACTION_POLL_MS`, `EXTRACTION_CLAIM_TIMEOUT_MS`, and pure `isStale(job, now)` for a `Running` job whose lock has outlived the claim timeout -- same four-section layout as `source-test-policy.ts`, so every sentence and every figure is stated once.
- `apps/api/src/extraction/extraction.service.ts` -- `enqueue(tx, sourceTestId)` doing an idempotent upsert of the `ExtractionJob` row to `Queued` with cleared failure fields (taking `tx` first, per the `rewriteOrdinals` convention, so AD-5's one-transaction rule holds); `claimNext()` using `withTransaction` and `SELECT … FOR UPDATE SKIP LOCKED` over `Queued` jobs and stale `Running` ones, moving the claimed row to `Running` with `lockedAt` and `attempts + 1`; `runJob(job)` reading the pages through `SourceTestService.readPageBytes`, calling `ai.run` once with the extraction schema and prompt, validating the payload, then in **one transaction** deleting any existing `Extraction` for the Source Test and writing the new one with its contexts, questions, choices, topic labels and regions, and marking the job `Succeeded`; failure handlers writing `Failed` with `failureKind`/`retryable` per AD-31 and storing a message **constant**, never a provider string; and `statusFor(parentAccountId, sourceTestId)` returning the job status plus counts after `SourceTestService.requireLive` has proven ownership -- counts read from the extraction tables alone, so the answer survives Epic 8 deleting every page.
- `apps/api/src/extraction/extraction.runner.ts` -- an `OnModuleInit`/`OnModuleDestroy` provider that, when `extractionRuntime().workerEnabled`, drives `claimNext()` on an interval, awaiting each `runJob` and never overlapping passes; it exposes `runOnce()` so an integration test can drive exactly one pass deterministically, and it logs only job and Source Test identifiers (AD-20).
- `apps/api/src/extraction/extraction.controller.ts` -- `@Controller('parent/source-tests')` with class-level `@UseGuards(ParentElevationGuard)` and a single `@Get(':id/extraction')` taking the account from `req.elevated!.parentAccountId`; 404 for an unknown, foreign, expired, or not-yet-submitted Source Test -- never 403, and never any question content in the body.
- `apps/api/src/extraction/extraction.module.ts` -- imports `AiModule`, `IdentityModule`, the same `JwtModule.registerAsync` as `SourceTestModule`, and `forwardRef(() => SourceTestModule)`; providers `ExtractionService`, `ExtractionRunner`, `ParentElevationGuard`; exports `ExtractionService`; constructor calls `extractionRuntime()` for fail-fast boot validation. Registered in `app.module.ts`.
- `apps/api/src/sourcetest/source-test.service.ts` -- add `readPageBytes(sourceTestId)` returning `{ ordinal, buffer, mimeType }[]` for `Ready` pages in ordinal order, read through `PageIngestService`/`storagePathFor` so no path ever leaves the module; and inject `ExtractionService` with `@Inject(forwardRef(() => ExtractionService))`, calling `await this.extraction.enqueue(tx, sourceTestId)` inside `submit`'s existing `withTransaction` immediately after the `written.count !== 1` guard -- inside, because AD-5 requires the enqueue and the status mutation to be the same transaction.
- `apps/api/src/sourcetest/source-test.module.ts` -- import `forwardRef(() => ExtractionModule)` -- the dependency is genuinely mutual (submit enqueues; the job reads pages) and `forwardRef` is the honest expression of it.
- `apps/api/src/app.module.ts` -- register `AiModule` and `ExtractionModule`, each with the one-line ownership comment the other modules carry.
- `.env.example` -- add an `# --- AI provider (Epic 3, Story 3.5) ---` group (`AI_TRANSPORT`, `AI_TIMEOUT_MS`, `AI_MAX_ATTEMPTS`, `AI_RETRY_BASE_MS`, `AI_FAKE_FAILURE`, commented `OPENAI_API_KEY`, commented `AI_MODEL_EXTRACTION` / `AI_PRICE_EXTRACTION_IN` / `AI_PRICE_EXTRACTION_OUT`) and an `# --- Extraction jobs (Epic 3, Story 3.5) ---` group (`EXTRACTION_WORKER_ENABLED`, `EXTRACTION_POLL_MS`, `EXTRACTION_CLAIM_TIMEOUT_MS`), each variable carrying the prose comment saying what refuses to boot on a bad value, and the model/price entries carrying the AD-8 note that the aliases must be replaced with resolved snapshot ids before a production deploy.
- `apps/api/test/setup.ts` -- default `EXTRACTION_WORKER_ENABLED` to `'false'` with the `??=` idiom the other defaults use, so an integration test drives `runOnce()` deterministically instead of racing a timer.
- `apps/api/test/harness.ts` -- add the new tables to **both** TRUNCATE lists in child-before-parent order (`extracted_topic_label`, `extracted_choice`, `extracted_question`, `extracted_context`, `uninterpretable_region`, `extraction`, `extraction_job`, `ai_call`), and add a `captureAi(h)` spy mirroring `captureMail` (`sent` log of `{ callClass, imageCount }` with no bytes, a `failNext(kind)` latch, `restore()`), plus an `extractionRunner` handle on `Harness` so a spec can call `runOnce()`.
- `apps/api/test/extraction.int-spec.ts` -- cover every matrix row end to end against real Postgres: the job row written in the submit transaction and absent when submit is refused; one pass producing a `Succeeded` job, one `Extraction`, exactly one `AiCall` row, and the questions/formats/topics/contexts/regions the fake emits; a cross-page context shared by two questions; a stored fraction segment that is an object and not a string; an uninterpretable region making exactly the dependent question `usable = false`; both injected upstream faults leaving `Failed`/`UpstreamFault`/retryable with **no** `Extraction` row and no `AiCall` row; a post-hoc violation rejected whole; `unusable` giving `ClientFault` and `retryable = false`; two concurrent `claimNext()` calls where exactly one wins; the status endpoint's shape, its 404s (draft, foreign, unknown), and its answer being unchanged after every `page_image` row is deleted; and a re-enqueue replacing rather than duplicating.
- `apps/api/test/source-test.int-spec.ts` -- extend the `submitting` block with the two enqueue assertions (a job row exists after a successful submit; none exists after each refused submit) -- the transaction rule is proved where submit is already exercised, not only in the new spec.
- `e2e/tests/parent-capture.spec.ts` -- extend the direct-to-API case at `:353-410`: after the submit, poll `GET /api/parent/source-tests/:id/extraction` until it reports `Succeeded`, assert the counts are non-zero and that the body carries no question text, and assert a `Draft` Source Test's extraction read is 404 -- full stack, real worker, `ai` still faked (AD-22 tier 2).

**Acceptance Criteria:**
- Given a Source Test that has just been committed, when the worker runs, then every Page Image is read in page order as one document and the stored Extraction holds a shared passage or table recorded once with the page range it spans and referenced by the questions on later pages that depend on it.
- Given a completed Extraction, when its Questions are read back, then each one carries exactly one Question Format and at least one Topic, and a payload that violated either rule produced no Extraction at all rather than a corrected one.
- Given page content the model could not interpret, when the Extraction is stored, then that content is recorded as an uninterpretable region rather than guessed at, and the Questions depending on it are marked unusable so nothing downstream generates from them.
- Given a Source Test whose Page Images have since been deleted, when the Extraction is read, then it is complete and unchanged — nothing about reading it touches a Page Image row or a stored byte.
- Given a committed Source Test, when the submission transaction is inspected, then the Extraction job was enqueued inside it, so a Submitted Source Test with no job is unreachable and a failed submission leaves no job behind.
- Given an Extraction that failed, when its status is read, then it names whether the failure was the input's or the provider's, and only the provider's is reported as retryable.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 25: (high 1, medium 15, low 9)
- defer: 2: (high 0, medium 2, low 0)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[high]` `[patch]` The Extraction status read proved ownership through `requireLive`, which 404s on `expiresAt`, so a successfully extracted Source Test became unreadable 72 hours after capture — the exact opposite of the acceptance criterion that the Extraction outlives its images. A new `requireReadable` honours expiry only while the row is a Draft, and both directions are covered in the integration spec.
  - `[medium]` `[patch]` The OpenAI client kept the SDK's default `maxRetries: 2`, stacking with the module's own retry loop for up to nine billed vision calls against one cost row — the client is now constructed with `maxRetries: 0` and the configured timeout.
  - `[medium]` `[patch]` `FractionSegment.whole` was optional and the schema carried `.min()`/`.refine()`, all of which strict Structured Outputs rejects; every such constraint moved into the post-hoc validator and the wire schema is now expressible.
  - `[medium]` `[patch]` A blanket catch made an auth failure or an invalid-request indistinguishable from a provider outage and retried both — a new `AiRejectedError` fails fast on a non-transient 4xx while timeouts, 429 and 5xx stay retryable.
  - `[medium]` `[patch]` The `openai` transport — the only one a deployment uses — was executed by no test at any tier; a new `ai.service.openai.spec.ts` covers the request it builds, the ordinal order of the image parts, the token figures it reads, and the whole retry classification matrix.
  - `[medium]` `[patch]` The stale-claim reclaim branch, the only thing that rescues a job from a dead worker, had no test; two integration cases now cover a fresh claim not being re-claimable and a back-dated one being reclaimed to `Succeeded`.
  - `[medium]` `[patch]` `attempts` was incremented but never read, so a job that kills the worker would be re-claimed forever, paying a provider call each cycle — a `MAX_JOB_ATTEMPTS` ceiling now excludes it from the claim and fails it once, terminally.
  - `[medium]` `[patch]` `fail()` used `update`, which throws `P2025` when the job row has cascaded away, escaping `runJob`'s stated never-throws contract; both verdict writes use `updateMany`, and a missing Source Test gets its own reason constant instead of a parent-facing "retake the photos" sentence for a row that no longer exists.
  - `[medium]` `[patch]` `store()` wrote every child row sequentially inside an interactive transaction under Prisma's 5-second default, so a ten-page test could abort after the provider call was already paid for — ids are pre-minted, each level is one `createMany`, and the transaction states its own timeout.
  - `[medium]` `[patch]` The post-hoc pass never cross-checked `dependsOnUninterpretable` against the recorded regions and accepted a question sitting on a page the payload itself called uninterpretable; both are now whole-payload rejections, because `usable` is what Epic 4 generates from.
  - `[medium]` `[patch]` `PageIngestService.read()` let a raw `ENOENT` escape carrying the storage path, which then reached the job's error log against AD-15/AD-20 — it now throws a named error carrying the page id alone.
  - `[medium]` `[patch]` `enqueue` moved a `Running` job back to `Queued`, clearing a live claim so a second worker would run the same pages and pay twice; the update is now scoped to the settled states.
  - `[medium]` `[patch]` A zombie worker returning late could overwrite a newer run's Extraction and verdict — both writes are fenced on the `attempts` value the pass claimed with.
  - `[medium]` `[patch]` A failed cost-row write discarded an already-paid-for payload and retried the whole call; the write is now wrapped and the payload survives.
  - `[medium]` `[patch]` A response with no `usage` block silently recorded a zero-token, zero-micro row for a real call, making the cost table under-report; it is now an upstream fault.
  - `[medium]` `[patch]` Nothing stopped `EXTRACTION_CLAIM_TIMEOUT_MS` being configured at or below `AI_TIMEOUT_MS`, which expires a claim mid-call and double-bills — the runtime refuses it at boot.
  - `[low]` `[patch]` `isStale` was dead production code restating in TypeScript a rule `claimNext` states in SQL; it and its tests were deleted so the rule lives once.
  - `[low]` `[patch]` No array or string in the payload was bounded, so a malformed answer became unbounded writes inside the transaction — ceilings are enforced in the validator.
  - `[low]` `[patch]` The claim predicate cast the status column to text, defeating its own index; it compares against the enum type now.
  - `[low]` `[patch]` `ExtractedQuestion.contextId` was an FK with no index; `@@index([contextId])` added and the migration regenerated.
  - `[low]` `[patch]` The runner had no spec at all — six cases now cover non-overlapping passes, the idle-versus-work reschedule, a swallowed claim error, the disabled worker, and a clean destroy.
  - `[low]` `[patch]` The six call classes were declared twice with nothing asserting they agree; a parity test now pins the tuple to the generated Prisma enum.
  - `[low]` `[patch]` `.env.example` shipped `AI_TRANSPORT=fake` uncommented, which defeats the production guard it sits under; it is commented out with the reason stated.
  - `[low]` `[patch]` The injected-fault integration cases each burned about 1.8 seconds of real backoff; test-tier defaults for `AI_MAX_ATTEMPTS` and `AI_RETRY_BASE_MS` cut them to about 0.1 seconds.
  - `[low]` `[patch]` `statusFor` read the job row and the counts separately, so a re-enqueue landing between them could report `Queued` beside the previous run's counts; both reads share one transaction.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 0
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` The boot guard comparing `EXTRACTION_CLAIM_TIMEOUT_MS` against `AI_TIMEOUT_MS` only accounted for one provider call, not `ai`'s own retry sequence (`AI_MAX_ATTEMPTS` attempts plus backoff) — a claim could still expire mid-retry and double-bill under a config the guard would pass. The check now compares against the worst-case total of the whole retry sequence; `extraction-policy.spec.ts` and `.env.example` updated to match.
  - `[medium]` `[patch]` The pages-gone `ClientFault` branch (`ExtractionTargetMissing` when a job's Ready pages are gone before it runs — the race Epic 8's image-expiry sweep creates) had no test at any tier. Added an `extraction.int-spec.ts` case that deletes a submitted draft's `PageImage` rows before `runOnce()` and asserts `Failed`/`ClientFault`/`retryable: false`/`EXTRACTION_PAGES_GONE`, no stored Extraction, no `AiCall` row, and no further claim.
  - `[medium]` `[patch]` `MAX_CONTEXTS` and `MAX_REGIONS`, unlike every other payload ceiling, had no test forcing the array past its limit. Added two cases to `extraction-payload.spec.ts`'s ceilings block.
  - `[low]` `[patch]` The `AiFailureKind` schema doc comment stated an `UpstreamFault` is unconditionally retryable, but a refused request (`AiRejectedError` — bad key, disallowed model) is deliberately `UpstreamFault` with `retryable: false`, since retrying buys the same refusal. Comment corrected to state the exception; no behavior change.
  - `[low]` `[patch]` The `AiCall.correlationId` comment claimed the extraction job id serves as the correlation "handle" for a worker-run call, but nothing on the row actually links it back to the job that made it — the field is request-scoped and simply stays null. Comment corrected to state the gap rather than a linkage that does not exist.
  - `[low]` `[patch]` `callOpenAi` rejected a missing `usage` block but not one whose `input_tokens`/`output_tokens` are non-numeric, which would compute and silently write `NaN` into the cost row. Now rejected the same way as a missing block, with a covering case in `ai.service.openai.spec.ts`.
  - `[low]` `[patch]` A cost-row write failure inside `AiService.attempt` is deliberately swallowed so a paid-for answer is not thrown away, but nothing exercised that path — added a unit case in `ai.service.spec.ts` with a rejecting `aiCall.create`.
  - `[reject]` `MAX_JOB_ATTEMPTS` is a hardcoded constant while every other `ai`/`extraction` tunable reads from env — deliberate design (a hard ceiling meant to catch a fatal job, not something ops tunes), not a defect.
  - `[reject]` "No end-to-end ceiling on provider spend per job" — `MAX_JOB_ATTEMPTS` (5) × `AI_MAX_ATTEMPTS` (3) already bounds a job to at most 15 calls before terminal failure; the claim of an unbounded loop is false.
  - `[reject]` `ExtractionController.read` uses `ParseUUIDPipe`, answering a malformed id with 400 rather than 404 — matches the established convention on every other `:id` route in this codebase (`source-test.controller.ts`, `student-profile.controller.ts`, `taxonomy.controller.ts`, etc.); not a deviation this story introduced.
  - `[reject]` `readPageBytes`'s unbounded `Promise.all` over pages — already bounded by `MAX_PAGES = 10`; ten small JPEGs in memory at once is not a real risk.
  - `[reject]` The client-level `timeout` and the call-level `AbortSignal.timeout` on the OpenAI call carry the same value — harmless duplication, not a bug.
  - `[reject]` `.env.example`'s `AI_*`/`EXTRACTION_CLAIM_TIMEOUT_MS` cross-variable relationship undocumented — the one relationship that is enforced (claim timeout vs. the retry worst case) is now stated in the comment as part of the claim-timeout patch above; no further doc gap.
  - `[reject]` `@SkipThrottle({ login: true })` on the extraction status route, questioned against polling frequency — matches this codebase's standing convention on every authenticated controller; no evidence of an actual production rate-limit conflict.
  - `[reject]` Rich-text validation rejects only a zero denominator, not a negative numerator/denominator/whole — negative fractions are mathematically valid content (e.g. algebra), not "arithmetic nonsense"; the finding's premise is wrong.
  - `[reject]` `isUniqueViolation` (P2002 matcher) is duplicated across `extraction.service.ts`, `source-test.service.ts` and `uncommitted-state.service.ts` — an established per-module convention predating this story, not a new duplication it introduced.
  - `[reject]` "No code path re-enqueues a failed job despite the 'try again' copy" — `enqueue()` already re-queues a `Failed`/`Succeeded` job idempotently and is covered directly in `extraction.int-spec.ts`'s `re-running` block; the I/O matrix's "Re-run after failure" row is a service-level guarantee, not an HTTP-level one, and nothing in the intent requires a parent-facing retry endpoint in v0.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` `ExtractionService.fail()` classifies a refused (`AiRejectedError`) call as `UpstreamFault`/`retryable: false`, but no test exercised that path — the fake transport has no mode that produces it, and the openai-transport spec only tests `AiService.run`'s own classification, never what `fail()` subsequently writes to the job row. A regression here could ship silently: a permanently-rejected job could be re-tried forever at billed cost. Added an `extraction.int-spec.ts` case that stubs `ai.run` to throw `AiRejectedError` and asserts `Failed`/`UpstreamFault`/`retryable: false`/`EXTRACTION_UPSTREAM_REJECTED`, plus a terminal further-pass check.
  - `[medium]` `[patch]` A refused, non-retryable call (`AiRejectedError` — bad key, disallowed model) was written to the job row with the same `EXTRACTION_FAILED` = "The test could not be read. Try again." reason as a retryable transport fault, telling a parent to do something that cannot help. Added a distinct `EXTRACTION_UPSTREAM_REJECTED` reason for the refused case, wired into `fail()`.
  - `[low]` `[patch]` `callOpenAi`'s `JSON.parse(response.output_text)` fallback (used when `output_parsed` is absent) ran inside the same try block as the request itself, so a malformed-JSON response was classified as `AI_TRANSPORT_FAILED` instead of `AI_SCHEMA_INVALID` — no behavioral difference downstream (both are `UpstreamFault`/retryable, and neither message is logged or surfaced), but the wrong fault is named. The parse now has its own catch that throws `AI_SCHEMA_INVALID`.
  - `[low]` `[patch]` `parseRichText` rejected only a zero-length segment array, not an array whose segments are all present but blank (e.g. `[{kind:'text', value:'  '}]`) — the same "declined to fill it" case an empty array is, spelled with whitespace. Now rejected the same way.
  - `[low]` `[patch]` `SourceTestService`'s doc comment for `requireLive` was stranded above `requireReadable` (a leftover from the method being added), leaving `requireLive` undocumented at its own definition. Comment moved back to sit above `requireLive`; no behavior change.
  - `[reject]` `fakeFailureFrom` has no `NODE_ENV=production` guard unlike `AI_TRANSPORT` — only reachable when `AI_TRANSPORT=fake` is itself explicitly set in production, which is already the deliberate escape hatch that guard exists to allow; not a real gap.
  - `[reject]` `statusFor` can show a `Failed`/in-progress job status beside an older successful run's counts — this is the intentional design already stated in the code's own comment (the Extraction row and the job row have independent lifecycles; the Extraction is designed to outlive its images and is only replaced on the *next* success), not a violation of any stated intent.
  - `[reject]` `fail()`'s `AiInputError` → `EXTRACTION_INPUT_UNUSABLE` mapping is unreachable from `runJob` (which already catches `pages.length === 0` earlier as `ExtractionTargetMissing`) — defensive module-boundary hygiene in `ai.service.ts`, which does not trust its caller to have checked; harmless, not dead code by mistake.
  - `[reject]` No case-insensitive/whitespace normalization of `AI_TRANSPORT`, and no startup log naming the resolved transport — a strict-equality boot check plus a typo failing loudly is the stated design goal ("a mistyped transport has to fail the boot"); an ops-convenience log is a nice-to-have, not a gap.
  - `[reject]` `AiCall` has no index on `callClass` for per-class cost reporting — no such query exists yet in this story's scope; premature.
  - `[reject]` No `jobId`/`extractionId` column links an `AiCall` row back to the extraction that produced it — already stated as a known gap in the code's own comment on `correlationId`, and cost attribution is outside this story's stated boundaries.
  - `[reject]` `ExtractionRunner.pass()` reschedules with `delayMs: 0` uncapped when work was found — speculative; `FOR UPDATE SKIP LOCKED` already bounds concurrency and no evidence of a real tight-loop cost.
  - `[reject]` Duplicate topic labels on one question are stored as separate rows rather than deduplicated — not specified anywhere in the intent; a data-quality nicety, not a defect.
  - `[reject]` The extraction prompt never states the payload's hard ceilings (`MAX_QUESTIONS`, etc.) — speculative prompt-engineering preference; the ceilings are enforced regardless, and no test approaches them.
  - `[reject]` `STORE_TIMEOUT_MS`/`STORE_MAX_WAIT_MS` are hardcoded, unlike other `extraction`/`ai` timings — a deliberate transaction-safety ceiling, not a tunable ops would need day one.
  - `[reject]` `AI_MODEL_*` values are not validated against a known-model allowlist at boot, only checked non-empty — a typo'd model id fails on the first real call (`AiRejectedError`), which is an accepted tradeoff, not silent.
  - `[reject]` `plainTextOf` is exported and unit-tested but has no caller in this diff — a deliberately-scoped utility the status route (which returns counts only, never content, per AD-3) has no reason to call yet; not dead code by accident.
  - `[reject]` `response.usage.input_tokens`/`output_tokens` are checked for `typeof === 'number'` but not finiteness or sign — speculative; a well-formed provider response does not emit negative or non-finite usage figures, and every other numeric trust boundary in this diff is handled the same way.

## Design Notes

**Why the job table is the queue rather than pg-boss.** AD-5 requires that enqueueing work and mutating state share one transaction, because FR-31 charges on successful production and "job succeeded, debit did not" must be impossible. `pg-boss` owns its own pool and cannot enlist in a Prisma transaction, so using it here would break the one rule the decision exists to protect. A job row written by the same `tx` that flips the Source Test to `Submitted`, claimed with `FOR UPDATE SKIP LOCKED`, satisfies AD-5 exactly and keeps the substrate in the application database as the decision demands. AD-33's `pg-boss` schedules are for the FR-32 and FR-35 sweeps and arrive with them; this story does not pre-install a scheduler it has no schedule for.

**Why `forwardRef` between `sourcetest` and `extraction`.** The dependency really is mutual: `submit` must enqueue, and the job must read page bytes. The alternatives — a Prisma delegate reach-across, or bytes copied into the job row — each break a decision (AD-17, AD-20). `forwardRef` in both module declarations plus `@Inject(forwardRef(…))` on the one injected service is Nest's sanctioned expression of a genuine cycle, and it keeps each entity with exactly one writer.

**Why `usable` is computed and never read.** AD-30's rule is that a schema-valid payload is not a trusted payload. A model asked "is this question usable?" would answer, and the answer would be the thing Epic 3.6 warns on and Epic 4 generates from. Deriving it in code from two observable facts — a declared dependency on an uninterpretable region, and a low self-assessed confidence — makes the threshold a line of code with a unit test rather than a model's opinion.

**Why rich text rather than a fraction table.** AD-32 makes the structured emission a *schema* constraint on every text-bearing field, and a question prompt, a choice and a passage all need it. One `Json` column per field holding a validated segment array is a single mechanism with a single Zod parser; a side table keyed polymorphically to three parents would be three mechanisms and a join for every read. `plainTextOf` keeps a plain rendering one call away without ever making the plain string the stored form.

**Why the status route returns counts and nothing else.** The epic states that Extraction is not a browsable product surface in v0, and AD-3 states that progress surfaces read job status. Counts plus a status satisfy the second without conceding the first, and they are exactly what Story 3.6's warning and Epic 4's generate step will read. Question content has no read path in this story at all.

## Verification

**Commands:**
- `pnpm install` -- expected: `openai@7.8.0` and `zod@4.6.5` resolve and the lockfile updates.
- `pnpm --filter api exec prisma migrate dev --name add_ai_call_and_extraction` -- expected: a new checked-in migration directory; `pnpm db:migrate` replays it clean.
- `pnpm typecheck` -- expected: no errors in either workspace.
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm test` -- expected: the new `ai-config.spec.ts`, `ai.service.spec.ts`, `rich-text.spec.ts`, `extraction-payload.spec.ts` and `extraction-policy.spec.ts` pass with the rest.
- `pnpm --filter api run test:int` -- expected: `extraction.int-spec.ts` and the extended `source-test.int-spec.ts` pass against real Postgres, every matrix row covered.
- `pnpm exec playwright test e2e/tests/parent-capture.spec.ts` -- expected: passes against the full stack with the default `fake` transport and the worker enabled.

## Auto Run Result

**Summary:** Third automated review pass on the already-implemented Story 3.5 (Structured Extraction). No code changes this pass came from re-implementation — this was a review-only pass over the diff since `9ce972f10da2149f72060884d53a51faecca3c1f`, running four parallel review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) and triaging their findings.

**Files changed this pass:**
- `apps/api/src/ai/ai.service.ts` -- `callOpenAi`'s `JSON.parse` fallback now has its own catch, classifying malformed JSON output as `AI_SCHEMA_INVALID` instead of `AI_TRANSPORT_FAILED`.
- `apps/api/src/extraction/extraction-policy.ts` -- added `EXTRACTION_UPSTREAM_REJECTED`, a distinct failure-reason string for a provider-refused (non-retryable) job.
- `apps/api/src/extraction/extraction.service.ts` -- `fail()` writes `EXTRACTION_UPSTREAM_REJECTED` instead of the "try again" `EXTRACTION_FAILED` copy when the fault is a refusal.
- `apps/api/test/extraction.int-spec.ts` -- added a case covering a refused (`AiRejectedError`) call: `Failed`/`UpstreamFault`/`retryable: false`/`EXTRACTION_UPSTREAM_REJECTED`, terminal on a further pass.
- `apps/api/src/extraction/rich-text.ts` -- `parseRichText` now also rejects an all-blank segment array (every segment present but empty/whitespace), not only a zero-length one.
- `apps/api/src/sourcetest/source-test.service.ts` -- moved `requireLive`'s stranded doc comment back onto `requireLive` itself; no behavior change.

**Review findings breakdown (this pass):** 5 patched (2 medium, 3 low), 0 deferred, 14 rejected (all low; see Review Triage Log above for detail), 0 intent gaps, 0 spec amendments.

**Follow-up review recommendation:** `true`. This pass's patched findings: high 0, medium 2, low 3. Score = 3×2 + 1×3 = 9 (>= 5 threshold).

**Verification performed:**
- `pnpm vitest run` on `ai.service.spec.ts`, `ai.service.openai.spec.ts`, `rich-text.spec.ts`, `extraction-payload.spec.ts` -- 82 passed.
- `pnpm vitest run test/extraction.int-spec.ts` -- 32 passed, including the new refusal case.
- `pnpm vitest run test/source-test.int-spec.ts` -- 64 passed (unaffected by the doc-comment move).
- `pnpm tsc --noEmit` -- no errors.
- `pnpm exec eslint` directly on every file this pass touched -- clean. (The `pnpm --filter api run lint` wrapper script reports a fatal parsing error across the entire workspace, including files untouched by this or any prior pass — a pre-existing environment/config issue, not caused by this change; direct `eslint` invocation on the touched files is clean.)

**Residual risks:**
- The `pnpm --filter api run lint` script itself does not run cleanly in this environment (see above); it is unrelated to this story's diff and outside this pass's scope to fix.
- Two pre-existing issues remain logged in frontmatter `deferred` from the prior pass (an intermittent PIN-cooldown integration test flake, and a Submitted Source Test TTL 404 risk on the general Source Test read path) — neither touched by this pass, both outside this story's scope.
- The working copy was not fully clean at commit time: `_bmad-output/implementation-artifacts/deferred-work.md` and `sprint-status.yaml` were already modified, and `spec-3-4-legibility-check-upload-commit.md` already untracked, before this run started, and none are part of this story's diff or writable by build-auto. Left as-is rather than committed or reverted.
