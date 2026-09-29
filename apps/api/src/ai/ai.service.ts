import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ZodType } from 'zod';
import { currentCorrelationId } from '../common/correlation.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import {
  type AiCallClassName,
  type AiConfig,
  type AiFakeFailure,
  type ModelPin,
  costMicrosFor,
  fakeFailureFrom,
  resolveAiConfig,
} from './ai-config.js';
import { fakeEmbedding } from './fake-embedding.js';

/**
 * The provider's fault (AD-31): a transport error, a timeout, a non-OK
 * response, or a payload the schema rejects. Retried with backoff inside this
 * service, and on exhaustion it is what the caller sees — which is what makes
 * the resulting job failure retryable.
 *
 * Its message states the class of fault and nothing else. No provider string,
 * no payload fragment and no image byte ever reaches a message, a log line or a
 * cost row (AD-20).
 */
export class AiUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUpstreamError';
  }
}

/**
 * The request's own fault: a call this service cannot make at all. Never
 * retried, because a second identical request is identically impossible.
 */
export class AiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiInputError';
  }
}

/**
 * The provider refused the request itself: a bad key, a revoked key, a model
 * this account cannot use, a request the API considers malformed.
 *
 * Deliberately **not** an `AiUpstreamError`: every one of those is a fact about
 * this deployment rather than a passing outage, so retrying it three times
 * spends three timeouts to be told the same thing. It fails on the first
 * answer, loudly.
 */
export class AiRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiRejectedError';
  }
}

export const AI_TRANSPORT_FAILED = 'The AI provider could not be reached.';
export const AI_SCHEMA_INVALID = 'The AI provider answered with a payload the schema rejects.';
export const AI_NO_IMAGES = 'An AI vision call needs at least one image.';
/**
 * A text call that arrived carrying images. Refused rather than silently
 * ignored: the modality is what decides how the request is built and what the
 * fake's token figures are derived from, so a request whose two halves
 * disagree is a caller mistake, not a thing to guess at.
 */
export const AI_TEXT_CALL_HAS_IMAGES = 'An AI text call must carry no images.';
export const AI_REQUEST_REJECTED = 'The AI provider refused the request.';
export const AI_USAGE_MISSING = 'The AI provider answered without reporting what it spent.';
/**
 * An embedding call with nothing to embed. Refused rather than answered with a
 * zero vector: a zero vector compares equal to nothing and would be cached as a
 * real one, so the caller would pay for a row that can never match again.
 */
export const AI_NO_EMBEDDING_TEXT = 'An AI embedding call needs some text.';
/** An embedding response that carried no vector, or one that is not numbers. */
export const AI_EMBEDDING_MISSING = 'The AI provider answered without an embedding.';

/**
 * The 4xx statuses that are still worth retrying: a rate limit and a request
 * timeout are both "not now", not "not ever". Every other 4xx is a standing
 * fact about the request or the credential.
 */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 429]);

