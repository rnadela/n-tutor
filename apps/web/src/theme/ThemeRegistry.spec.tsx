import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemeRegistry } from './ThemeRegistry';

/**
 * A source file's code, with its comments removed.
 *
 * Whole comment lines *and* trailing inline ones, because the prose in these
 * files names the very identifiers the sweeps below forbid: a sentence
 * explaining why nothing passes `defaultMode` would otherwise fail the test it
 * explains. The trailing form is stripped first so a line that is only a
 * comment still collapses to nothing.
 */
function codeOf(relative: string): string {
  return readFileSync(path.resolve(import.meta.dirname, relative), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, '').replace(/\/\*.*?\*\//gu, ''))
    .filter((line) => !/^\s*(\*|\/\*|\{\/\*|\*\/|\{?\s*\/\/)/u.test(line))
    .join('\n');
}

/** The registry's own code: the comments here name the mounts. */
const CODE = codeOf('ThemeRegistry.tsx');

/**
 * The root layout, which is where MUI's *other* side of the colour-scheme
 * contract is configured — or, as the story requires, left alone.
 */
const LAYOUT = codeOf('../app/layout.tsx');

describe('the root registry', () => {
  it('mounts exactly one polite live region for the whole app', () => {
    // `useAnnounce()` throws outside a provider, so an unmounted region would
    // make the first snackbar on any surface a crash rather than a message.
    const markup = renderToStaticMarkup(<ThemeRegistry>body</ThemeRegistry>);
    expect(markup.match(/role="status"/gu)?.length).toBe(1);
    expect(markup).toContain('aria-live="polite"');
  });

  it('still renders what it wraps', () => {
    expect(renderToStaticMarkup(<ThemeRegistry>body</ThemeRegistry>)).toContain('body');
  });

  it('mounts the colour-mode meta sync exactly once, inside the theme provider', () => {
    // This is the only non-nested `ThemeProvider` in the app, so it is the only
    // node inside the single colour-scheme context on every surface — and
    // therefore the only place one mount can keep the browser chrome's colour
    // in step with a chosen mode everywhere. A second mount would be a second
    // writer of the same metas.
    const mounts = CODE.match(/<ColorModeMeta\s*\/>/gu) ?? [];
    expect(mounts).toHaveLength(1);
    expect(CODE).toContain("from './ColorModeMeta'");
    const provider = CODE.indexOf('<ThemeProvider');
    expect(provider).toBeGreaterThan(-1);
    expect(CODE.indexOf('<ColorModeMeta')).toBeGreaterThan(provider);
  });

  it('configures no storage key, no default mode and no nesting override', () => {
    // One stored mode for every surface comes from MUI's own defaults, which
    // both sides of the contract already agree on. A storage key, a
    // `defaultMode` or a `disableNestedContext` here or on a route provider
    // would split the mode per surface — the one failure this story exists to
    // prevent.
    for (const forbidden of [
      'modeStorageKey',
      'colorSchemeStorageKey',
      'defaultMode',
      'disableNestedContext',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
    // Not a mode-splitting prop at all: it is banned because the story forbids
    // a transition on toggle (UX-DR37). The scheme changes at once or not at
    // all, and MUI's own transition suppression is a flicker nobody asked for.
    expect(CODE).not.toContain('disableTransitionOnChange');
  });

  it('renders no colour-mode markup of its own: the sync is invisible', () => {
    expect(renderToStaticMarkup(<ThemeRegistry>body</ThemeRegistry>)).not.toContain('theme-color');
  });
});

/**
 * The four route groups' providers, which are what makes one stored mode shared
 * rather than four modes kept apart.
 */
const ROUTE_PROVIDERS = [
  '../app/parent/_components/ParentThemeProvider.tsx',
  '../app/admin/_components/AdminThemeProvider.tsx',
  '../app/student/_components/StudentThemeProvider.tsx',
  '../app/auth/_components/AuthThemeProvider.tsx',
] as const;

describe('the init script in the root layout', () => {
  it('keeps the data attribute selector every colour-scheme assertion depends on', () => {
    // `attribute="data"` is what makes the script write `data-light` /
    // `data-dark` on `<html>` — the same pair the provider's own effect sets,
    // and the pair the E2E spec reads. Drop it and the script writes
    // `data-mui-color-scheme` instead, which matches no selector this theme
    // generates: the first paint would be light on a dark device.
    expect(LAYOUT).toContain('attribute="data"');
    expect(LAYOUT).toContain('<InitColorSchemeScript');
  });

  it('configures no storage key and no default mode of its own either', () => {
    // This is the *other* side of the storage contract, and the side that
    // actually writes the keys. Both sides default to `mui-mode` and
    // `mui-color-scheme`, so they already agree; name a key on one of them and
    // the script and the provider stop reading the same thing, which is a
    // first paint in one scheme and a header in the other.
    for (const forbidden of ['modeStorageKey', 'colorSchemeStorageKey', 'defaultMode']) {
      expect(LAYOUT, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the nested theme providers', () => {
  it('each still pass a theme and nothing else', () => {
    // A nested `ThemeProvider` reads the outer colour-scheme context and
    // returns its subtree without re-providing — so the mode is shared for
    // free. Hand one of these a storage key, a `defaultMode` or
    // `disableNestedContext` and it becomes its own provider with its own
    // stored mode, and the switch on Student home stops agreeing with the one
    // in Parent View.
    for (const relative of ROUTE_PROVIDERS) {
      const source = readFileSync(path.resolve(import.meta.dirname, relative), 'utf8');
      const props = /<ThemeProvider([^>]*)>/u.exec(source);
      expect(props, relative).not.toBeNull();
      expect(props![1]!.trim(), relative).toMatch(/^theme=\{\w+\}$/u);
    }
  });
});
