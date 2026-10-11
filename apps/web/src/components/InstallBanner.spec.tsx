import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { commonCopy } from '@/copy/common';
import { parentTheme, studentTheme } from '@/theme/theme';
import { comfortableDensity, density } from '@/theme/tokens';
import type { InstallBannerMode, InstallBannerSurface } from '@/lib/install-banner';
import { InstallBannerView } from './InstallBanner';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'InstallBanner.tsx'), 'utf8');

/**
 * The source with its comments stripped, the pattern `layout.spec.ts` set: the
 * comments here name the very things the assertions below look for, so they
 * have to read code rather than prose.
 */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/u.test(line))
  .join('\n');

const copy = commonCopy.installBanner;

/**
 * The markup with the emotion `<style>` blocks removed, as in
 * `AttemptTimer.spec.tsx`: generated CSS carries figures that have nothing to
 * do with what this banner says.
 */
function body(markup: string): string {
  return markup.replace(/<style[\s\S]*?<\/style>/gu, '');
}

/** The whole render, generated CSS included. */
function raw(surface: InstallBannerSurface, mode: InstallBannerMode | null): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: surface === 'student' ? studentTheme : parentTheme },
      createElement(InstallBannerView, {
        surface,
        mode,
        onInstall: () => {},
        onDismiss: () => {},
      }),
    ),
  );
}

function render(surface: InstallBannerSurface, mode: InstallBannerMode | null): string {
  return body(raw(surface, mode));
}

describe('what the banner is in the accessibility tree', () => {
  it('is a named region, and nothing louder', () => {
    const markup = render('parent', 'prompt');
    expect(markup).toContain('role="region"');
    expect(markup).toContain(`aria-label="${copy.regionName}"`);
    // Never a toast, a dialog, an alert or a live region: the banner is an
    // offer, not an announcement, and it never takes focus.
    for (const forbidden of ['role="alert"', 'role="status"', 'aria-live', 'role="dialog"']) {
      expect(markup).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/autoFocus|\.focus\(\)|Dialog|Snackbar|Modal/u);
  });

  it('offers a real button to dismiss, on every variant', () => {
    for (const [surface, mode] of [
      ['parent', 'prompt'],
      ['student', 'prompt'],
      ['student', 'ios'],
    ] as const) {
      const buttons = render(surface, mode).match(/<button[^>]*>/gu) ?? [];
      // A real `<button>` with a `type`, never a clickable `<div>` wearing
      // `role="button"`: the dismiss has to be reachable by keyboard, and a
      // typeless button inside a form would submit it.
      const dismiss = buttons.filter((tag) => tag.includes(`aria-label="${copy.dismiss}"`));
      expect(dismiss, `${surface}/${mode}`).toHaveLength(1);
      expect(dismiss[0]).toContain('type="button"');
    }
  });
});

describe('what each variant says', () => {
  it('tells a parent about this device, with an Install action', () => {
    const markup = render('parent', 'prompt');
    expect(markup).toContain(copy.parent);
    expect(markup).toContain(`>${copy.action}<`);
    expect(markup).not.toContain(copy.student);
    expect(markup).not.toContain(copy.iosSteps);
  });

  it('tells a child about their own home screen, with the same action', () => {
    const markup = render('student', 'prompt');
    expect(markup).toContain(copy.student);
    expect(markup).toContain(`>${copy.action}<`);
    expect(markup).not.toContain(copy.parent);
  });

  it('gives iOS the Share steps, the sign-in note, and no Install button', () => {
    // On both surfaces: an iPad in Parent View is the likeliest iOS case of
    // the two, and the steps are the same menu on either screen.
    for (const surface of ['student', 'parent'] as const) {
      const markup = render(surface, 'ios');
      expect(markup, surface).toContain(copy.iosSteps);
      expect(markup, surface).toContain(copy.iosSignIn);
      // There is no prompt to call on iOS, and a button that opened nothing
      // would be worse than the steps beside it.
      expect(markup, surface).not.toContain(`>${copy.action}<`);
      // The surface's own sentence is replaced by the steps, not stacked above
      // them: one message, not two.
      expect(markup, surface).not.toContain(copy[surface]);
    }
  });

  it('renders nothing at all when there is nothing to offer', () => {
    // Not an empty strip and not a disabled control: on a browser with no
    // install path, in an installed window, or after a dismissal, the banner
    // is absent from the document.
    expect(render('parent', null).trim()).toBe('');
    expect(render('student', null).trim()).toBe('');
  });
});

