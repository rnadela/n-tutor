import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { parentTheme } from '@/theme/theme';
import type { RichTextSegment } from '@/lib/parent-api';
import { FIGURE_ATTRIBUTES, FIGURE_ATTRIBUTE_PROPS, parseFigureSvg } from '@/lib/svg-figure';
import { sanitizeFigureSvg } from '../../../api/src/extraction/svg-figure';
import { SANITIZED_FIGURES } from '../../../api/src/extraction/svg-figure.fixtures';
import { RichText } from './RichText';

function render(segments: RichTextSegment[]): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={parentTheme}>
      <RichText segments={segments} />
    </ThemeProvider>,
  );
}

const COMPONENT_SOURCE = readFileSync(path.resolve(import.meta.dirname, 'RichText.tsx'), 'utf8');

describe('a run of text', () => {
  it('renders exactly what was stored, in order', () => {
    const markup = render([
      { kind: 'text', value: 'What is ' },
      { kind: 'text', value: 'left?' },
    ]);
    expect(markup).toContain('What is ');
    expect(markup).toContain('left?');
    expect(markup.indexOf('What is ')).toBeLessThan(markup.indexOf('left?'));
  });

  it('adds no heading, label or role of its own', () => {
    // It renders content and nothing else: where the text sits and what
    // announces it belong to the screen placing it.
    const markup = render([{ kind: 'text', value: 'Plain.' }]);
    expect(markup).not.toContain('role=');
    expect(markup).not.toContain('<h');
  });
});

describe('a fraction', () => {
  const half: RichTextSegment = {
    kind: 'fraction',
    whole: null,
    numerator: 1,
    denominator: 2,
  };

  it('renders as structure, never as the glyph', () => {
    // The schema kept the parts apart on purpose (AD-32). Flattening them here
    // would throw away the reading one story after it was preserved.
    const markup = render([half]);
    expect(markup).toContain('<sup>1</sup>');
    expect(markup).toContain('<sub>2</sub>');
    expect(markup).not.toContain('1/2');
  });

  it('carries one spoken reading, built from copy rather than concatenated', () => {
    const markup = render([half]);
    expect(markup).toContain(`aria-label="${parentCopy.drafts.fractionReading(half)}"`);
    // `role="math"` replaces the subtree for a screen reader; read part by
    // part, a superscript and a subscript are two disconnected numbers.
    expect(markup).toContain('role="math"');
  });

  it('keeps a mixed number whole part beside its fraction, and in the reading', () => {
    const mixed: RichTextSegment = {
      kind: 'fraction',
      whole: 2,
      numerator: 3,
      denominator: 4,
    };
    const markup = render([mixed]);
    expect(markup).toContain('2');
    expect(markup).toContain('<sup>3</sup>');
    expect(markup).toContain('<sub>4</sub>');
    expect(markup).toContain(`aria-label="${parentCopy.drafts.fractionReading(mixed)}"`);
    expect(parentCopy.drafts.fractionReading(mixed)).toBe('2 and 3 over 4');
  });

  it('is not what an unrecognized segment kind renders as', () => {
    // The read casts stored JSON rather than re-parsing it, so a kind this
    // build has never heard of is reachable. Drawn as a fraction it would read
    // "undefined over undefined" to a screen reader — a sentence about nothing.
    const markup = render([
      { kind: 'text', value: 'Before ' },
      { kind: 'diagram', value: 'x' } as unknown as RichTextSegment,
      { kind: 'text', value: ' after.' },
    ]);
    expect(markup).not.toContain('role="math"');
    // Not the reading either. Checked against `aria-label` rather than the
    // whole markup: Emotion inlines a stylesheet that says "undefined" on its
    // own account, which has nothing to do with this.
    expect(markup).not.toContain('aria-label');
    expect(markup).not.toContain('<sup>');
    // The segments around it are untouched.
    expect(markup).toContain('Before ');
    expect(markup).toContain(' after.');
  });

  it('renders inside a run of text without swallowing either side', () => {
    const markup = render([
      { kind: 'text', value: 'Add ' },
      half,
      { kind: 'text', value: ' to it.' },
    ]);
    expect(markup).toContain('Add ');
    expect(markup).toContain(' to it.');
    expect(markup).toContain('role="math"');
  });
});

