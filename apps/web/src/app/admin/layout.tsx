import Box from '@mui/material/Box';
import { AdminThemeProvider } from './_components/AdminThemeProvider';
import { AdminChrome } from './_components/AdminChrome';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminThemeProvider>
      <Box component="div" sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AdminChrome>{children}</AdminChrome>
      </Box>
    </AdminThemeProvider>
  );
}
