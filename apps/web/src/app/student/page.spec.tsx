import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import { NETWORK_STATUS, ParentApiError } from '@/lib/parent-api';
import { deviceIsUnbound } from './page';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

describe('what sends a child away from Student Mode', () => {
  it('is the Student Mode guard’s own refusal, and only that', () => {
    expect(deviceIsUnbound(new ParentApiError('not set up', 401, null, false, true))).toBe(true);
  });

  it('is not a bare 401, which says nothing about the binding', () => {
    expect(deviceIsUnbound(new ParentApiError('nope', 401))).toBe(false);
  });

  it('is never a fault the reader could simply try again', () => {
    // A dropped connection is not a Student Mode that was taken away, and
    // routing a child to sign-in on one would make it look like it was.
    for (const status of [400, 404, 429, 500, 503, NETWORK_STATUS]) {
      expect(deviceIsUnbound(new ParentApiError('nope', status))).toBe(false);
    }
    expect(deviceIsUnbound(new Error('boom'))).toBe(false);
    expect(deviceIsUnbound('boom')).toBe(false);
  });
});

describe('what the page does with each outcome', () => {
  it('routes an unbound device to sign-in rather than to a broken Student Mode', () => {
    expect(SOURCE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
  });

  it('renders a retryable error for anything else, instead of routing', () => {
    const handler = SOURCE.slice(SOURCE.indexOf('(cause: unknown) => {'), SOURCE.indexOf('};'));
    expect(handler).toContain('setError(');
    // Exactly one navigation in the failure path: the unbound one.
    expect(handler.match(/router\.replace/gu)?.length).toBe(1);
    expect(SOURCE).toContain('{studentCopy.retry}');
  });

  it('reaches no parent-scoped endpoint at all', () => {
    expect(SOURCE).toContain('parentApi.studentSession()');
    expect(SOURCE).not.toMatch(/parentApi\.(?!studentSession)/u);
    // And it never names a profile id: the binding names it, server-side.
    expect(SOURCE).not.toMatch(/studentProfileId/u);
  });

  it('spaces itself and sizes its controls from the comfortable tokens', () => {
    expect(SOURCE).toContain('comfortableDensity.tapTarget');
    expect(SOURCE).not.toMatch(/minHeight: \d/u);
  });
});

describe('Student Mode’s copy', () => {
  it('greets the bound child by name, in the second person', () => {
    const greeting = studentCopy.greeting('Ada');
    expect(greeting).toContain('Ada');
    expect(greeting).not.toContain('!');
  });

  it('addresses the child rather than describing them to someone else', () => {
    expect(studentCopy.gradeLevel('Grade 4')).toMatch(/^You are in/u);
    expect(studentCopy.empty).toMatch(/\byour\b/iu);
  });

  it('says what will appear later instead of showing an empty screen', () => {
    expect(studentCopy.empty).toMatch(/nothing to practise yet/u);
  });

  it('names the one control out of Student Mode without naming the PIN', () => {
    expect(studentCopy.parent).toBe('Parent');
  });

  it('gives the front door a heading of its own, not Student Mode’s', () => {
    // A shared heading would let a test believe it had reached Student Mode
    // while it was still standing on the front door deciding.
    expect(studentCopy.frontDoorTitle).not.toBe(studentCopy.title);
  });

  it('states no figure anywhere', () => {
    for (const line of [
      studentCopy.title,
      studentCopy.frontDoorTitle,
      studentCopy.greeting('Ada'),
      studentCopy.gradeLevel('Grade 4'),
      studentCopy.empty,
      studentCopy.parent,
      studentCopy.notBound,
      studentCopy.failed,
      studentCopy.retry,
    ]) {
      // The Grade Level's own name is the only digit a reader ever sees, and
      // it arrives from the API rather than from this module.
      expect(line.replace('Grade 4', '')).not.toMatch(/\d/u);
      expect(line).not.toContain('!');
    }
  });
});
