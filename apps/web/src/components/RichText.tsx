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
 *
 * **Where a figure sits is decided here, and nowhere else.** A field holding a
 * figure renders its segments inside a block wrapper, so the segments get a
 * normal-flow formatting context whatever layout the placing surface uses —
 * `display: block` on the drawing alone is enough inside a paragraph and
 * useless inside the draft-review option list item, which is `display: flex`
 * and would simply lay the block svg out as the next item on the row.
 *
 * The wrapper mounts **only when a figure is present**: a field of text and
 * fractions is every field of every draft generated from a source test with
 * nothing drawn on it, and it keeps the exact markup it rendered before, so no
 * figure-less surface and no existing test is touched by this.
 *
 * It is a `span` with `display: block` rather than a `div` because of where the
 * placing surfaces put it: inside a `Typography component="p"` (draft review's
 * prompt, Take Test's prompt, the answer key's prompt), inside a
 * `component="li"` (draft review's option), and inside the label span MUI's
 * `FormControlLabel` renders (the student's option tile). A `span` carrying
 * `display: block` is valid phrasing content in every one of those; a `div`
 * inside a `p` is markup a browser re-parses out from under the app.
 */
export function RichText({ segments }: { segments: readonly RichTextSegment[] }) {
  const drawn = segments.map((segment, index) => {
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
  });
  // Decided from the stored segments rather than from what drew: a figure the
  // mirror refuses renders nothing, and the text around it is laid out the same
  // either way.
  const hasFigure = segments.some((segment) => segment.kind === 'figure');
  if (!hasFigure) return <>{drawn}</>;
  return (
    <Box
      component="span"
      data-testid="rich-text-block"
      // No inset and no horizontal margin: the figure's left edge lines up with
      // the left edge of the text above it.
      sx={{ display: 'block', width: '100%' }}
    >
      {drawn}
    </Box>
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
      // After the spread, so nothing a stored row carries can override it —
      // and nothing can: `preserveAspectRatio` is not in the allowlist, so a
      // stored figure never has one of its own.
      //
      // Why it is set at all: the element box is the full column width under a
      // height ceiling, so a drawing taller than it is wide letterboxes inside
      // that box, and the default `xMidYMid` would centre it there — a tall
      // number line would float in the middle of the column with empty space
      // to its left. Left-aligned with the words above it is the rule, so the
      // drawing is pinned to the box's left edge instead of centred in it.
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={segment.alt}
      data-testid="rich-text-figure"
      sx={(theme) => ({
        // Responsive to the column it sits in, with a ceiling so a figure never
        // pushes the question it belongs to off the screen. Both figures come
        // from the spacing scale; neither is a literal (AD-32).
        //
        // A block, so the text before it ends its line and the text after it
        // starts a new one — never beside the drawing. The vertical space is a
        // spacing-scale read like the ceilings; there is no horizontal margin,
        // because the drawing is left-aligned with the text above it.
        display: 'block',
        width: '100%',
        maxWidth: theme.spacing(30),
        maxHeight: theme.spacing(24),
        marginBlock: theme.spacing(1),
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
