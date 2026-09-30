import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { GraduationCap } from 'lucide-react';
import { parentCopy } from '@/copy/parent';
import { density } from '@/theme/tokens';

/**
 * The one eyebrow every auth and PIN screen states before its own title —
 * the account is `n-test-reviewer`'s regardless of which of the flow's
 * screens got here, and repeating that in every screen's own copy would be
 * one more place for the name to drift. Decorative only: the screen's own
 * `<h1>` is what a heading-level scan finds.
 */
export function AuthBrand() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        mb: `${density.gap}px`,
      }}
    >
      <GraduationCap size={20} aria-hidden="true" />
      <Typography
        component="p"
        aria-hidden="true"
        sx={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.02em' }}
      >
        {parentCopy.appName}
      </Typography>
    </Box>
  );
}
