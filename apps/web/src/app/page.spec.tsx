import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

describe('the device front door', () => {
  it('routes a bound device into Student Mode', () => {
    expect(SOURCE).toMatch(
      /\(\) => \{\s*if \(requestId\.current !== thisRequest\) return;\s*router\.replace\('\/student'\)/u,
    );
  });

  it('routes an unbound device to sign-in rather than to a broken Student Mode', () => {
    expect(SOURCE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
  });

  it('renders a retryable error for anything else, instead of routing', () => {
    const handler = SOURCE.slice(
      SOURCE.indexOf('(cause: unknown) => {'),
      SOURCE.indexOf('    );', SOURCE.indexOf('(cause: unknown) => {')),
    );
    expect(handler).toContain('setError(');
    // Exactly one navigation in the failure path: the unbound one.
    expect(handler.match(/router\.replace/gu)?.length).toBe(1);
    expect(SOURCE).toContain('{studentCopy.retry}');
    expect(SOURCE).toContain('onClick={decide}');
  });

  it('guards against a superseded response acting after a newer one', () => {
    expect(SOURCE.match(/if \(requestId\.current !== thisRequest\) return;/gu)?.length).toBe(2);
  });

  it('reaches no parent-scoped endpoint at all', () => {
    expect(SOURCE).toContain('parentApi.studentSession()');
    expect(SOURCE).not.toMatch(/parentApi\.(?!studentSession)/u);
  });

  it('spaces itself and sizes its controls from the comfortable tokens', () => {
    expect(SOURCE).toContain('comfortableDensity.tapTarget');
    expect(SOURCE).not.toMatch(/minHeight: \d/u);
  });

  it('gives itself a heading of its own, not Student Mode’s', () => {
    expect(studentCopy.frontDoorTitle).not.toBe(studentCopy.title);
    expect(SOURCE).toContain('{studentCopy.frontDoorTitle}');
  });
});
