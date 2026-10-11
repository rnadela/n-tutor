'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ChevronDown, ChevronUp, Eye, EyeOff, FileText, Lock, Mail } from 'lucide-react';
import { AuthBrand } from '../_components/AuthBrand';
import { parentCopy } from '@/copy/parent';
import { deviceTimeZone, parentApi, type AuthPolicy } from '@/lib/parent-api';
import { density, rounded } from '@/theme/tokens';

export default function SignUpPage() {
  const router = useRouter();
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedNotice, setAcceptedNotice] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPolicy = useCallback(async () => {
    setPolicyError(null);
    try {
      setPolicy(await parentApi.policy());
    } catch (cause) {
      // A failed load must never leave submit permanently disabled with no way
      // forward: the screen offers a retry instead.
      setPolicy(null);
      setPolicyError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    // Checked here so a short password is named as such, rather than coming
    // back as the endpoint's one generic "could not be created" message.
    if (password.length < policy.passwordMinLength) {
      setError(parentCopy.signUp.passwordMinimum(policy.passwordMinLength));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await parentApi.signUp({
        email,
        password,
        timezone: deviceTimeZone(),
        termsVersion: policy.termsVersion,
        noticeVersion: policy.noticeVersion,
      });
      router.replace('/auth/signed-in');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : parentCopy.signUp.failed);
      // The rejection may be a stale version: re-fetch and make the parent
      // accept again, so there is always a path forward.
      setAcceptedTerms(false);
      setAcceptedNotice(false);
      await loadPolicy();
    } finally {
      setBusy(false);
    }
  }

  const ready = policy !== null && acceptedTerms && acceptedNotice;

  return (
    <Box sx={{ maxWidth: 520, mx: 'auto' }}>
      <AuthBrand />
      <Card>
        <CardContent>
          <Typography
            component="h1"
            sx={{ fontSize: 20, fontWeight: 700, textAlign: 'center', mb: `${density.gap}px` }}
          >
            {parentCopy.signUp.title}
          </Typography>
          <Typography
            sx={{ mb: `${density.gap * 2}px`, color: 'text.secondary', textAlign: 'center' }}
          >
            {parentCopy.signUp.intro}
          </Typography>

          {policyError && (
            <Alert
              severity="error"
              role="alert"
              variant="outlined"
              sx={{ mb: `${density.gap}px` }}
              action={<Button onClick={() => void loadPolicy()}>{parentCopy.errors.retry}</Button>}
            >
              {policyError}
            </Alert>
          )}

          <Box
            component="form"
            onSubmit={onSubmit}
            sx={{ display: 'grid', gap: `${density.gap}px` }}
            noValidate
          >
            <TextField
              id="parent-email"
              label={parentCopy.signUp.emailLabel}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Mail size={18} aria-hidden="true" />
                    </InputAdornment>
                  ),
                },
              }}
              required
            />
            <TextField
              id="parent-password"
              label={parentCopy.signUp.passwordLabel}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              // The minimum is stated before submission, and it comes from the API.
              helperText={
                policy ? parentCopy.signUp.passwordMinimum(policy.passwordMinLength) : undefined
              }
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock size={18} aria-hidden="true" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((shown) => !shown)}
                        edge="end"
                      >
                        {showPassword ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              required
            />

            <ConsentBlock
              open={showTerms}
              onToggle={() => setShowTerms((shown) => !shown)}
              toggleLabel={showTerms ? parentCopy.signUp.hideTerms : parentCopy.signUp.showTerms}
              text={policy?.termsText ?? null}
              accepted={acceptedTerms}
              checkbox={
                <FormControlLabel
                  control={
                    <Checkbox
                      id="accept-terms"
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
                    />
                  }
                  label={parentCopy.signUp.termsLabel}
                />
              }
            />
            <ConsentBlock
              open={showNotice}
              onToggle={() => setShowNotice((shown) => !shown)}
              toggleLabel={showNotice ? parentCopy.signUp.hideNotice : parentCopy.signUp.showNotice}
              text={policy?.noticeText ?? null}
              accepted={acceptedNotice}
              checkbox={
                <FormControlLabel
                  control={
                    <Checkbox
                      id="accept-notice"
                      checked={acceptedNotice}
                      onChange={(event) => setAcceptedNotice(event.target.checked)}
                    />
                  }
                  label={parentCopy.signUp.noticeLabel}
                />
              }
            />

            {error && (
              <Alert severity="error" role="alert" variant="outlined">
                {error}
              </Alert>
            )}
            <Button
              type="submit"
              variant="contained"
              disabled={busy || !ready}
              sx={{ minHeight: density.tapTarget }}
            >
              {busy ? parentCopy.signUp.submitting : parentCopy.signUp.submit}
            </Button>
            <Divider />
            <Link href="/auth/sign-in" sx={{ textAlign: 'center' }}>
              {parentCopy.signUp.haveAccount}
            </Link>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

/**
 * One consent as one unit: the way to read it, the text itself, and the box that
 * accepts it, inside a single border — so what is being accepted sits directly
 * above the control that accepts it. The border takes the accent once accepted.
 */
function ConsentBlock({
  open,
  onToggle,
  toggleLabel,
  text,
  accepted,
  checkbox,
}: {
  open: boolean;
  onToggle: () => void;
  toggleLabel: string;
  text: string | null;
  accepted: boolean;
  checkbox: React.ReactNode;
}) {
  return (
    <Box
      sx={(theme) => ({
        border: '1px solid',
        borderColor: accepted ? 'primary.main' : 'divider',
        borderRadius: `${rounded.control}px`,
        transition: theme.transitions.create('border-color'),
      })}
    >
      <Button
        type="button"
        fullWidth
        onClick={onToggle}
        endIcon={
          open ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )
        }
        sx={{
          justifyContent: 'space-between',
          border: 'none',
          bgcolor: 'transparent',
          minHeight: density.tapTarget,
          px: `${density.cardPadding}px`,
        }}
      >
        <Box
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: `${density.gap}px` }}
        >
          <FileText size={16} aria-hidden="true" />
          {toggleLabel}
        </Box>
      </Button>
      <Collapse in={open && text !== null}>
        {text !== null && (
          <Typography
            sx={{
              mx: `${density.cardPadding}px`,
              p: `${density.cardPadding}px`,
              maxHeight: 240,
              overflowY: 'auto',
              bgcolor: 'action.hover',
              borderRadius: `${rounded.control}px`,
              color: 'text.secondary',
              fontSize: '0.9375rem',
            }}
          >
            {text}
          </Typography>
        )}
      </Collapse>
      <Box sx={{ px: `${density.cardPadding}px`, py: `${density.gap / 2}px` }}>{checkbox}</Box>
    </Box>
  );
}
