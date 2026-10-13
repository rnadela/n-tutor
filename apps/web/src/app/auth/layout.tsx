import Box from '@mui/material/Box';
import { AuthThemeProvider } from './_components/AuthThemeProvider';
import { ColorModeSwitch } from '@/components/ColorModeSwitch';
import { density } from '@/theme/tokens';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthThemeProvider>
      {/*
        The column that fills the viewport, so the header can sit above the card
        without the card losing its centring: this box owns the full height and
        `main` grows into whatever is left, which keeps the card in the middle of
        the space that remains rather than the middle of the window.
      */}
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/*
          The sign-in surfaces' only chrome, and it exists for one control: a
          family arriving at the app before they have an account still gets to
          choose light or dark, and the choice they make here is the one every
          other surface then uses (UX-DR45).
        */}
        <Box
          component="header"
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBlock: `${density.gap}px`,
            paddingInline: `${density.cardPadding}px`,
          }}
        >
          <ColorModeSwitch />
        </Box>
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingBlock: `${density.sectionMargin}px`,
            paddingInline: `${density.cardPadding}px`,
          }}
        >
          <Box sx={{ width: '100%' }}>{children}</Box>
        </Box>
      </Box>
    </AuthThemeProvider>
  );
}
