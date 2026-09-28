/**
 * Every figure the `ai` module owns, stated once: which transport is in force,
 * which model snapshot each call class is pinned to, what that snapshot costs,
 * how long a call may take, and how many times an upstream fault is retried.
 *
 * Everything here is pure and reads an env **object** rather than
 * `process.env`, exactly as `resolveMailConfig` does, for the same reason: the
 * figures are the whole point of the file, so they have to be assertable
 * without building a Nest module, and a mistyped transport has to fail the boot
 * rather than the first parent to upload a page.
 */

/** The two transports (AD-22). `fake` is the seam every test tier runs on. */
export const AI_TRANSPORTS = ['fake', 'openai'] as const;
export type AiTransport = (typeof AI_TRANSPORTS)[number];

/**
 * The call classes. Each carries its own pinned snapshot and its own price
 * (AD-8, AD-17) — this is the list of classes the product has, not the list it
 * makes calls for today. It is kept in step with the `AiCallClass` enum by
 * being the thing the cost row's column is written from.
 */
export const AI_CALL_CLASSES = [
  'Extraction',
  'Generation',
  'Grading',
  'Explanation',
  'Legibility',
  'TopicNormalization',
] as const;
export type AiCallClassName = (typeof AI_CALL_CLASSES)[number];

/** What the fake transport is told to do, read per call so a test can drive it. */
export const AI_FAKE_FAILURES = ['none', 'transport', 'schema', 'unusable'] as const;
export type AiFakeFailure = (typeof AI_FAKE_FAILURES)[number];

/** One pinned snapshot and what a million tokens of it costs, in micros. */
export interface ModelPin {
  model: string;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
}

/**
 * The AD-8 aliases, and the note AD-8 attaches to them: an alias is not a
 * snapshot. Each must be replaced with a resolved snapshot id before a
 * production deploy, which is why `.env.example` carries an override for every
 * one of them and why the model actually sent is recorded on every cost row.
 *
 * `sol` is the capable vision-and-reasoning pin, which is what reading a
 * photographed paper test and generating from it need; `terra` is the mid pin
 * the grading and explanation classes take; `luna` is the cheap, fast pin for
 * the two classes that answer a narrow question about something already read.
 */
export const DEFAULT_MODEL_PINS: Readonly<Record<AiCallClassName, ModelPin>> = {
  Extraction: {
    model: 'gpt-5.6-sol',
    inputMicrosPerMillion: 1_250_000,
    outputMicrosPerMillion: 10_000_000,
  },
  Generation: {
    model: 'gpt-5.6-sol',
    inputMicrosPerMillion: 1_250_000,
    outputMicrosPerMillion: 10_000_000,
  },
  Grading: {
    model: 'gpt-5.6-terra',
    inputMicrosPerMillion: 250_000,
    outputMicrosPerMillion: 2_000_000,
  },
  Explanation: {
    model: 'gpt-5.6-terra',
    inputMicrosPerMillion: 250_000,
    outputMicrosPerMillion: 2_000_000,
  },
  Legibility: {
    model: 'gpt-5.6-luna',
    inputMicrosPerMillion: 50_000,
    outputMicrosPerMillion: 400_000,
  },
  TopicNormalization: {
    model: 'gpt-5.6-luna',
    inputMicrosPerMillion: 50_000,
    outputMicrosPerMillion: 400_000,
  },
};

/**
 * The embedding snapshot stage 2 of the AD-11 cascade compares against.
 *
 * **A pin of its own rather than a sixth call class.** An embedding is not a
 * structured-output call and cannot be pinned by one: it is the *same* call
 * class — `TopicNormalization` — served by a completely different model, and a
 * cost row has to record which of the two it actually paid for. So the class
 * keeps its `DEFAULT_MODEL_PINS` entry for the stage-3 call, and this is the
 * snapshot `embed` sends and records.
 *
 * `outputMicrosPerMillion` is zero, and literally rather than by omission: an
 * embedding returns a vector, not tokens, so there is no output side to price.
 * Keeping the field means `costMicrosFor` stays the one arithmetic every row is
 * computed by, and a zero times zero output is the honest figure rather than an
 * invented one. It is deliberately not overridable from the environment for the
 * same reason — there is no price to override.
 *
 * `text-embedding-3-small` is a resolved snapshot id and not an AD-8 alias, so
 * unlike every entry above it this one needs no pre-deploy replacement. The
 * model actually sent is still recorded per row, because a re-pin must not
 * rewrite what previous calls were billed for.
 */
export const DEFAULT_EMBEDDING_PIN: ModelPin = {
  model: 'text-embedding-3-small',
  inputMicrosPerMillion: 20_000,
  outputMicrosPerMillion: 0,
};

/**
 * The vision default (AD-7, AD-33). Three minutes, not thirty seconds: ten
 * photographed pages read as one document is a slow call by construction, and a
 * timeout shorter than the work converts a slow success into a retry that pays
 * for the same tokens twice.
 */
export const DEFAULT_AI_TIMEOUT_MS = 180_000;

/** How many times an upstream fault is tried before the job is failed. */
export const DEFAULT_AI_MAX_ATTEMPTS = 3;

/** The first backoff interval; each subsequent attempt doubles it. */
export const DEFAULT_AI_RETRY_BASE_MS = 500;

export interface AiConfig {
  transport: AiTransport;
  /** Present only for the `openai` transport; validated at boot. */
  apiKey?: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  pins: Record<AiCallClassName, ModelPin>;
  /**
   * The snapshot `embed` sends. One pin, not one per call class: there is
   * exactly one caller of `embed` — stage 2 of the AD-11 cascade — and a
   * per-class embedding pin would be five unused variables in `.env.example`.
   */
  embeddingPin: ModelPin;
}

