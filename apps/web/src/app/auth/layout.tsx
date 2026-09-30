import Box from '@mui/material/Box';
import { AuthThemeProvider } from './_components/AuthThemeProvider';
import { density } from '@/theme/tokens';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthThemeProvider>
      <Box
        component="main"
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBlock: `${density.sectionMargin}px`,
          paddingInline: `${density.cardPadding}px`,
        }}
      >
        <Box sx={{ width: '100%' }}>{children}</Box>
      </Box>
    </AuthThemeProvider>
  );
}
