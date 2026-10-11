'use client';

import { useEffect } from 'react';
import type { Route } from 'next';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import { ChevronRight } from 'lucide-react';
import { adminCopy } from '@/copy/admin';
import { readToken } from '@/lib/admin-api';
import { density, rounded } from '@/theme/tokens';
import { NAV_ITEMS } from './_components/AdminChrome';

/** What each area is for, keyed by the destination the sidebar names. */
const DESCRIPTIONS: Record<string, string> = {
  '/admin/taxonomy': adminCopy.home.taxonomy,
  '/admin/accounts': adminCopy.home.accounts,
  '/admin/flagged-explanations': adminCopy.home.flaggedExplanations,
  '/admin/topics': adminCopy.home.topics,
};

/**
 * The console's landing: one card per area, read from the same list the sidebar
 * is, so `/admin` is a place rather than a 404.
 *
 * It reads nothing from the API. The only gate is the token every other Admin
 * screen checks first; a token the server has since rejected is caught by
 * whichever screen the operator opens next.
 */
export default function AdminHomePage() {
  const router = useRouter();

  useEffect(() => {
    if (!readToken()) router.replace('/admin/login');
  }, [router]);

  return (
    <Box
      component="section"
      sx={{ maxWidth: 840, mx: 'auto', display: 'grid', gap: `${density.gap * 2}px` }}
    >
      <Box component="header" sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {adminCopy.home.title}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {adminCopy.home.intro}
        </Typography>
      </Box>

      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gap: `${density.gap * 1.5}px`,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Box component="li" key={item.href}>
              <Card sx={{ height: '100%' }}>
                {/* Client-side, like every other link in the console. */}
                <CardActionArea
                  component={NextLink}
                  href={item.href as Route}
                  sx={{
                    height: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    alignItems: 'start',
                    columnGap: `${density.gap * 1.5}px`,
                    p: `${density.cardPadding + density.gap / 2}px`,
                    '& .tile-chevron': {
                      transition: (theme) => theme.transitions.create('transform'),
                    },
                    '&:hover .tile-chevron, &:focus-visible .tile-chevron': {
                      transform: 'translateX(2px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 36,
                      height: 36,
                      borderRadius: `${rounded.control}px`,
                      bgcolor: 'action.selected',
                      color: 'primary.main',
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </Box>
                  <Box sx={{ display: 'grid', gap: '2px', minWidth: 0 }}>
                    <Typography component="h2" sx={{ fontWeight: 700 }}>
                      {item.label}
                    </Typography>
                    <Typography
                      component="p"
                      sx={{ color: 'text.secondary', fontSize: '0.9375rem' }}
                    >
                      {DESCRIPTIONS[item.href]}
                    </Typography>
                  </Box>
                  <Box
                    className="tile-chevron"
                    sx={{ display: 'inline-flex', color: 'text.secondary', pt: '2px' }}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </Box>
                </CardActionArea>
              </Card>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