/** The env name suffix one call class takes: `TopicNormalization` → `TOPIC_NORMALIZATION`. */
export function envSuffixFor(callClass: AiCallClassName): string {
  return callClass.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = (env[name] ?? '').trim();
  if (raw === '') return fallback;
  // Zero is a digit string but not a duration: `AbortSignal.timeout(0)` aborts
  // every call before it starts, and zero attempts makes every job fail.
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive whole number, got "${raw}".`);
  }
  return Number(raw);
}

function pinFor(env: NodeJS.ProcessEnv, callClass: AiCallClassName): ModelPin {
  const suffix = envSuffixFor(callClass);
  const fallback = DEFAULT_MODEL_PINS[callClass];
  return {
    model: (env[`AI_MODEL_${suffix}`] ?? '').trim() || fallback.model,
    inputMicrosPerMillion: positiveInt(
      env,
      `AI_PRICE_${suffix}_IN`,
      fallback.inputMicrosPerMillion,
    ),
    outputMicrosPerMillion: positiveInt(
      env,
      `AI_PRICE_${suffix}_OUT`,
      fallback.outputMicrosPerMillion,
    ),
  };
}

/**
 * The embedding pin, from `AI_MODEL_TOPIC_EMBEDDING` and
 * `AI_PRICE_TOPIC_EMBEDDING_IN`.
 *
 * Named after what it is for rather than after the call class, because the class
 * already has a pin under `AI_MODEL_TOPIC_NORMALIZATION` and two variables one
 * letter apart would be swapped by somebody eventually. No `_OUT` variable: an
 * embedding has no output tokens to price.
 */
function embeddingPinFor(env: NodeJS.ProcessEnv): ModelPin {
  return {
    model: (env.AI_MODEL_TOPIC_EMBEDDING ?? '').trim() || DEFAULT_EMBEDDING_PIN.model,
    inputMicrosPerMillion: positiveInt(
      env,
      'AI_PRICE_TOPIC_EMBEDDING_IN',
      DEFAULT_EMBEDDING_PIN.inputMicrosPerMillion,
    ),
    outputMicrosPerMillion: DEFAULT_EMBEDDING_PIN.outputMicrosPerMillion,
  };
}

/**
 * Resolves and validates the AI configuration **once**, at boot.
 *
 * `fake` is the default for development and every test tier, and never
 * something a deployed environment can fall into by omission: a production boot
 * must state which transport it means, or every Extraction quietly returns an
 * invented document.
 */
export function resolveAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const stated = (env.AI_TRANSPORT ?? '').trim();
  if (stated === '' && env.NODE_ENV === 'production') {
    throw new Error('AI_TRANSPORT must be set explicitly when NODE_ENV=production.');
  }
  const transport = stated === '' ? 'fake' : stated;
  if (!(AI_TRANSPORTS as readonly string[]).includes(transport)) {
    throw new Error(`AI_TRANSPORT must be one of ${AI_TRANSPORTS.join(', ')}, got "${transport}".`);
  }

  const timeoutMs = positiveInt(env, 'AI_TIMEOUT_MS', DEFAULT_AI_TIMEOUT_MS);
  const maxAttempts = positiveInt(env, 'AI_MAX_ATTEMPTS', DEFAULT_AI_MAX_ATTEMPTS);
  const retryBaseMs = positiveInt(env, 'AI_RETRY_BASE_MS', DEFAULT_AI_RETRY_BASE_MS);

  const pins = Object.fromEntries(
    AI_CALL_CLASSES.map((callClass) => [callClass, pinFor(env, callClass)]),
  ) as Record<AiCallClassName, ModelPin>;
  const embeddingPin = embeddingPinFor(env);

  if (transport === 'openai') {
    const apiKey = (env.OPENAI_API_KEY ?? '').trim();
    if (apiKey === '') {
      throw new Error('AI_TRANSPORT=openai requires OPENAI_API_KEY.');
    }
    return { transport, apiKey, timeoutMs, maxAttempts, retryBaseMs, pins, embeddingPin };
  }

  return { transport: 'fake', timeoutMs, maxAttempts, retryBaseMs, pins, embeddingPin };
}

/**
 * What the fake transport should do on the *next* call.
 *
 * Read per call rather than resolved with the rest of the config, which is what
 * lets an integration test drive a transport fault, a schema fault and a
 * success against one booted application (AD-22).
 */
export function fakeFailureFrom(env: NodeJS.ProcessEnv = process.env): AiFakeFailure {
  const raw = (env.AI_FAKE_FAILURE ?? '').trim();
  if (raw === '') return 'none';
  if (!(AI_FAKE_FAILURES as readonly string[]).includes(raw)) {
    throw new Error(`AI_FAKE_FAILURE must be one of ${AI_FAKE_FAILURES.join(', ')}, got "${raw}".`);
  }
  return raw as AiFakeFailure;
}

/**
 * What one completed call cost, in integer micros.
 *
 * Integer because a money column that is a float is a money column that drifts,
 * and rounded once here rather than at each of the two terms, so the stored
 * figure is the rounding of the actual sum rather than the sum of two
 * roundings.
 */
export function costMicrosFor(pin: ModelPin, inputTokens: number, outputTokens: number): number {
  const micros =
    (inputTokens * pin.inputMicrosPerMillion + outputTokens * pin.outputMicrosPerMillion) /
    1_000_000;
  return Math.round(micros);
}
