import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElevationProvider, useElevation, type ElevationContextValue } from './elevation';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'elevation.tsx'), 'utf8');

/** Renders the provider and hands back what a child inside it sees. */
function readContext(): ElevationContextValue {
  let seen: ElevationContextValue | null = null;
  function Probe() {
    seen = useElevation();
    return null;
  }
  renderToStaticMarkup(createElement(ElevationProvider, null, createElement(Probe)));
  if (seen === null) throw new Error('The provider rendered no child.');
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the elevation context', () => {
  it('starts with no token: nothing is restored from anywhere', () => {
    expect(readContext().elevation).toBeNull();
  });

  it('touches no storage API while it mounts and reads', () => {
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const cookie = vi.fn();
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('document', {
      get cookie() {
        return cookie();
      },
      set cookie(_value: string) {
        cookie();
      },
    });
    vi.stubGlobal('indexedDB', { open: vi.fn() });

    readContext();

    for (const spy of [
      localStorage.getItem,
      localStorage.setItem,
      localStorage.removeItem,
      sessionStorage.getItem,
      sessionStorage.setItem,
      sessionStorage.removeItem,
      cookie,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('names no storage API anywhere in its source', () => {
    // The spies above can only catch what a render happens to reach; this
    // catches a persistence path added on any other code path at all (AD-18).
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'window.name',
    ]) {
      // The comment explaining why they are absent names them, so the check is
      // against code: comment lines are stripped first.
      const code = SOURCE.split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n');
      expect(code).not.toContain(forbidden);
    }
  });

  it('refuses to be used outside its provider rather than silently holding nothing', () => {
    function Orphan() {
      useElevation();
      return null;
    }
    expect(() => renderToStaticMarkup(createElement(Orphan))).toThrow();
  });
});
