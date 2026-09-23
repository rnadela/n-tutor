'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { adminCopy } from '@/copy/admin';
import { clearToken } from '@/lib/admin-api';
import { density } from '@/theme/tokens';

export function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const onLoginScreen = pathname === '/admin/login';

  return (
    <Box>
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: `${density.gap}px`,
          minHeight: density.tapTarget + density.gap,
          px: `${density.cardPadding}px`,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography component="p" sx={{ fontWeight: 700 }}>
          {adminCopy.appName}
        </Typography>
        {!onLoginScreen && (
          <Box sx={{ display: 'flex', gap: `${density.gap}px`, alignItems: 'center' }}>
            <Button component={Link} href="/admin/taxonomy">
              {adminCopy.nav.taxonomy}
            </Button>
            <Button
              onClick={() => {
                clearToken();
                router.replace('/admin/login');
              }}
            >
              {adminCopy.nav.signOut}
            </Button>
          </Box>
        )}
      </Box>
      <Box
        component="main"
        sx={{
          maxWidth: 1080,
          mx: 'auto',
          px: `${density.cardPadding}px`,
          py: `${density.sectionMargin}px`,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
