import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createTheme, type Theme } from '@mui/material/styles';
import { parentTheme, studentTheme } from '@/theme/theme';
import { comfortableDensity, density, measure, motion } from '@/theme/tokens';
import { DestructiveButton, PrimaryButton } from './Button';
import {
  announced,
  AnnouncementRegion,
  cleared,
  LiveRegionProvider,
  NO_ANNOUNCEMENT,
  useAnnounce,
} from './LiveRegion';
import { Screen } from './Screen';
import { announcementFor, AppSnackbar, closesOn } from './Snackbar';
import { TextField } from './TextField';

const DIR = import.meta.dirname;

/**
 * Files in this folder that are **not** primitives.
 *
 * `components/` holds the primitive layer and, since Story 6.2, the two components
 * two surfaces render in common: the answer-key row and the grade-state marker. Those
 * moved here from `app/student/_components/` because the parent's Attempt detail
 * renders the identical layout — a shared component inside one surface's folder is a
 * component the other surface reaches across a boundary for.
 *
 * They are excluded from the sweeps below because the sweeps state rules about
 * primitives: a marker whose whole job is to draw a grade state on five carriers at
 * once necessarily names a rule texture's own geometry, and a token table cannot
 * express a repeating gradient's stops. Their own specs assert what they must instead
 * — that each of the four states stays distinguishable with every colour, class and
 * inline style stripped.
 */
const NOT_PRIMITIVES = new Set(['AnswerKeyRow.tsx', 'GradeStateMarker.tsx']);

/** Every primitive's source, keyed by file name. */
const SOURCES = Object.fromEntries(
  readdirSync(DIR)
    .filter(
      (name) => name.endsWith('.tsx') && !name.endsWith('.spec.tsx') && !NOT_PRIMITIVES.has(name),
    )
    .map((name) => [name, readFileSync(path.resolve(DIR, name), 'utf8')]),
);

