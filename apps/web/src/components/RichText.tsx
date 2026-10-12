'use client';

import { createElement, type ReactNode, type SVGProps } from 'react';
import Box from '@mui/material/Box';
import { parentCopy } from '@/copy/parent';
import type { RichTextSegment } from '@/lib/parent-api';
import {
  FIGURE_ATTRIBUTE_PROPS,
  type FigureElement,
  type FigureNode,
  parseFigureSvg,
} from '@/lib/svg-figure';

/**
 * The one renderer for a stored rich-text segment array (AD-32).
 *
 * Generated text crosses the wire as structure rather than as a string, and
 * this is the only place in the app that decides how that structure is drawn.
 * A fraction is drawn as a fraction and carries one spoken reading built from
 * parameterized copy — never flattened to `"1/2"`, because the reading "one
 * half" cannot be recovered from a glyph, and the schema went to the trouble of
 * keeping the two parts apart exactly so it would not have to be.
 *
 * It renders content and nothing else: no heading, no label, no wrapper with a
 * role of its own. Where the text sits, what type role it takes and what
 * announces it belong to the screen placing it.
 */
export function RichText({ segments }: { segments: readonly RichTextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        // The index is the key because a segment array has no identity of its
        // own and two runs of identical text are genuinely two segments.
        if (segment.kind === 'text') {
          return (
            <span key={index} data-testid="rich-text-segment">
              {segment.value}
            </span>
          );
        }
        if (segment.kind === 'fraction') return <Fraction key={index} segment={segment} />;
        if (segment.kind === 'figure') return <Figure key={index} segment={segment} />;
        // Neither, which the type says cannot happen and the wire does not
        // guarantee: the read casts stored JSON rather than re-parsing it, so a
        // row written by a later story with a kind this build has never heard
        // of arrives here. Rendering nothing drops one segment; the `else` this
        // replaces drew it as a fraction reading "undefined over undefined".
        return null;
      })}
    </>
  );
}

/**
 * A fraction, as structure plus one reading.
 *
 * `role="math"` with an `aria-label` replaces the whole subtree for a screen
 * reader, which is the point: read part by part, a superscript, a solidus and a
 * subscript are announced as three disconnected numbers. The visible form keeps
 * the numerator above the denominator so a parent reads it as a fraction too.
 */
function Fraction({ segment }: { segment: Extract<RichTextSegment, { kind: 'fraction' }> }) {
  return (
    <Box
      component="span"
      role="math"
      aria-label={parentCopy.drafts.fractionReading(segment)}
      data-testid="rich-text-fraction"
      data-numerator={segment.numerator}
      data-denominator={segment.denominator}
      data-whole={segment.whole === null ? '' : segment.whole}
      sx={{ whiteSpace: 'nowrap' }}
    >
      {/* A mixed number's whole part sits before the fraction, with the space
          it is written with on paper. */}
      {segment.whole !== null && <span>{segment.whole} </span>}
      <sup>{segment.numerator}</sup>
      {'⁄'}
      <sub>{segment.denominator}</sub>
    </Box>
  );
}

/**
 * A figure, as drawing plus one name.
 *
 * **Parsed again, and built as elements rather than markup.** The stored SVG
 * was sanitized on the way into storage and is re-parsed here through the
 * browser's own mirror of that allowlist: the read casts stored JSON rather
 * than re-validating it, so a row an older build wrote arrives unvetted, and
 * neither side trusts the other. Because the parse already produces a tree,
 * walking it into React elements costs nothing extra and the raw-HTML escape
 * hatch never has to appear here at all — which is the honest way to keep a
 * property three specs already assert against this app's sources.
 *
 * A figure that fails the parse renders **nothing**: no prose describing the
 * shape, no placeholder glyph. A sentence invented about a drawing nobody could
 * verify is the thing extraction's never-guess rule exists to prevent, and a
 * broken-image mark would read as an error the parent could act on.
 *
 * `role="img"` with an `aria-label` replaces the whole subtree, exactly as
 * `Fraction` does: a figure is one image with one name, announced once, not a
 * list of the paths it is drawn from. No colour is set anywhere — every paint
 * the sanitizer let through is `currentColor` or `none`, so the figure is drawn
 * in whatever colour the text around it is, in both themes.
 */
function Figure({ segment }: { segment: Extract<RichTextSegment, { kind: 'figure' }> }) {
  let root: FigureElement;
  try {
    root = parseFigureSvg(segment.svg);
  } catch {
    return null;
  }
  return (
    <Box
      component="svg"
      {...(figureProps(root) as SVGProps<SVGSVGElement>)}
      role="img"
      aria-label={segment.alt}
      data-testid="rich-text-figure"
      sx={(theme) => ({
        // Responsive to the column it sits in, with a ceiling so a figure never
        // pushes the question it belongs to off the screen. Both figures come
        // from the spacing scale; neither is a literal (AD-32).
        display: 'inline-block',
        verticalAlign: 'middle',
        width: '100%',
        maxWidth: theme.spacing(30),
        maxHeight: theme.spacing(24),
        color: 'inherit',
        fill: 'currentColor',
        stroke: 'currentColor',
      })}
    >
      {root.children.map(figureNode)}
    </Box>
  );
}

/**
 * The props an element may carry, read out of the allowlist's own map.
 *
 * Nothing else is consulted, so the renderer can only ever set a prop the
 * sanitizer admits: an attribute that somehow survived the parse without a
 * mapping is dropped rather than spread onto an element.
 */
function figureProps(element: FigureElement): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [attribute, value] of Object.entries(element.attributes)) {
    const prop = FIGURE_ATTRIBUTE_PROPS[attribute];
    if (prop !== undefined) props[prop] = value;
  }
  return props;
}

/** One node of the parsed figure, as a React element or as escaped characters. */
function figureNode(node: FigureNode, index: number): ReactNode {
  if (node.kind === 'text') return node.value;
  return createElement(
    node.tag,
    // The index is the key for the same reason it is in `RichText`: a parsed
    // shape has no identity of its own and two identical paths are two paths.
    { key: index, ...figureProps(node) },
    node.children.length === 0 ? undefined : node.children.map(figureNode),
  );
}
