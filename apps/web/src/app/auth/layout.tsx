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
          paddingBlock: `${density.sectionMargin}px`,
          paddingInline: `${density.cardPadding}px`,
        }}
      >
        {children}
      </Box>
    </AuthThemeProvider>
  );
}
