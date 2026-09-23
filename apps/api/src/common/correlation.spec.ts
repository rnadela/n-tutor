import { describe, expect, it } from 'vitest';
import { isSafeCorrelationId } from './correlation.js';

describe('isSafeCorrelationId', () => {
  it.each([
    ['a uuid', '3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    ['dots, dashes and underscores', 'abc-123_XYZ.1'],
    ['a single character', 'a'],
    ['128 characters', 'a'.repeat(128)],
  ])('accepts %s', (_label, value) => {
    expect(isSafeCorrelationId(value)).toBe(true);
  });

  it.each([
    ['a CRLF injection attempt', 'abc\r\nX-Injected: 1'],
    ['a bare newline', 'abc\ndef'],
    ['a space', 'not a safe id'],
    ['an empty string', ''],
    ['129 characters', 'a'.repeat(129)],
    ['a non-string', 42],
    ['undefined', undefined],
    ['an array of values', ['a', 'b']],
  ])('rejects %s', (_label, value) => {
    expect(isSafeCorrelationId(value)).toBe(false);
  });
});
