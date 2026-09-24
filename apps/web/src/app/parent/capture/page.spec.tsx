import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import type { PageImageView } from '@/lib/parent-api';
import { parentTheme } from '@/theme/theme';
import { density } from '@/theme/tokens';
import { PageStrip, type PageStripProps } from './PageStrip';

const DIR = import.meta.dirname;

/** The screen's own source, for the rules it states rather than renders. */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');

function page(ordinal: number): PageImageView {
  return {
    id: `page-${ordinal}`,
    ordinal,
    state: 'Ready',
    width: 40,
    height: 60,
    byteSize: 512,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const THREE = [page(1), page(2), page(3)];

function render(overrides: Partial<PageStripProps> = {}): string {
  const props: PageStripProps = {
    pages: THREE,
    editable: true,
    busy: false,
    onMove: () => undefined,
    onRetake: () => undefined,
    onDelete: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: parentTheme }, createElement(PageStrip, props)),
  );
}

/**
 * The markup between a row's opening `<li` and the next one — everything that
 * belongs to exactly one page, so an assertion about "page 2's controls" cannot
 * be satisfied by page 1's.
 */
function rowFor(markup: string, ordinal: number): string {
  const rows = markup.split('<li').slice(1);
  const row = rows.find((candidate) => candidate.includes(`data-ordinal="${ordinal}"`));
  if (row === undefined) throw new Error(`No row for page ${ordinal}.`);
  return row;
}

describe('the strip is an ordered list', () => {
  it('renders an <ol> whose list semantics survive `list-style: none`', () => {
    const markup = render();
    expect(markup).toContain('<ol');
    // WebKit drops list semantics from a list styled with no markers, which is
    // exactly what this list is. The role is re-applied so the criterion holds.
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
  });

  it('names the list by the heading above it rather than repeating its words', () => {
    const markup = render();
    expect(markup).toContain('aria-labelledby="capture-order-heading"');
    // The same words as an `aria-label` would be announced twice.
    expect(markup).not.toContain(`aria-label="${parentCopy.capture.orderLabel}"`);
    // And the screen renders the heading that id points at.
    expect(PAGE_SOURCE).toContain('id={ORDER_HEADING_ID}');
  });

  it('gives every page a row carrying its ordinal, in stored order', () => {
    const markup = render();
    expect(markup.match(/<li/g)).toHaveLength(THREE.length);
    for (const item of THREE) {
      expect(rowFor(markup, item.ordinal)).toContain(parentCopy.capture.pageLabel(item.ordinal));
    }
    // In order: page 1's row opens before page 2's, which opens before page 3's.
    expect(markup.indexOf('data-ordinal="1"')).toBeLessThan(markup.indexOf('data-ordinal="2"'));
    expect(markup.indexOf('data-ordinal="2"')).toBeLessThan(markup.indexOf('data-ordinal="3"'));
  });
});

