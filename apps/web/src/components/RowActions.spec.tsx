import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { Eye, Pencil } from 'lucide-react';
import { parentTheme } from '@/theme/theme';
import {
  orderMenuActions,
  planMenuRows,
  planRowActions,
  RowActions,
  type RowAction,
} from './RowActions';

/**
 * The row-actions rule, pinned where the `node` runner can see it.
 *
 * `apps/web` ships no DOM testing library and a closed MUI `Menu` renders
 * nothing into static markup, so the cap — at most two icons per row, the `⋮`
 * counting as one — is asserted against the pure `planRowActions` rather than
 * against a rendered menu. The keyboard path through the `⋮` is pinned in the
 * Playwright suites, where there is a real browser to press keys in.
 */

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'RowActions.tsx'), 'utf8');

const noop = () => {};

function action(key: string, extra: Partial<RowAction> = {}): RowAction {
  return {
    key,
    label: key,
    icon: <Pencil size={16} aria-hidden="true" />,
    onClick: noop,
    ...extra,
  };
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<ThemeProvider theme={parentTheme}>{node}</ThemeProvider>).replace(
    /<style[\s\S]*?<\/style>/gu,
    '',
  );
}

describe('how many icons a row is allowed to show', () => {
  it('keeps two self-evident actions inline, with no ⋮ at all', () => {
    const rename = action('rename', { selfEvident: true });
    const remove = action('delete', { selfEvident: true, destructive: true });
    expect(planRowActions([rename, remove])).toEqual({ inline: [rename, remove], menu: [] });
  });

  it('keeps the self-evident one inline and sends the other to the menu', () => {
    // Two icons in total — the pencil and the ⋮ — which is the whole cap.
    const rename = action('rename', { selfEvident: true });
    const disable = action('disable');
    expect(planRowActions([rename, disable])).toEqual({ inline: [rename], menu: [disable] });
  });

  it('puts both in the menu when neither icon says what it does', () => {
    const archive = action('archive');
    const disable = action('disable');
    expect(planRowActions([archive, disable])).toEqual({
      inline: [],
      menu: [archive, disable],
    });
  });

  it('puts everything in the menu once a row has more than two actions', () => {
    // Even the self-evident ones: three icons plus a ⋮ is four, and the cap is two.
    const confirm = action('confirm');
    const rename = action('rename', { selfEvident: true });
    const merge = action('merge');
    expect(planRowActions([confirm, rename, merge])).toEqual({
      inline: [],
      menu: [confirm, rename, merge],
    });
  });

  it('leaves a lone expand toggle inline as the row’s only icon', () => {
    const toggle = action('toggle', {
      selfEvident: true,
      expanded: false,
      controls: 'consumption-1',
    });
    expect(planRowActions([toggle])).toEqual({ inline: [toggle], menu: [] });
  });

  it('sends a lone action that is not self-evident to the menu', () => {
    const disable = action('disable');
    expect(planRowActions([disable])).toEqual({ inline: [], menu: [disable] });
  });

  it('plans nothing for a row with nothing to do', () => {
    expect(planRowActions([])).toEqual({ inline: [], menu: [] });
  });

  it('never plans more than two icons, counting the ⋮', () => {
    // The cap as arithmetic rather than as a list of cases.
    const candidates: RowAction[] = [
      action('a', { selfEvident: true }),
      action('b', { selfEvident: true }),
      action('c'),
      action('d', { destructive: true }),
    ];
    for (let size = 0; size <= candidates.length; size += 1) {
      const { inline, menu } = planRowActions(candidates.slice(0, size));
      expect(inline.length + (menu.length > 0 ? 1 : 0), `${size} actions`).toBeLessThanOrEqual(2);
      // And nothing is dropped on the way.
      expect(inline.length + menu.length).toBe(size);
    }
  });
});

