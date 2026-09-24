import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ZodType } from 'zod';
import { currentCorrelationId } from '../common/correlation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AiCallClassName,
  type AiConfig,
  type AiFakeFailure,
  type ModelPin,
  costMicrosFor,
  fakeFailureFrom,
  resolveAiConfig,
} from './ai-config.js';

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

/** What a transport hands back before the schema has had a say. */
interface RawCompletion {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
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

    let lastFault: AiUpstreamError = new AiUpstreamError(AI_TRANSPORT_FAILED);
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        return await this.attempt(request, pin);
      } catch (cause) {
        // Neither of these is made better by being asked again.
        if (cause instanceof AiInputError || cause instanceof AiRejectedError) throw cause;
        lastFault =
          cause instanceof AiUpstreamError ? cause : new AiUpstreamError(AI_TRANSPORT_FAILED);
        // The call class and the attempt number, and nothing about the images
        // or the answer (AD-20).
        this.logger.warn(
          `An ${request.callClass} call failed on attempt ${attempt} of ${this.config.maxAttempts}.`,
        );
        if (attempt < this.config.maxAttempts) {
          await sleep(this.config.retryBaseMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastFault;
  }

  // --- Internals ---------------------------------------------------------

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

  /** The only writer of `ai_call`. Identifiers, counts and money only (AD-20). */
  private async recordCall<T>(request: AiRunRequest<T>, usage: AiUsage): Promise<void> {
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
    // `maxRetries: 0` because this module is the retry authority and the SDK's
    // default of 2 would silently multiply: three of our attempts against three
    // of its own is nine billed vision calls behind one cost row.
    const client = (this.client ??= new OpenAI({
      apiKey: this.config.apiKey!,
      maxRetries: 0,
      timeout: this.config.timeoutMs,
    }));
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
      // This module's own verdicts pass through: they have already been
      // classified and their messages are already content-free.
      if (cause instanceof AiUpstreamError || cause instanceof AiRejectedError) throw cause;

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
        this.logger.error(`An ${request.callClass} call was refused by the provider (${status}).`);
        throw new AiRejectedError(AI_REQUEST_REJECTED, status);
      }
      if (status !== undefined) {
        this.logger.warn(`An ${request.callClass} call failed upstream (${status}).`);
      }
      // Transport error, timeout, 429, 5xx: one retryable fault class.
      throw new AiUpstreamError(AI_TRANSPORT_FAILED);
    }
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
