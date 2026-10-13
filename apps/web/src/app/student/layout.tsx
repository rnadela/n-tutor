import Box from '@mui/material/Box';
import { StudentBottomNav } from './_components/StudentBottomNav';
import { StudentThemeProvider } from './_components/StudentThemeProvider';
import { comfortableDensity } from '@/theme/tokens';

/**
 * Student Mode's shell.
 *
 * There is deliberately no `ElevationProvider` here: Student Mode never holds a
 * parent credential, so the context that carries one does not exist on this
 * side of the boundary at all. The spacing is the comfortable set — a child's
 * surface is roomier than a parent's console — and every figure comes from
 * tokens.
 */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentThemeProvider>
      <Box
        component="main"
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          paddingBlock: `${comfortableDensity.sectionMargin}px`,
          paddingInline: `${comfortableDensity.cardPadding}px`,
        }}
      >
        {children}
      </Box>
      {/*
        Outside the `main` landmark: the bar is chrome, not content. It brings
        its own clearance with it — this layout is a server component and knows
        no pathname, so a bottom padding stated here would also end the Attempt
        a bar's height early, on the one screen that carries no bar.
      */}
      <StudentBottomNav />
    </StudentThemeProvider>
  );
}