/** An SDK fault's HTTP status, if it carried one. */
function statusOf(cause: unknown): number | undefined {
  const status = (cause as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The two kinds of call this service makes. Explicit at every call site: never
 * given a default, because a default is how a vision call that lost its images
 * becomes a text call nobody noticed.
 */
export type AiModality = 'vision' | 'text';

/** One image as a call carries it. Bytes, never a storage path (AD-15). */
export interface AiImage {
  ordinal: number;
  buffer: Buffer;
  mimeType: string;
}

/** What a completed call cost and how long it took. Never what it said. */
export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
}

export interface AiRunRequest<T> {
  callClass: AiCallClassName;
  /** Whose cost row this is. From `req.elevated` or from the job's own row. */
  parentAccountId: string;
  /**
   * What kind of call this is, stated at every call site and never defaulted.
   *
   * `vision` reads images; `text` reads only the prompt. It is required rather
   * than inferred from an empty `images` array because the two failures are
   * opposite: a vision call that forgot its images must be refused, and a text
   * call has none by construction. Inferring would silently turn the first into
   * the second.
   */
  modality: AiModality;
  /**
   * Sent in the order given, which the caller has already made page order.
   * Empty — and required to be empty — on a `text` call.
   */
  images: AiImage[];
  /** The prompt text, which lives in the calling domain module (AD-17). */
  prompt: string;
  schema: ZodType<T>;
  /** The name the structured-output format is declared under. */
  schemaName: string;
  /**
   * What the `fake` transport answers with, given the image count and the
   * injected failure mode.
   *
   * The builder lives with the caller for the same reason the prompt does: the
   * shape of a valid answer is domain knowledge, and this module would
   * otherwise have to know what an Extraction is. This module keeps what is
   * genuinely its own — the failure policy, the schema parse, and the cost row.
   */
  fakePayload: (context: { imageCount: number; failure: AiFakeFailure }) => unknown;
}

export interface AiRunResult<T> {
  payload: T;
  usage: AiUsage;
}

/**
 * One embedding call. No schema, no fake-payload builder and no modality: an
 * embedding has one input and one shape of answer, so there is nothing for a
 * caller to state about it beyond the text and whose cost row it is.
 */
export interface AiEmbedRequest {
  /**
   * Which class of work this embedding serves, stated by the caller exactly as on
   * a `run` and never defaulted here.
   *
   * An embedding is not a class of its own: it is a *means*, and the cost row has
   * to say which piece of product work spent the money. Defaulting it to the one
   * caller that exists today would make the second caller's cost silently land on
   * the first caller's ledger line.
   */
  callClass: AiCallClassName;
  /** The text to embed. Refused when blank. */
  text: string;
  /** Whose cost row this is, exactly as on a `run`. */
  parentAccountId: string;
}

export interface AiEmbedResult {
  /** The vector, as plain numbers. */
  vector: number[];
  /**
   * What it cost, how long it took, and — in `usage.model` — the embedding
   * snapshot actually sent. The caller caches that alongside the vector, because
   * vectors from two models are not comparable and a re-pin has to leave the old
   * ones visibly stale rather than silently mixed in.
   */
  usage: AiUsage;
}

/** What a transport hands back before the schema has had a say. */
interface RawCompletion {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** What an embedding transport hands back. No output tokens: there are none. */
interface RawEmbedding {
  vector: number[];
  inputTokens: number;
}

/** The fake's vision token figures: deterministic, derived from the image count. */
const FAKE_INPUT_TOKENS_PER_IMAGE = 800;
const FAKE_OUTPUT_TOKENS_PER_IMAGE = 400;

/**
 * The fake's text token figures, derived from the prompt's own length.
 *
 * A text call carries no images, so the vision arithmetic would report every
 * Generation call as free — and a cost table that says a call cost nothing is
 * worse than one missing the row, because nothing about it looks wrong. Four
 * characters to a token is the usual rough conversion; the point is only that
 * the figure is positive, deterministic and proportional to what was sent.
 */
const FAKE_CHARS_PER_TOKEN = 4;
/** What the answer is assumed to cost against what was asked. */
const FAKE_OUTPUT_TOKENS_PER_INPUT_TOKEN = 0.5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one place a provider call is made and the one writer of `ai_call`
 * (AD-17, AD-20, AD-22).
 *
 * Four rules hold every path here together:
 *
 * - The client, the pinned snapshot, the timeout and the retry policy are
 *   resolved once at boot. A domain module hands over a typed request and gets
 *   a typed payload; it never sees an SDK type, a model id or an API key.
 * - Structured output goes through the Responses API with a JSON schema built
 *   from Zod by `zodTextFormat` (AD-9). Never Chat Completions, never legacy
 *   `json_object`.
 * - Exactly one `ai_call` row per **completed** call — one whose payload
 *   actually parsed. A fault that was retried to exhaustion produced no usable
 *   answer and writes nothing, so the cost table never shows a charge for work
 *   that was thrown away.
 * - No message, no log line and no row carries an image byte or a fragment of
 *   what the model said. Identifiers, counts and money only.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  readonly config: AiConfig;
  private client: OpenAI | null = null;

  constructor(private readonly prisma: PrismaService) {
    // Init-time, not call-time: a bad value fails the boot, not a parent.
    this.config = resolveAiConfig();
  }

  /**
   * One provider call, retried on an upstream fault with exponential backoff.
   *
   * An `AiInputError` and an `AiRejectedError` escape immediately: a request
   * this service cannot make, and one the provider has already refused on its
   * merits, are not made better by making them again.
   */
  async run<T>(request: AiRunRequest<T>): Promise<AiRunResult<T>> {
    // Gated on the modality rather than on the array alone: a vision call with
    // no images cannot be made, and a text call carrying them is a caller whose
    // request contradicts itself. Neither is retried.
    if (request.modality === 'vision' && request.images.length === 0) {
      throw new AiInputError(AI_NO_IMAGES);
    }
    if (request.modality === 'text' && request.images.length > 0) {
      throw new AiInputError(AI_TEXT_CALL_HAS_IMAGES);
    }
    const pin = this.config.pins[request.callClass];
    return this.withRetries(request.callClass, () => this.attempt(request, pin));
  }

  /**
   * One embedding, retried on an upstream fault exactly as `run` is.
   *
   * It is here rather than in `topics` because this module is the only
   * constructor of a provider client and the only writer of `ai_call` (AD-17,
   * AD-20), and an embedding is a provider call that costs money like any other.
   *
   * It writes its cost row under the **caller's own call class** and under the
   * embedding snapshot rather than that class's pin: one class, two models, and the
   * row says which one it paid for. Output tokens are zero because an embedding
   * returns a vector, not tokens.
   *
   * No schema and no fake-payload builder: there is one shape of answer, and it
   * is numbers. The caller gets `number[]` and never an SDK type.
   */
  async embed(request: AiEmbedRequest): Promise<AiEmbedResult> {
    // Refused before any attempt, and never retried: a second blank is blank.
    if (request.text.trim() === '') throw new AiInputError(AI_NO_EMBEDDING_TEXT);
    const pin = this.config.embeddingPin;
    return this.withRetries(request.callClass, () => this.attemptEmbedding(request, pin));
  }

  /**
   * The embedding snapshot `embed` would send right now.
   *
   * Exposed because of one thing a caller genuinely cannot decide without it: a
   * cached vector is comparable with a fresh one only when both came from the same
   * snapshot, so a caller holding stale vectors would otherwise have to *buy* an
   * embedding to discover that it has nothing to compare it against. This is the
   * whole of what leaks — an opaque token to compare for equality — and no pin,
   * price, key or SDK type goes with it.
   */
  get embeddingModel(): string {
    return this.config.embeddingPin.model;
  }

  /**
   * Removes this account's cost rows (Story 8.4), inside the caller's
   * transaction, and answers how many went.
   *
   * **The one thing account deletion erases that profile deletion does not.**
   * `AiCall` is the only `Restrict` child of `ParentAccount` that is not
   * profile-scoped, so it would block the account delete outright — and it is a
   * longitudinal per-account activity trace, which is exactly what FR-33 says
   * does not survive. On a *profile* deletion there is nothing to do here: the
   * row carries no child id, so it is already anonymous with respect to the
   * child that went.
   *
   * It lives here because `ai` is the sole owner and sole writer of `ai_call`
   * (AD-17, AD-20): the `deletion` module decides the order and this service
   * performs the one write it owns. Nothing outside it holds this delegate.
   *
   * **A future spend ceiling must not read this table.** AD-23's global ceiling
   * does not exist yet; when it is built it has to read an account-anonymous
   * aggregate, because a figure derived from rows that are erased with their
   * account would fall when an account is deleted — and a ceiling that can be
   * lowered by deleting an account is not a ceiling. That is Epic 9's problem and
   * deliberately not a column this story adds.
   */
  async purgeForAccount(tx: TransactionClient, parentAccountId: string): Promise<number> {
    const removed = await tx.aiCall.deleteMany({ where: { parentAccountId } });
    return removed.count;
  }

  // --- Internals ---------------------------------------------------------

  /**
   * The retry policy, shared by `run` and `embed` so there is one of it.
   *
   * An `AiInputError` and an `AiRejectedError` escape immediately: a request this
   * service cannot make, and one the provider has already refused on its merits,
   * are not made better by making them again. Every log line carries the call
   * class and the attempt number and nothing else (AD-20).
   */
  private async withRetries<R>(callClass: AiCallClassName, attempt: () => Promise<R>): Promise<R> {
    let lastFault: AiUpstreamError = new AiUpstreamError(AI_TRANSPORT_FAILED);
    for (let tries = 1; tries <= this.config.maxAttempts; tries += 1) {
      try {
        return await attempt();
      } catch (cause) {
        // Neither of these is made better by being asked again.
        if (cause instanceof AiInputError || cause instanceof AiRejectedError) throw cause;
        lastFault =
          cause instanceof AiUpstreamError ? cause : new AiUpstreamError(AI_TRANSPORT_FAILED);
        // The call class and the attempt number, and nothing about the images
        // or the answer (AD-20).
        this.logger.warn(
          `An ${callClass} call failed on attempt ${tries} of ${this.config.maxAttempts}.`,
        );
        if (tries < this.config.maxAttempts) {
          await sleep(this.config.retryBaseMs * 2 ** (tries - 1));
        }
      }
    }
    throw lastFault;
  }

  /** Dispatch, parse, then — and only then — the cost row. */
  private async attempt<T>(request: AiRunRequest<T>, pin: ModelPin): Promise<AiRunResult<T>> {
    const startedAt = Date.now();
    const completion =
      this.config.transport === 'openai'
        ? await this.callOpenAi(request, pin)
        : this.callFake(request);
    const latencyMs = Date.now() - startedAt;

    // A schema-invalid payload is the provider's fault, never the caller's
    // (AD-31): the model was asked for a shape and answered with another one.
    const parsed = request.schema.safeParse(completion.raw);
    if (!parsed.success) throw new AiUpstreamError(AI_SCHEMA_INVALID);

    const usage: AiUsage = {
      model: pin.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      costMicros: costMicrosFor(pin, completion.inputTokens, completion.outputTokens),
      latencyMs,
    };
    // The call is already made and already billed by the provider. A cost row
    // that could not be written is an accounting problem to shout about, not a
    // reason to throw away a paid-for answer and buy it again.
    try {
      await this.recordCall(request, usage);
    } catch {
      this.logger.error(
        `The cost row for an ${request.callClass} call could not be written. The call completed and is not recorded.`,
      );
    }
    return { payload: parsed.data, usage };
  }

  /**
   * One embedding: dispatch, check the shape, then — and only then — the cost row.
   *
   * The same order `attempt` uses and for the same reason: a row is written for a
   * *completed* call, so a fault retried to exhaustion never appears in the cost
   * table as a charge for work that was thrown away.
   */
  private async attemptEmbedding(request: AiEmbedRequest, pin: ModelPin): Promise<AiEmbedResult> {
    const startedAt = Date.now();
    const completion =
      this.config.transport === 'openai'
        ? await this.embedOpenAi(request, pin)
        : this.embedFake(request);
    const latencyMs = Date.now() - startedAt;

    const usage: AiUsage = {
      model: pin.model,
      inputTokens: completion.inputTokens,
      // Zero, and stated: an embedding returns a vector, not tokens.
      outputTokens: 0,
      costMicros: costMicrosFor(pin, completion.inputTokens, 0),
      latencyMs,
    };
    // Already made and already billed. A cost row that could not be written is an
    // accounting problem to shout about, not a reason to buy the vector again.
    try {
      await this.recordCall(request, usage);
    } catch {
      this.logger.error(
        `The cost row for an ${request.callClass} embedding could not be written. The call completed and is not recorded.`,
      );
    }
    return { vector: completion.vector, usage };
  }

  /** The embeddings endpoint. The text goes out; a vector comes back. */
  private async embedOpenAi(request: AiEmbedRequest, pin: ModelPin): Promise<RawEmbedding> {
    const client = this.openAiClient();
    try {
      // Trimmed, exactly as `embedFake` trims: the vector and the token count
      // must agree on what was actually sent, and two labels that differ only
      // in surrounding whitespace must embed and bill identically.
      const text = request.text.trim();
      const response = await client.embeddings.create(
        { model: pin.model, input: text },
        { signal: AbortSignal.timeout(this.config.timeoutMs) },
      );
      const vector = response.data?.[0]?.embedding;
      // A response with no vector in it is the provider's fault and retryable:
      // the alternative is caching `[]` as this label's embedding, which would
      // compare equal to nothing forever after.
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new AiUpstreamError(AI_EMBEDDING_MISSING);
      }
      if (
        !vector.every((component) => typeof component === 'number' && Number.isFinite(component))
      ) {
        throw new AiUpstreamError(AI_EMBEDDING_MISSING);
      }
      // Defaulted to zero nowhere, for the reason `callOpenAi` states: a real
      // call written into the cost table as free is worse than a missing row.
      // A present-but-non-positive count is the same fault in a different
      // shape — a vector was genuinely bought and must not be cached as a free
      // or negative-cost row.
      if (
        !response.usage ||
        typeof response.usage.prompt_tokens !== 'number' ||
        response.usage.prompt_tokens <= 0
      ) {
        throw new AiUpstreamError(AI_USAGE_MISSING);
      }
      return { vector, inputTokens: response.usage.prompt_tokens };
    } catch (cause) {
      throw this.classifyOpenAiFault(cause, request.callClass);
    }
  }

  /**
   * The fake's embedding (AD-22).
   *
   * `fakeEmbedding` is the substance and lives in its own file, because making
   * *similar* labels similar is the whole reason the fake exists and is worth a
   * unit spec of its own. What is here is the part that belongs to the transport:
   * the failure latch and the token figure.
   *
   * Only `transport` is honoured. `schema` has no meaning — there is no schema to
   * reject a vector — and `unusable` belongs to the stage-3 call, where the
   * caller's own fake payload spends it. Both are passed over rather than
   * repurposed, so a spec that latches one for a `run` does not silently break an
   * `embed` on the way there.
   */
  private embedFake(request: AiEmbedRequest): RawEmbedding {
    if (fakeFailureFrom() === 'transport') throw new AiUpstreamError(AI_TRANSPORT_FAILED);
    // The trimmed string, which is the one the refusal above tested and the one the
    // vector is built from. Billing the untrimmed text would charge for whitespace
    // that never reached the arithmetic, and would make two labels that embed
    // identically cost differently.
    const text = request.text.trim();
    return {
      vector: fakeEmbedding(text),
      inputTokens: Math.max(1, Math.ceil(text.length / FAKE_CHARS_PER_TOKEN)),
    };
  }

  /** The only writer of `ai_call`. Identifiers, counts and money only (AD-20). */
  private async recordCall(
    request: { callClass: AiCallClassName; parentAccountId: string },
    usage: AiUsage,
  ): Promise<void> {
    await this.prisma.aiCall.create({
      data: {
        parentAccountId: request.parentAccountId,
        callClass: request.callClass,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costMicros: usage.costMicros,
        latencyMs: usage.latencyMs,
        // Request-scoped (an HTTP correlation id minted per inbound request),
        // so a worker-run job has none and this stays null — nothing on this
        // row ties a worker-triggered call back to the job that made it; that
        // linkage does not exist yet.
        correlationId: currentCorrelationId() ?? null,
      },
    });
  }

  /**
   * The Responses API with a Zod-derived JSON schema (AD-9), every image sent
   * inline as a data URL in the order the caller gave.
   */
  private async callOpenAi<T>(request: AiRunRequest<T>, pin: ModelPin): Promise<RawCompletion> {
    const client = this.openAiClient();
    try {
      const response = await client.responses.parse(
        {
          model: pin.model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: request.prompt },
                // A text call has no images by the guard in `run`, so this
                // spreads to nothing and the request is prompt-only.
                ...request.images.map((image) => ({
                  type: 'input_image' as const,
                  detail: 'auto' as const,
                  image_url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
                })),
              ],
            },
          ],
          text: { format: zodTextFormat(request.schema as never, request.schemaName) },
        },
        { signal: AbortSignal.timeout(this.config.timeoutMs) },
      );
      // Defaulting a missing usage block to zero would write a real call into
      // the cost table as free, and a cost table that under-reports is worse
      // than one that is missing a row. A present block with non-numeric
      // counts is the same problem in a different shape — `costMicrosFor`
      // would compute `NaN` and write it, silently, rather than raise it.
      if (
        !response.usage ||
        typeof response.usage.input_tokens !== 'number' ||
        typeof response.usage.output_tokens !== 'number'
      ) {
        throw new AiUpstreamError(AI_USAGE_MISSING);
      }
      let raw: unknown;
      try {
        // Handed to the same `safeParse` the fake's answer goes through, so the
        // SDK's own parse is never the thing this module trusts.
        raw = response.output_parsed ?? JSON.parse(response.output_text);
      } catch {
        // Malformed JSON text is a schema fault, not a transport one — the
        // response arrived fine, it just isn't the shape asked for.
        throw new AiUpstreamError(AI_SCHEMA_INVALID);
      }
      return {
        raw,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (cause) {
      throw this.classifyOpenAiFault(cause, request.callClass);
    }
  }

  /**
   * The one client, built once. `maxRetries: 0` because this module is the retry
   * authority and the SDK's default of 2 would silently multiply: three of our
   * attempts against three of its own is nine billed calls behind one cost row.
   */
  private openAiClient(): OpenAI {
    return (this.client ??= new OpenAI({
      apiKey: this.config.apiKey!,
      maxRetries: 0,
      timeout: this.config.timeoutMs,
    }));
  }

  /**
   * One SDK fault, classified. Shared by every `openai` path so that a refusal
   * and an outage are told apart the same way whatever endpoint was called.
   *
   * Returns the verdict rather than throwing it, so each call site's `catch` reads
   * as the `throw` it is.
   */
  private classifyOpenAiFault(cause: unknown, callClass: AiCallClassName): Error {
    // This module's own verdicts pass through: they have already been
    // classified and their messages are already content-free.
    if (cause instanceof AiUpstreamError || cause instanceof AiRejectedError) return cause;

    const status = statusOf(cause);
    // A refused request — a bad key, a model this account cannot use, a body
    // the API will not accept — is a standing fact, not an outage. The status
    // is logged because it is the only thing that tells the two apart; not one
    // word of the provider's own message goes with it (AD-20).
    if (
      status !== undefined &&
      status >= 400 &&
      status < 500 &&
      !RETRYABLE_CLIENT_STATUSES.has(status)
    ) {
      this.logger.error(`An ${callClass} call was refused by the provider (${status}).`);
      return new AiRejectedError(AI_REQUEST_REJECTED, status);
    }
    if (status !== undefined) {
      this.logger.warn(`An ${callClass} call failed upstream (${status}).`);
    }
    // Transport error, timeout, 429, 5xx: one retryable fault class.
    return new AiUpstreamError(AI_TRANSPORT_FAILED);
  }

  /**
   * The seam every test tier runs on (AD-22). It can fail as well as succeed,
   * because a transport that only ever succeeds tests only half the code.
   *
   * The failure mode is read per call rather than at boot, so one booted
   * application can be driven through a success, a transport fault and a
   * schema fault in sequence.
   */
  private callFake<T>(request: AiRunRequest<T>): RawCompletion {
    const failure = fakeFailureFrom();
    if (failure === 'transport') throw new AiUpstreamError(AI_TRANSPORT_FAILED);

    const imageCount = request.images.length;
    // Figures from whatever the call actually carried: images for a vision
    // call, the prompt's length for a text one. Never zero for a real call.
    const inputTokens =
      request.modality === 'vision'
        ? FAKE_INPUT_TOKENS_PER_IMAGE * imageCount
        : Math.max(1, Math.ceil(request.prompt.length / FAKE_CHARS_PER_TOKEN));
    const outputTokens =
      request.modality === 'vision'
        ? FAKE_OUTPUT_TOKENS_PER_IMAGE * imageCount
        : Math.max(1, Math.ceil(inputTokens * FAKE_OUTPUT_TOKENS_PER_INPUT_TOKEN));
    return {
      // A shape no domain schema admits: the fake's way of being a model that
      // answered with something else.
      raw:
        failure === 'schema' ? { unparseable: true } : request.fakePayload({ imageCount, failure }),
      inputTokens,
      outputTokens,
    };
  }
}
