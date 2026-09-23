import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { ElevationProvider } from '@/lib/elevation';
import { NETWORK_STATUS, ParentApiError } from '@/lib/parent-api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const { ParentIdleExpiry, refreshOutcomeFor } = await import('./ParentIdleExpiry');

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'ParentIdleExpiry.tsx'), 'utf8');

/**
 * The source with its comments stripped. The comments explain what the code
 * deliberately does *not* do, and name the things it avoids — so the assertions
 * below have to read code, not prose.
 */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/u.test(line))
  .join('\n');

describe('what the idle clock shows the parent', () => {
  it('renders nothing at all', () => {
    const markup = renderToStaticMarkup(
      createElement(ElevationProvider, null, createElement(ParentIdleExpiry)),
    );
    expect(markup).toBe('');
  });

  it('announces nothing: no live region, no alert, no dialog', () => {
    // Expiry is silent. A parent who walked away is not there to read a
    // warning, and one who is still there never reaches the deadline.
    for (const forbidden of ['aria-live', 'role="status"', 'role="alert"', 'Dialog', 'Snackbar']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('states no copy of its own, so there is no countdown or warning to state', () => {
    expect(CODE).not.toContain('parentCopy');
    // And no notice, warning or countdown sentence was added to Parent View's
    // own copy for it to have used. Scoped to that block — the rest of the
    // catalogue is other screens' business — and to the phrasings such an
    // affordance would need, not to the word "expires", which the Parent View
    // screen has labelled the token's own instant with since Story 1.1.
    expect(JSON.stringify(parentCopy.parentView)).not.toMatch(
      /signed out|timed out|session ended|still there|are you there|about to end/iu,
    );
  });
});

describe('where an expiry goes', () => {
  it('navigates to Student Mode, the profile the device is already bound to', () => {
    expect(SOURCE).toContain("onExpire: () => router.replace('/student')");
  });

  it('never asks which profile, and never rebinds the device', () => {
    expect(CODE).not.toContain('bindStudentMode');
    expect(CODE).not.toContain('selectableStudents');
  });

  it('does not clear the elevation before navigating', () => {
    // Story 1.4: clearing while the Parent View screens are mounted makes each
    // of them fire its own `router.replace('/parent/pin')`, which races and
    // wins. Leaving the route group unmounts the provider, which is enough.
    expect(CODE).not.toContain('clearElevation');
  });
});

describe('what the clock is allowed to end Parent View for', () => {
  it('ends it on the elevation guard’s own refusal', () => {
    // The guard says which 401 is its own; nothing else can tell them apart.
    expect(refreshOutcomeFor(new ParentApiError('not elevated', 401, null, true))).toBe('expired');
  });

  it('never ends it on a bad moment the parent could simply work through', () => {
    for (const status of [400, 404, 429, 500, 503, NETWORK_STATUS]) {
      expect(refreshOutcomeFor(new ParentApiError('nope', status)), String(status)).toBe('failed');
    }
    expect(refreshOutcomeFor(new Error('boom'))).toBe('failed');
    expect(refreshOutcomeFor('boom')).toBe('failed');
  });

  it('is the classification the refresh actually runs', () => {
    expect(CODE).toContain('return { outcome: refreshOutcomeFor(cause) };');
  });

  it('only ever requests a replacement: it rewrites no instant the server stated', () => {
    expect(SOURCE).toContain('parentApi.refreshElevation(holding.token)');
    expect(SOURCE).toContain('setElevation(next)');
    // The instants carried are whatever came back, read and never computed:
    // no arithmetic is done on either of them anywhere in this file.
    expect(CODE).toContain('Date.parse(next.expiresAt)');
    expect(CODE).toContain('Date.parse(next.ceilingAt)');
    expect(CODE).not.toMatch(/(expiresAt|ceilingAt)[^\n]*[+\-*/]\s*\d/u);
  });
});

describe('where the clock lives', () => {
  it('persists nothing about itself anywhere', () => {
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('is mounted once by the layout, inside the provider holding the token', () => {
    const layout = readFileSync(
      path.resolve(import.meta.dirname, '..', 'layout.tsx'),
      'utf8',
    ).replace(/\{\/\*[\s\S]*?\*\/\}/gu, '');
    expect(layout).toMatch(/<ElevationProvider>\s*<ParentIdleExpiry \/>/u);
    expect(layout.match(/<ParentIdleExpiry \/>/gu)?.length).toBe(1);
  });
});
