'use client';

import Box from '@mui/material/Box';
import { density, measure } from '@/theme/tokens';

/**
 * The single fluid layout primitive (UX-DR36).
 *
 * One column, gutters and rhythm driven entirely by the surface's density
 * tokens, and deliberately unchanged between phone and tablet: there is no
 * breakpoint here, because every screen but Take Test and Analytics is the
 * same layout at every width. Desktop is supported, not optimised.
 */
export function Screen({
  children,
  component = 'main',
  measured = false,
}: {
  children: React.ReactNode;
  /** The landmark this column is. `main` unless the caller is nesting. */
  component?: React.ElementType;
  /**
   * Caps the column at the 34rem measure. Off by default: the cap belongs to
   * generated Question and Explanation content, not to chrome.
   */
  measured?: boolean;
}) {
  return (
    <Box
      component={component}
      sx={(theme) => {
        // `theme.density` is optional on `ThemeOptions`, so a theme not built
        // by `buildTheme` would otherwise resolve every gutter to
        // `undefinedpx` and collapse the layout. The compact set is the floor.
        const d = theme.density ?? density;
        return {
          display: 'flex',
          flexDirection: 'column',
          gap: `${d.gap}px`,
          width: '100%',
          marginInline: 'auto',
          paddingInline: `${d.cardPadding}px`,
          paddingBlock: `${d.sectionMargin}px`,
          ...(measured ? { maxWidth: measure.questionMaxWidth } : {}),
        };
      }}
    >
      {children}
    </Box>
  );
}
