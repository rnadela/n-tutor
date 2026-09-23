import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonLogger } from './json-logger.js';

function captureLines(run: (logger: JsonLogger) => void): string[] {
  const lines: string[] = [];
  const write = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  try {
    run(new JsonLogger());
  } finally {
    write.mockRestore();
  }
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JsonLogger', () => {
  it('emits one valid JSON line per message', () => {
    const [line, ...rest] = captureLines((logger) => logger.log('started', 'Bootstrap'));

    expect(rest).toHaveLength(0);
    expect(line!.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: 'log', context: 'Bootstrap', message: 'started' });
    expect(typeof parsed.time).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.time as string))).toBe(false);
  });

  it("logs an Error's message, not its stack", () => {
    const lines = captureLines((logger) => logger.error(new Error('database unreachable')));
    const parsed = JSON.parse(lines[0]!) as { level: string; message: unknown };

    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('database unreachable');
  });

  it('reduces a plain object to its shape rather than serialising it', () => {
    const lines = captureLines((logger) => logger.log({ answer: 'the child wrote 42' }));
    const parsed = JSON.parse(lines[0]!) as { message: unknown };

    expect(parsed.message).toBe('[object Object]');
    expect(lines[0]).not.toContain('the child wrote 42');
  });

  it('carries no correlation id outside a request', () => {
    const lines = captureLines((logger) => logger.log('outside a request'));
    expect(JSON.parse(lines[0]!).correlationId).toBeUndefined();
  });
});
