import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { currentCorrelationId } from './correlation.js';

/**
 * Structured JSON logging to stdout (AD-20). Identifiers only — no page image
 * bytes, question content, explanation text, or answers ever reach a log line.
 */
export class JsonLogger extends ConsoleLogger {
  protected printMessages(messages: unknown[], context = '', logLevel: LogLevel = 'log'): void {
    for (const message of messages) {
      process.stdout.write(
        `${JSON.stringify({
          time: new Date().toISOString(),
          level: logLevel,
          context: context || undefined,
          correlationId: currentCorrelationId(),
          message: typeof message === 'string' ? message : safeShape(message),
        })}\n`,
      );
    }
  }
}

function safeShape(message: unknown): string {
  if (message instanceof Error) return message.message;
  return Object.prototype.toString.call(message);
}