describe('where the banner’s figures and words come from', () => {
  it('states no colour of its own', () => {
    // Colours come from the mounted theme — the parent and student surfaces
    // carry different accents, and a literal would pin one of them.
    expect(CODE).not.toMatch(/#[0-9A-Fa-f]{3,8}/u);
    expect(CODE).not.toMatch(/\brgba?\(/u);
    expect(CODE).not.toMatch(/\bhsla?\(/u);
  });

  it('states no spacing, radius or tap target of its own', () => {
    // Every figure is a token: `density`/`comfortableDensity` for spacing and
    // the tap-target floor, `rounded.control` for the radius.
    expect(CODE).not.toMatch(/\b(gap|padding|margin|marginBottom|minHeight|width|height):\s*\d/u);
    expect(CODE).not.toMatch(/borderRadius:\s*\d/u);
    expect(CODE).toContain('rounded.control');
    expect(CODE).toContain('theme.density ?? density');
  });

  it('takes its spacing and tap targets from the mounted theme', () => {
    // Student Mode's theme carries the comfortable set and Parent View's the
    // compact one, so the one component is roomier on a child's screen without
    // choosing either figure itself (UX-DR9).
    expect(raw('student', 'prompt')).toContain(`${comfortableDensity.cardPadding}px`);
    expect(raw('student', 'prompt')).toContain(`${comfortableDensity.tapTarget}px`);
    expect(raw('parent', 'prompt')).toContain(`${density.cardPadding}px`);
    expect(raw('parent', 'prompt')).toContain(`${density.tapTarget}px`);
  });

  it('states its own gap below itself on Parent View, and none on Student Home', () => {
    // Parent View's content area is a plain block, so the banner has to space
    // itself off the screen below it. Student Home's outer grid already spaces
    // its children, and a margin there would double the gap.
    for (const mode of ['prompt', 'ios'] as const) {
      expect(raw('parent', mode), mode).toContain(`margin-bottom:${density.sectionMargin}px`);
      expect(raw('student', mode), mode).not.toContain('margin-bottom');
    }
    // And it survives a theme that carries no density at all, rather than
    // resolving every gutter to `undefinedpx`.
    expect(
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createTheme() as Theme },
          createElement(InstallBannerView, {
            surface: 'parent' as const,
            mode: 'prompt' as const,
            onInstall: () => {},
            onDismiss: () => {},
          }),
        ),
      ),
    ).not.toContain('undefinedpx');
  });

  it('holds no user-facing string of its own', () => {
    // Every word is a `commonCopy.installBanner` string (AD-32).
    expect(CODE).toContain('commonCopy.installBanner');
    for (const line of [
      copy.regionName,
      copy.parent,
      copy.student,
      copy.iosSteps,
      copy.iosSignIn,
    ]) {
      expect(CODE).not.toContain(line);
    }
    // The two short labels, checked as quoted literals: the word "Install" is
    // half the identifiers in this file.
    for (const label of [copy.action, copy.dismiss]) {
      expect(CODE).not.toMatch(new RegExp(`['"\`]${label}['"\`]`, 'u'));
    }
  });

  it('leaves the manifest, the worker and offline behaviour alone', () => {
    for (const forbidden of ['manifest', 'serviceWorker', 'sw.js', 'caches']) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});

describe('how the mounted banner decides', () => {
  it('asks the rules module rather than deciding for itself', () => {
    expect(CODE).toContain('installBannerMode({');
    expect(CODE).toContain('subscribeInstallPrompt');
    expect(CODE).toContain('promptToInstall()');
  });

  it('reads the dismissal after mount, never in a state initializer', () => {
    // `sessionStorage` does not exist during SSR, and reading it in the
    // initializer would make the server's markup and the first client render
    // disagree.
    expect(CODE).toMatch(/useEffect\(\(\) => \{\s*setDismissed\(installBannerDismissed\(/u);
    expect(CODE).toContain('useState(false)');
    expect(CODE).not.toMatch(/useState\(installBannerDismissed/u);
  });

  it('remembers the dismissal for the session alone', () => {
    // No `localStorage`, no cookie, no server record and no "remind me later".
    expect(CODE).toContain('rememberInstallBannerDismissed');
    for (const forbidden of ['localStorage', 'document.cookie', 'setTimeout', 'fetch(']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('takes the banner away for good once the install is accepted', () => {
    expect(CODE).toMatch(/if \(accepted\) dismiss\(\)/u);
  });
});