describe('where a destructive action sits in the menu', () => {
  it('moves it last, however the caller listed it', () => {
    const rename = action('rename');
    const archive = action('archive');
    const remove = action('delete', { destructive: true });
    expect(orderMenuActions([remove, rename, archive])).toEqual([rename, archive, remove]);
  });

  it('leaves everything else in the order the caller chose', () => {
    const confirm = action('confirm');
    const rename = action('rename');
    const merge = action('merge');
    expect(orderMenuActions([confirm, rename, merge])).toEqual([confirm, rename, merge]);
  });

  it('puts exactly one rule above it, and none above the first item', () => {
    const rename = action('rename');
    const archive = action('archive');
    const remove = action('delete', { destructive: true });
    expect(planMenuRows([rename, archive, remove])).toEqual([
      { action: rename, dividedAbove: false },
      { action: archive, dividedAbove: false },
      { action: remove, dividedAbove: true },
    ]);
  });

  it('rules off the destructive block once, not between its own items', () => {
    // Two destructive actions are set apart from the rest, never from each
    // other: a rule between them reads as two blocks where there is one.
    const rename = action('rename');
    const remove = action('delete', { destructive: true });
    const purge = action('purge', { destructive: true });
    expect(planMenuRows([remove, rename, purge]).map((row) => row.dividedAbove)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('never rules off a menu that is destructive from its first item', () => {
    // A divider above the first item is a rule between a menu and its own edge.
    const remove = action('delete', { destructive: true });
    expect(planMenuRows([remove]).map((row) => row.dividedAbove)).toEqual([false]);
  });
});

describe('what a row’s action cell actually renders', () => {
  it('draws each inline action as a real button named after the row’s object', () => {
    const markup = render(
      <RowActions
        menuLabel="More actions for Algebra"
        actions={[
          action('rename', { label: 'Rename', ariaLabel: 'Rename Algebra', selfEvident: true }),
          action('disable', { label: 'Disable', ariaLabel: 'Disable Algebra' }),
        ]}
      />,
    );
    expect(markup).toContain('<button');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Rename Algebra"');
    expect(markup).toContain('aria-label="More actions for Algebra"');
    // Two controls on the row and no more: the pencil and the ⋮.
    expect(markup.match(/<button/gu)?.length).toBe(2);
  });

  it('shows no action text on the row: the words live in the menu', () => {
    const markup = render(
      <RowActions
        menuLabel="More actions for Algebra"
        actions={[
          action('rename', { label: 'Rename', ariaLabel: 'Rename Algebra', selfEvident: true }),
          action('disable', { label: 'Disable', ariaLabel: 'Disable Algebra' }),
        ]}
      />,
    );
    // The wrapping this component exists to fix is text in the action cell.
    const visible = markup.replace(/<[^>]*>/gu, '').trim();
    expect(visible).toBe('');
  });

  it('carries the disclosure state and target on the toggle itself', () => {
    const markup = render(
      <RowActions
        menuLabel="More actions for a@b.test"
        actions={[
          action('toggle', {
            label: 'Hide consumption',
            ariaLabel: 'Consumption for a@b.test',
            selfEvident: true,
            expanded: true,
            controls: 'consumption-1',
          }),
        ]}
      />,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="consumption-1"');
    expect(markup).toContain('aria-label="Consumption for a@b.test"');
    // On a real button, never on a span dressed up as one (UX-DR30).
    expect(markup).toMatch(/<button[^>]*aria-expanded="true"/u);
    // One action, so no ⋮ beside it.
    expect(markup.match(/<button/gu)?.length).toBe(1);
  });

  it('disables the inline control the caller disabled', () => {
    const markup = render(
      <RowActions
        menuLabel="More actions for Algebra"
        actions={[
          action('toggle', {
            label: 'Show',
            ariaLabel: 'Show Algebra',
            selfEvident: true,
            disabled: true,
            icon: <Eye size={16} aria-hidden="true" />,
          }),
        ]}
      />,
    );
    expect(markup).toMatch(/<button[^>]*disabled/u);
  });

  it('renders nothing at all for a row with no actions', () => {
    // Never an empty ⋮ that opens onto nothing.
    expect(render(<RowActions menuLabel="More actions" actions={[]} />)).toBe('');
  });

  it('states no sentence of its own: every string arrives as a prop', () => {
    expect(SOURCE).not.toMatch(/adminCopy|parentCopy|studentCopy|commonCopy/u);
  });
});