describe('every action is a real control naming the page it acts on', () => {
  it('gives each row four controls, each accessibly named by its ordinal', () => {
    const markup = render();
    for (const item of THREE) {
      const row = rowFor(markup, item.ordinal);
      expect(row).toContain(`aria-label="${parentCopy.capture.moveUpFor(item.ordinal)}"`);
      expect(row).toContain(`aria-label="${parentCopy.capture.moveDownFor(item.ordinal)}"`);
      expect(row).toContain(`aria-label="${parentCopy.capture.retakeFor(item.ordinal)}"`);
      expect(row).toContain(`aria-label="${parentCopy.capture.deleteFor(item.ordinal)}"`);
    }
  });

  it('draws them as focusable elements, never as decorated divs', () => {
    const row = rowFor(render(), 2);
    // Three real buttons and one real file input — the mockup's `div.iconbtn`
    // is deliberately not what this builds.
    expect(row.match(/<button/g)).toHaveLength(3);
    expect(row).toContain('type="file"');
    expect(row).not.toContain('<div role="button"');
  });

  it('labels the retake input so it is reachable by its visible word too', () => {
    const row = rowFor(render(), 2);
    expect(row).toContain('for="capture-retake-page-2"');
    expect(row).toContain('id="capture-retake-page-2"');
    expect(row).toContain(parentCopy.capture.retake);
  });

  it('states no user-facing string of its own', () => {
    const source = readFileSync(path.resolve(DIR, 'PageStrip.tsx'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    // Every visible word and every accessible name comes from the copy module.
    expect(code).not.toMatch(/(aria-label|children)=["']/);
    expect(code.match(/parentCopy\.capture\./g)?.length ?? 0).toBeGreaterThan(6);
  });
});

describe('the controls at the ends are disabled as rendered', () => {
  it('disables move-up on the first row and move-down on the last', () => {
    const markup = render();
    const first = rowFor(markup, 1);
    const last = rowFor(markup, 3);
    const middle = rowFor(markup, 2);

    expect(disabledNames(first)).toContain(parentCopy.capture.moveUpFor(1));
    expect(disabledNames(first)).not.toContain(parentCopy.capture.moveDownFor(1));
    expect(disabledNames(last)).toContain(parentCopy.capture.moveDownFor(3));
    expect(disabledNames(last)).not.toContain(parentCopy.capture.moveUpFor(3));
    expect(disabledNames(middle)).toEqual([]);
  });

  it('disables both on a strip of one', () => {
    const row = rowFor(render({ pages: [page(1)] }), 1);
    expect(disabledNames(row)).toEqual([
      parentCopy.capture.moveUpFor(1),
      parentCopy.capture.moveDownFor(1),
    ]);
  });

  it('locks every control while a write is in flight', () => {
    const row = rowFor(render({ busy: true }), 2);
    expect(disabledNames(row)).toEqual([
      parentCopy.capture.moveUpFor(2),
      parentCopy.capture.moveDownFor(2),
      parentCopy.capture.retakeFor(2),
      parentCopy.capture.deleteFor(2),
    ]);
  });
});

describe('a submitted Source Test is terminal', () => {
  it('keeps the pages visible and offers no control on any of them', () => {
    const markup = render({ editable: false });
    expect(markup.match(/<li/g)).toHaveLength(THREE.length);
    expect(markup).toContain(parentCopy.capture.pageLabel(2));
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('type="file"');
  });

  it('is what the screen gates its add and submit controls on too', () => {
    // Rendering the whole screen would need a router and an elevation
    // provider, which this suite has neither of; these are the gates.
    expect(PAGE_SOURCE).toContain('const isDraft = sourceTest !== null');
    expect(PAGE_SOURCE).toContain('const addable = isDraft &&');
    expect(PAGE_SOURCE).toContain('const submittable = isDraft &&');
    expect(PAGE_SOURCE).toContain('{isDraft && (');
  });
});

describe('the parent tap-target floor', () => {
  it('is applied to every strip control from the density token', () => {
    const markup = render();
    // MUI emits the figure into the stylesheet it renders with the markup, so
    // the floor is assertable rather than merely intended.
    expect(markup).toContain(`min-height:${density.tapTarget}px`);
    expect(markup).toContain(`min-width:${density.tapTarget}px`);
    expect(density.tapTarget).toBe(44);
  });

  it('writes neither figure as a literal in the component', () => {
    const source = readFileSync(path.resolve(DIR, 'PageStrip.tsx'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).toContain('density.tapTarget');
    expect(code).toContain('focusRing.width');
    expect(code).not.toMatch(/minHeight:\s*44/);
  });

  it('gives every control a visible focus ring', () => {
    expect(render()).toContain('outline:');
  });
});

/** The accessible names of the disabled controls in one row, in order. */
function disabledNames(row: string): string[] {
  const names: string[] = [];
  // Split on element starts so `disabled` is attributed to the element it is
  // actually on, rather than to whichever `aria-label` happens to be nearest.
  for (const element of row.split('<').slice(1)) {
    const head = element.slice(0, element.indexOf('>'));
    if (!/(^|\s)disabled(=|\s|$)/.test(head)) continue;
    const name = /aria-label="([^"]*)"/.exec(head);
    if (name) names.push(name[1]!);
  }
  return names;
}

describe('the announcements the screen makes', () => {
  it('names the page each one is about, by ordinal', () => {
    expect(parentCopy.capture.added(3)).toBe('Page 3 was added.');
    expect(parentCopy.capture.deleted(2, 3)).toBe(
      'Page 2 was deleted. The pages after it are renumbered.',
    );
    expect(parentCopy.capture.deleted(1, 1)).toBe('Page 1 was deleted.');
    expect(parentCopy.capture.retaken(1)).toBe('Page 1 was replaced.');
    expect(parentCopy.capture.moved(1, 3)).toBe('Page 1 is now page 3.');
    expect(parentCopy.capture.submitted).toBe('The pages were submitted.');
  });

  it('states the count line from both figures the API supplies', () => {
    expect(parentCopy.capture.countLine(3, 10)).toBe(
      'Pages are used in this order. 3 of 10 page images.',
    );
    expect(parentCopy.capture.countLine(0, 10)).toContain('0 of 10');
  });

  it('phrases the move and the retake from the server’s answer, not a guess', () => {
    // Both read the page's landing ordinal out of the returned view; a client
    // prediction would still read as success had the server applied otherwise.
    expect(PAGE_SOURCE).toContain('after.pages.findIndex((page) => page.id === pageId) + 1');
    expect(PAGE_SOURCE).toContain('after.pages.find((page) => page.id === pageId)?.ordinal');
  });

  it('says what an add is doing while it is doing it', () => {
    expect(PAGE_SOURCE).toContain("pending === 'add'");
    expect(PAGE_SOURCE).toContain('parentCopy.capture.adding');
  });
});
