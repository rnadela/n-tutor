import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { Injectable, type NestMiddleware } from '@nestjs/common';

const storage = new AsyncLocalStorage<string>();

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * A caller-supplied id is honoured only when it is bounded and free of anything
 * that could forge a log line or break a response header.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function isSafeCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CORRELATION_ID.test(value);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore();
}

/**
 * Mints a correlation id at HTTP request entry and threads it through every
 * log line emitted while handling the request (AD-20).
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_HEADER];
    const correlationId = isSafeCorrelationId(incoming) ? incoming : randomUUID();
    res.setHeader(CORRELATION_HEADER, correlationId);
    storage.run(correlationId, () => next());
  }
}
