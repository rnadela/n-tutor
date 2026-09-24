'use client';

import Box from '@mui/material/Box';
import { parentCopy } from '@/copy/parent';
import type { RichTextSegment } from '@/lib/parent-api';

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
