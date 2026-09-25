'use client';

import { useId } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import { fractionOf } from '@/lib/smart-fraction';
import { comfortableDensity, focusRing, rounded, typeRoles } from '@/theme/tokens';

/**
 * The fill-in-the-blank control: one real `<input>`, and a typographic sibling
 * **beside** it (UX-DR24, UX-DR32 case 1).
 *
 * **The input holds the raw typed string and is the only value there is.** It is
 * what the child sees, what assistive technology announces, and what a later
 * story submits. Nothing masks it, reformats it, completes it or refuses it: a
 * child who types `one half` has answered `one half`, and a child two keystrokes
 * into `3/4` has typed `3/` and is left alone.
 *
 * **The stacked rendering is adjacent, never overlaid.** An overlaid render has
 * to track caret position, font loading, zoom and text scaling to stay aligned,
 * and every one of those is a way to lose a keystroke. Beside the input,
 * misalignment is cosmetic. It carries `aria-hidden` so the answer is never
 * announced twice, and `fractionOf` answering `null` is the specified
 * degradation: no sibling at all, and the input untouched.
 *
 * The border and the focus ring sit on the wrapper — `:focus-within`, so
 * focusing the real input rings the whole field — which is what lets the sibling
 * live inside the same visual control without being a second one.
 */
export function SmartFractionField({
  value,
  onChange,
  describedBy,
}: {
  /** The raw typed string. The sole accessible and submitted value. */
  value: string;
  onChange(next: string): void;
  /** Ids of anything that describes this field beyond its own label. */
  describedBy?: string;
}) {
  const inputId = useId();
  const helpId = useId();
  const parsed = fractionOf(value);

  return (
    <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}>
      <Typography component="label" htmlFor={inputId} sx={{ ...typeRoles.label }}>
        {studentCopy.takeTest.answerLabel}
      </Typography>
      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: `${comfortableDensity.gap}px`,
          minHeight: `${comfortableDensity.tapTarget}px`,
          paddingInline: `${comfortableDensity.gap}px`,
          border: `1px solid ${theme.vars.palette.divider}`,
          borderRadius: `${rounded.control}px`,
          // One ring for the whole control, drawn where the child's attention
          // already is. The input itself has no second ring of its own.
          '&:focus-within': {
            outline: `${focusRing.width}px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: focusRing.offset,
          },
        })}
      >
        <Box
          component="input"
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={describedBy === undefined ? helpId : `${describedBy} ${helpId}`}
          data-testid="answer-fraction-input"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: `${comfortableDensity.tapTarget}px`,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            fontFamily: typeRoles.questionBody.fontFamily,
            fontSize: typeRoles.questionBody.fontSize,
            lineHeight: typeRoles.questionBody.lineHeight,
          }}
        />
        {/* Beside the input and hidden from assistive technology: the answer is
            the input's, and announcing it twice would be two answers. Absent
            entirely when the raw string is not a fraction. */}
        {parsed !== null && (
          <Box
            aria-hidden="true"
            data-testid="answer-fraction-preview"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25em',
              fontFamily: typeRoles.questionBody.fontFamily,
              fontSize: typeRoles.questionBody.fontSize,
              whiteSpace: 'nowrap',
            }}
          >
            {parsed.whole !== null && <span>{parsed.whole}</span>}
            <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box component="span">{parsed.numerator}</Box>
              <Box
                component="span"
                sx={(theme) => ({
                  borderTop: `1px solid ${theme.vars.palette.text.primary}`,
                  width: '100%',
                  textAlign: 'center',
                })}
              >
                {parsed.denominator}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
      <Typography id={helpId} sx={{ ...typeRoles.caption }}>
        {studentCopy.takeTest.fractionHelp}
      </Typography>
    </Box>
  );
}