/** A primitive's source with its comments stripped: comments name the tokens. */
function codeOf(name: string): string {
  return SOURCES[name]!.split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

function render(node: ReactElement, theme = parentTheme): string {
  return renderToStaticMarkup(createElement(ThemeProvider, { theme }, node));
}

describe('every primitive renders a real control', () => {
  it('draws the primary button as a button carrying its accessible name', () => {
    const markup = render(createElement(PrimaryButton, null, 'Save'));
    expect(markup).toContain('<button');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('Save');
  });

  it('draws the destructive button as an outlined error button, never a red fill', () => {
    const markup = render(createElement(DestructiveButton, null, 'Delete Ada'));
    expect(markup).toContain('<button');
    expect(markup).toContain('MuiButton-outlined');
    expect(markup).toContain('MuiButton-colorError');
    expect(markup).not.toContain('MuiButton-contained');
    expect(markup).toContain('Delete Ada');
  });

  it('refuses to let a caller override the role it exists to enforce', () => {
    // `{...props}` is spread before the enforced values, so this loses.
    const markup = render(
      // `variant` is accepted by `TextFieldProps`; the point is that passing
      // it here changes nothing, because the primitive spreads props first.
      <TextField id="email" label="Email" value="" onChange={() => {}} variant="standard" />,
    );
    expect(markup).toContain('MuiOutlinedInput-root');
    expect(markup).not.toContain('MuiInput-underline');
  });

  it('refuses to let a caller turn a destructive button into a red fill', () => {
    const markup = render(
      // @ts-expect-error — `variant` is omitted from the primitive's own props.
      <DestructiveButton variant="contained" color="primary">
        Delete Ada
      </DestructiveButton>,
    );
    expect(markup).toContain('MuiButton-outlined');
    expect(markup).toContain('MuiButton-colorError');
    expect(markup).not.toContain('MuiButton-contained');
  });

  it('draws the text field as a real input with a label bound to it', () => {
    const markup = render(
      createElement(TextField, { id: 'email', label: 'Email', value: '', onChange: () => {} }),
    );
    expect(markup).toContain('<input');
    expect(markup).toContain('<label');
    expect(markup).toContain('for="email"');
    expect(markup).toContain('id="email"');
  });

  it('draws the screen as a landmark, not an anonymous box', () => {
    expect(render(<Screen>body</Screen>)).toContain('<main');
  });

  it('never hangs an action, a state, or aria-expanded on a div or a span', () => {
    // UX-DR30, as a source rule over the whole primitive layer — the lint
    // config catches the same thing at build time, and this catches a file
    // that slipped past a lint-disable.
    for (const [name, source] of Object.entries(SOURCES)) {
      for (const forbidden of [
        '<div onClick',
        '<span onClick',
        '<div role="button"',
        '<span role="button"',
        'aria-expanded',
        'tabIndex',
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('hardcodes no colour, radius or tap-target figure in any primitive', () => {
    for (const name of Object.keys(SOURCES)) {
      const code = codeOf(name);
      expect(code, `${name}: hex colour`).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/u);
      // 1px is the hairline the clip rectangle needs; any other px figure is a
      // size, a radius or a tap target, and every one of those is a token.
      expect(code, `${name}: px figure`).not.toMatch(/\b(?!1px)\d+px\b/u);
      expect(code, `${name}: tap target`).not.toMatch(/\b(44|48)\b/u);
    }
  });
});

describe('the surface tap-target floor', () => {
  it('reaches a Student Mode control as 48, and a Parent View one as 44', () => {
    // The primitive states no figure: the floor is the theme's density.
    expect(studentTheme.density.tapTarget).toBe(comfortableDensity.tapTarget);
    expect(parentTheme.density.tapTarget).toBe(density.tapTarget);
    expect(studentTheme.density.tapTarget).toBe(48);
    expect(parentTheme.density.tapTarget).toBe(44);
  });

  it('is the same primitive on both surfaces, with no per-surface branch', () => {
    // `Address.tsx` is the one file allowed to know which room it is in: that
    // resolution is its whole job (UX-DR31).
    for (const name of Object.keys(SOURCES)) {
      if (name === 'Address.tsx') continue;
      expect(codeOf(name), name).not.toContain('surface ===');
      expect(codeOf(name), name).not.toContain("'student'");
    }
  });
});

describe('the screen layout', () => {
  it('reads its gutters from the density rather than a breakpoint', () => {
    // The same primitive, two surfaces, no figure of its own.
    expect(render(<Screen>body</Screen>, studentTheme)).toContain(
      `${comfortableDensity.cardPadding}px`,
    );
    expect(render(<Screen>body</Screen>, parentTheme)).toContain(`${density.cardPadding}px`);
    // Single fluid layout, unchanged phone to tablet (UX-DR36).
    for (const breakpoint of ['breakpoints', 'sm:', 'md:', '@media']) {
      expect(SOURCES['Screen.tsx'], breakpoint).not.toContain(breakpoint);
    }
  });

  it('falls back to the compact density under a theme that carries none', () => {
    // `theme.density` is optional on `ThemeOptions`; without the fallback every
    // gutter would resolve to `undefinedpx` and the column would collapse.
    const bare = createTheme() as Theme;
    const markup = render(<Screen>body</Screen>, bare);
    expect(markup).not.toContain('undefined');
    expect(markup).toContain(`${density.cardPadding}px`);
    expect(markup).toContain(`${density.sectionMargin}px`);
  });

  it('offers the 34rem measure cap without imposing it on chrome', () => {
    expect(measure.questionMaxWidth).toBe('34rem');
    expect(render(<Screen measured>q</Screen>)).toContain('34rem');
    expect(render(<Screen>q</Screen>)).not.toContain('34rem');
  });
});

describe('the live region', () => {
  it('is one polite status region, mounted once per surface', () => {
    const markup = renderToStaticMarkup(createElement(LiveRegionProvider, null, 'body'));
    expect(markup.match(/role="status"/gu)?.length).toBe(1);
    expect(markup).toContain('aria-live="polite"');
  });

  it('carries the displayed copy verbatim, not a second test-only string', () => {
    const copy = 'Ada scored 11 of 15.';
    expect(announced(NO_ANNOUNCEMENT, copy).message).toBe(copy);
    expect(renderToStaticMarkup(createElement(AnnouncementRegion, { message: copy }))).toContain(
      copy,
    );
  });

  it('makes a repeated announcement a new state rather than a silent no-op', () => {
    // Two identical sentences in a row: without the count React bails out of
    // the re-render and the second one is never announced at all.
    const copy = 'Saved.';
    const first = announced(NO_ANNOUNCEMENT, copy);
    const second = announced(first, copy);
    expect(second.message).toBe(copy);
    expect(second).not.toEqual(first);
    expect(second.count).toBeGreaterThan(first.count);
  });

  it('empties the region when it is cleared, without rewinding the count', () => {
    const first = announced(NO_ANNOUNCEMENT, 'Saved.');
    const emptied = cleared(first);
    expect(emptied.message).toBe('');
    expect(emptied.count).toBeGreaterThan(first.count);
  });

  it('refuses to be used outside its provider rather than announcing nowhere', () => {
    function Orphan() {
      useAnnounce();
      return null;
    }
    expect(() => renderToStaticMarkup(createElement(Orphan))).toThrow(/LiveRegionProvider/u);
  });

  it('is what the snackbar announces through: no second region of its own', () => {
    expect(codeOf('Snackbar.tsx')).not.toContain('role="status"');
    expect(codeOf('Snackbar.tsx')).toContain('useAnnounce()');
  });
});

describe('the snackbar', () => {
  it('announces the message it displays, verbatim', () => {
    expect(announcementFor(true, 'Ada scored 11 of 15.')).toBe('Ada scored 11 of 15.');
  });

  it('empties the region when it closes, so nothing stale lingers', () => {
    expect(announcementFor(false, 'Ada scored 11 of 15.')).toBe('');
  });

  it('says nothing at all when it is open with nothing to say', () => {
    expect(announcementFor(true, '')).toBeNull();
  });

  it('dismisses itself on a timeout rather than staying up forever', () => {
    const markup = render(
      <LiveRegionProvider>
        <AppSnackbar open message="Saved." onClose={() => {}} />
      </LiveRegionProvider>,
    );
    expect(motion.snackbarAutoHide).toBeGreaterThan(0);
    expect(markup).toContain('Saved.');
  });

  it('ignores a stray click, so a message is never lost before it is read', () => {
    expect(closesOn('clickaway')).toBe(false);
    expect(closesOn('timeout')).toBe(true);
    expect(closesOn('escapeKeyDown')).toBe(true);
  });
});

describe('motion', () => {
  it('introduces no decorative animation in any primitive', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      for (const forbidden of ['@keyframes', 'animation:', 'transition:']) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