describe('a figure', () => {
  const circle: Extract<RichTextSegment, { kind: 'figure' }> = {
    kind: 'figure',
    svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor"/></svg>',
    alt: 'A circle divided into four equal parts',
  };

  it('is one image named by its text alternative, announced once', () => {
    const markup = render([circle]);
    expect(markup).toContain('role="img"');
    expect(markup).toContain(`aria-label="${circle.alt}"`);
    // Once: a figure is one image with one name, not a list of the paths it is
    // drawn from.
    expect(markup.split('aria-label=').length - 1).toBe(1);
    expect(markup.split('role="img"').length - 1).toBe(1);
  });

  it('draws the parsed shape inside the viewBox it was drawn in', () => {
    const markup = render([circle]);
    expect(markup).toContain('viewBox="0 0 10 10"');
    expect(markup).toContain('<circle');
    expect(markup).toContain('cx="5"');
    expect(markup).toContain('r="4"');
  });

  it('carries no script, handler, external reference, embedded HTML or colour literal', () => {
    const markup = render([
      {
        kind: 'figure',
        svg: '<svg viewBox="0 0 10 10" width="500" height="500"><rect x="0" y="0" width="10" height="10" fill="red" stroke="rgb(0,0,255)"/></svg>',
        alt: 'A square',
      },
    ]);
    // Every "it is not there" below is paired with a "and the shape is": a
    // component that rendered nothing at all would satisfy the negatives on its
    // own, and the test two below this one proves it can render nothing.
    expect(markup).toContain('role="img"');
    expect(markup).toContain('<rect');
    expect(markup).toContain('viewBox="0 0 10 10"');
    expect(markup).toContain('width="10"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).not.toContain('fill="red"');
    expect(markup).not.toContain('rgb(0,0,255)');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('onload');
    expect(markup).not.toContain('href');
    expect(markup).not.toContain('<foreignObject');
    // The root's own sizing is the page's to decide; kept, the responsive width
    // would have nothing to work with — and the inner shape keeps its own.
    expect(markup).not.toContain('width="500"');
    expect(markup).not.toContain('height="500"');
  });

  it('sets every parsed attribute through the prop map, and nothing else', () => {
    // The renderer reads props out of `FIGURE_ATTRIBUTE_PROPS` and nowhere
    // else, so an attribute that reached the tree without a mapping would be
    // dropped rather than spread. Asserted the way it is actually observable:
    // a figure using every allowlisted attribute draws every one of them, each
    // under the name the map gives it.
    const everything =
      '<svg viewBox="0 0 20 20"><g transform="translate(1,1)">' +
      '<rect x="1" y="2" width="3" height="4" stroke-width="0.5" stroke-dasharray="1 2" fill="none" stroke="black"/>' +
      '<circle cx="5" cy="6" r="2"/><ellipse cx="7" cy="8" rx="1" ry="2"/>' +
      '<line x1="0" y1="1" x2="2" y2="3"/><polyline points="0,0 1,1"/><polygon points="2,2 3,3 4,4"/>' +
      '<path d="M0 0L1 1"/>' +
      '<text x="9" y="10" font-size="2" text-anchor="middle" dominant-baseline="central">n</text>' +
      '</g></svg>';
    const markup = render([{ kind: 'figure', svg: everything, alt: 'Everything' }]);
    const parsed = new Set<string>();
    const walk = (node: ReturnType<typeof parseFigureSvg>): void => {
      for (const name of Object.keys(node.attributes)) parsed.add(name);
      for (const child of node.children) if (child.kind === 'element') walk(child);
    };
    walk(parseFigureSvg(everything));
    // Every allowlisted attribute is exercised, so the loop below is a real
    // check rather than a vacuous one.
    expect([...parsed].sort()).toEqual([...FIGURE_ATTRIBUTES].sort());
    // Checked against the attribute spelling, because React maps the prop back
    // on the way out — `strokeWidth` is written as `stroke-width`. What this
    // pins is that each allowlisted attribute survives the map and reaches the
    // element; that the map holds exactly the allowlist and nothing beyond it is
    // `lib/svg-figure.spec.ts`'s assertion.
    for (const name of parsed) {
      expect(FIGURE_ATTRIBUTE_PROPS[name], name).toBeTypeOf('string');
      expect(markup, name).toContain(`${name}=`);
    }
  });

  it('renders the characters of a nested text and tspan', () => {
    const markup = render([
      {
        kind: 'figure',
        svg: '<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/><text x="1" y="9">A <tspan font-size="2">and</tspan> B</text></svg>',
        alt: 'A labelled line',
      },
    ]);
    expect(markup).toContain('<text');
    expect(markup).toContain('<tspan');
    expect(markup).toContain('and');
    expect(markup).toContain('A ');
    expect(markup).toContain(' B');
    expect(markup).toContain('font-size="2"');
  });

  it('gives each of two figures in one field its own name', () => {
    const markup = render([
      circle,
      { kind: 'text', value: ' and ' },
      {
        kind: 'figure',
        svg: '<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4"/></svg>',
        alt: 'A square',
      },
    ]);
    expect(markup.split('role="img"').length - 1).toBe(2);
    expect(markup).toContain(`aria-label="${circle.alt}"`);
    expect(markup).toContain('aria-label="A square"');
  });

  it('renders two identical sibling shapes as two shapes', () => {
    // The index is the key, so two genuinely identical siblings must not
    // collapse into one.
    const markup = render([
      {
        kind: 'figure',
        svg: '<svg viewBox="0 0 10 10"><circle cx="3" cy="5" r="2"/><circle cx="3" cy="5" r="2"/></svg>',
        alt: 'Two circles',
      },
    ]);
    expect(markup.split('<circle').length - 1).toBe(2);
  });

  it('renders nothing at all for a stored figure the mirror refuses', () => {
    // No prose about the shape and no broken-image glyph: a sentence invented
    // about a drawing nobody could verify is what the never-guess rule exists
    // to prevent, and a broken mark would read as an error to act on.
    for (const svg of [
      '<svg viewBox="0 0 1 1"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>',
      '<svg viewBox="0 0 1 1"><circle cx="1" cy="1" r="1" onload="x()"/></svg>',
      '<svg viewBox="0 0 1 1"><circle cx="1" cy="1" r="1" stroke="url(#grad)"/></svg>',
      '<svg><circle cx="1" cy="1" r="1"/></svg>',
      '[A half-circle figure is shown.]',
    ]) {
      const markup = render([
        { kind: 'text', value: 'Before ' },
        { kind: 'figure', svg, alt: 'A shape' },
        { kind: 'text', value: ' after.' },
      ]);
      expect(markup).not.toContain('role="img"');
      expect(markup).not.toContain('aria-label');
      expect(markup).not.toContain('<svg');
      expect(markup).not.toContain('alert(1)');
      expect(markup).not.toContain('A shape');
      // The segments around it are untouched.
      expect(markup).toContain('Before ');
      expect(markup).toContain(' after.');
    }
  });

  it('renders inline within a run of text without swallowing either side', () => {
    const markup = render([
      { kind: 'text', value: 'What shape? ' },
      circle,
      { kind: 'text', value: ' Name it.' },
    ]);
    expect(markup).toContain('What shape? ');
    expect(markup).toContain(' Name it.');
    expect(markup.indexOf('What shape? ')).toBeLessThan(markup.indexOf('<svg'));
    expect(markup.indexOf('<svg')).toBeLessThan(markup.indexOf(' Name it.'));
  });

  it('is built from elements, never from markup handed to the DOM', () => {
    // The sanitizer already produces a tree, so the escape hatch is absent from
    // the design rather than merely unused.
    expect(COMPONENT_SOURCE).not.toContain('dangerouslySetInnerHTML');
    expect(COMPONENT_SOURCE).toContain('createElement');
  });

  it('draws what the API sanitizer actually stores, at the seam between them', () => {
    // The one property no single-side test can state: the read casts stored
    // JSON rather than re-parsing it, so what the browser receives is whatever
    // the API's canonical serialization produced. Fed through the view type the
    // read hands over, every stored figure must draw.
    for (const [input] of SANITIZED_FIGURES) {
      const segment: RichTextSegment = {
        kind: 'figure',
        svg: sanitizeFigureSvg(input),
        alt: 'A stored figure',
      };
      const markup = render([segment]);
      expect(markup).toContain('role="img"');
      expect(markup).toContain('aria-label="A stored figure"');
      expect(markup).toContain('viewBox=');
    }
  });
});
