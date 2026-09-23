import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** A transport failure, distinct from a programming error the caller must not swallow. */
export class MailDispatchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MailDispatchError';
  }
}

export const MAIL_TRANSPORTS = ['log', 'http'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

export interface MailConfig {
  transport: MailTransport;
  from: string;
  /** Present only for the `http` transport; validated at module init. */
  apiUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  /** Development and E2E only: the `log` transport also appends JSONL here. */
  logFile?: string;
}

/**
 * Resolves and validates the mail configuration **once**. A transport that is
 * misconfigured must refuse to boot: resolved per send, a typo produces a
 * healthy-looking 204 and no mail, forever.
 */
export function resolveMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const stated = (env.MAIL_TRANSPORT ?? '').trim();
  // `log` is the default for development and tests, never something a deployed
  // environment can fall into by omission: a production boot must state which
  // transport it means, or a parent's reset link goes nowhere but a log line.
  if (stated === '' && env.NODE_ENV === 'production') {
    throw new Error('MAIL_TRANSPORT must be set explicitly when NODE_ENV=production.');
  }
  const transport = stated === '' ? 'log' : stated;
  if (!(MAIL_TRANSPORTS as readonly string[]).includes(transport)) {
    throw new Error(
      `MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(', ')}, got "${transport}".`,
    );
  }

  const statedFrom = (env.MAIL_FROM ?? '').trim();
  // A placeholder sender is a development convenience; in production it is a
  // domain nobody has verified, so every message would be dropped silently.
  if (statedFrom === '' && env.NODE_ENV === 'production') {
    throw new Error('MAIL_FROM must be set when NODE_ENV=production.');
  }
  const from = statedFrom || 'no-reply@example.test';

  const timeoutRaw = (env.MAIL_TIMEOUT_MS ?? '').trim();
  // Zero is a digit string but not a timeout: `AbortSignal.timeout(0)` aborts
  // every send before it starts.
  if (timeoutRaw !== '' && (!/^\d+$/.test(timeoutRaw) || Number(timeoutRaw) <= 0)) {
    throw new Error(`MAIL_TIMEOUT_MS must be a positive whole number, got "${timeoutRaw}".`);
  }
  const timeoutMs = timeoutRaw === '' ? 10_000 : Number(timeoutRaw);
  const logFile = (env.MAIL_LOG_FILE ?? '').trim() || undefined;

  if (transport === 'http') {
    const apiUrl = (env.MAIL_API_URL ?? '').trim();
    const apiKey = (env.MAIL_API_KEY ?? '').trim();
    if (apiUrl === '' || apiKey === '') {
      throw new Error('MAIL_TRANSPORT=http requires both MAIL_API_URL and MAIL_API_KEY.');
    }
    return { transport, from, apiUrl, apiKey, timeoutMs, logFile };
  }

  return { transport: 'log', from, timeoutMs, logFile };
}

/**
 * Vendor-neutral mail dispatch: `to`, `subject`, `text`, and one of two
 * transports. No provider SDK — the HTTP transport is a `fetch` POST.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  readonly config: MailConfig;

  constructor() {
    // Init-time, not send-time: a bad value fails the boot, not a parent.
    this.config = resolveMailConfig();
  }

  async send(message: MailMessage): Promise<void> {
    const payload = { from: this.config.from, ...message };
    if (this.config.transport === 'log') {
      this.logger.log(JSON.stringify({ event: 'mail.send', ...payload }));
      this.appendToLogFile(payload);
      return;
    }
    await this.postToProvider(payload);
  }

  private appendToLogFile(payload: Record<string, string>): void {
    const logFile = this.config.logFile;
    if (!logFile) return;
    try {
      // A clean checkout has no directory to append into; without this the
      // sink fails with ENOENT and a reader waits for a message that is never
      // written.
      mkdirSync(path.dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
    } catch (cause) {
      // Not a dispatch failure — the message was emitted — but never silent.
      this.logger.warn(
        `The mail log file could not be written: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private async postToProvider(payload: Record<string, string>): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.config.apiUrl!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey!}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (cause) {
      throw new MailDispatchError('The mail provider could not be reached.', cause);
    }
    if (!response.ok) {
      throw new MailDispatchError(`The mail provider rejected the message (${response.status}).`);
    }
  }
}
