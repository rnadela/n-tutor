import Box from '@mui/material/Box';
import { BackToStudentMode } from './_components/BackToStudentMode';
import { ParentThemeProvider } from './_components/ParentThemeProvider';
import { ElevationProvider } from '@/lib/elevation';
import { density } from '@/theme/tokens';

/**
 * The elevation token is held by a provider mounted here, so it lives exactly
 * as long as this route group stays mounted — a reload unmounts it and the PIN
 * is required again, which is the gate (AD-18).
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <ParentThemeProvider>
      <ElevationProvider>
        <Box
          component="main"
          sx={{
            minHeight: '100vh',
            bgcolor: 'background.default',
            paddingBlock: `${density.sectionMargin}px`,
            paddingInline: `${density.cardPadding}px`,
          }}
        >
          {/* Above every Parent View surface, so the way out of Parent View
              exists wherever the parent happens to be standing. It renders
              itself as nothing while no elevation is held. */}
          <BackToStudentMode />
          {children}
        </Box>
      </ElevationProvider>
    </ParentThemeProvider>
  );
}
