'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminCopy } from '@/copy/admin';
import { readToken, signIn, writeToken } from '@/lib/admin-api';
import { density } from '@/theme/tokens';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An operator who is already signed in has no reason to see this form.
  useEffect(() => {
    if (readToken()) router.replace('/admin/taxonomy');
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      writeToken(await signIn(email, password));
      router.replace('/admin/taxonomy');
    } catch {
      // One message for both an unknown operator and a wrong password.
      setError(adminCopy.signIn.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {adminCopy.signIn.title}
        </Typography>
        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{ display: 'grid', gap: `${density.gap}px` }}
          noValidate
        >
          <TextField
            id="admin-email"
            label={adminCopy.signIn.emailLabel}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <TextField
            id="admin-password"
            label={adminCopy.signIn.passwordLabel}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && (
            <Alert severity="error" role="alert" variant="outlined">
              {error}
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? adminCopy.signIn.submitting : adminCopy.signIn.submit}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
