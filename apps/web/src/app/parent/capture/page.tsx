'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { PrimaryButton } from '@/components/Button';
import { useAnnounce } from '@/components/LiveRegion';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { canAddPage, canSubmitPages, movedOrder, type MoveDirection } from '@/lib/page-order';
import { parentApi, type SourceTestView, type StudentProfileView } from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density } from '@/theme/tokens';
import { controlSx, ORDER_HEADING_ID, PageStrip } from './PageStrip';

/**
 * Which write is in flight, so the screen can say what it is doing rather than
 * only that it is doing something. `null` is "nothing in flight"; every other
 * value locks the whole strip, because two writes against one ordinal sequence
 * could land out of order.
 */
type Pending = 'add' | 'retake' | 'move' | 'delete' | 'submit' | null;

/**
 * The page-management strip: the order a Source Test's pages are in, and the
 * four things a parent may do to it before submitting.
 *
 * The camera viewfinder, the continuous-capture loop and the photo-library
 * multi-select are Story 3.1's. The page-add affordance here is a plain file
 * input, and it exists so that everything below it is exercisable.
 */
export default function CapturePage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [studentProfileId, setStudentProfileId] = useState('');
  const [sourceTest, setSourceTest] = useState<SourceTestView | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The draft's own round trip, separate from the profile list's.
   *
   * Without it the strip renders its empty-state copy — and the count line
   * degrades to "0 of 0" with the submit-blocked sentence under it — for as
   * long as the open-or-resume call takes, so a parent returning to a six-page
   * draft is told it is empty before being told it is not.
   */
  const [draftLoading, setDraftLoading] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  // The surface's one polite region, mounted once in `ThemeRegistry`. A second
  // `role="status"` on the screen would make "the region here" ambiguous, for a
  // screen reader as much as for a test.
  const { announce } = useAnnounce();

  const token = elevation?.token ?? null;
  /**
   * Two independent request streams, each with its own counter.
   *
   * `retry` issues both `loadProfiles` and `openDraft` back to back in the same
   * tick. A single shared counter would have the second issue invalidate the
   * first before its response arrives, permanently dropping it — so each
   * stream gets its own counter and its own live-state ref.
   */
  const profilesRequestId = useRef(0);
  const profilesCurrent = useRef({ value: 0 });
  profilesCurrent.current.value = profilesRequestId.current;
  const draftRequestId = useRef(0);
  const draftCurrent = useRef({ value: 0 });
  draftCurrent.current.value = draftRequestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  /** The profiles this parent may upload for. */
  const loadProfiles = useCallback(() => {
    const issued = (profilesRequestId.current += 1);
    profilesCurrent.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    parentApi.selectableStudents(token).then(
      applyIfCurrent(profilesCurrent.current, issued, (students: StudentProfileView[]) => {
        setProfiles(students);
        setStudentProfileId((chosen) =>
          students.some((student) => student.id === chosen) ? chosen : (students[0]?.id ?? ''),
        );
        setLoading(false);
      }),
      applyIfCurrent(profilesCurrent.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
      }),
    );
  }, [token, router, leave]);

  /**
   * Opens — or resumes — the chosen child's draft.
   *
   * A `useCallback` rather than an inline effect body so that Retry can re-issue
   * exactly this: an error here is most often the draft round trip failing, and
   * a Retry that only re-read the profile list would leave the parent pressing a
   * button that never retries what broke.
   */
  const openDraft = useCallback(() => {
    if (token === null || studentProfileId === '') return;
    const issued = (draftRequestId.current += 1);
    draftCurrent.current.value = issued;
    setSourceTest(null);
    setDraftLoading(true);
    setError(null);
    parentApi.openSourceTest(token, studentProfileId).then(
      applyIfCurrent(draftCurrent.current, issued, (opened: SourceTestView) => {
        setSourceTest(opened);
        setDraftLoading(false);
      }),
      applyIfCurrent(draftCurrent.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setDraftLoading(false);
        setError(cause instanceof Error ? cause.message : parentCopy.capture.failed);
      }),
    );
  }, [token, studentProfileId, leave]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    openDraft();
  }, [openDraft]);

  /** What the error Alert's Retry does: both reads, not only the first. */
  const retry = useCallback(() => {
    loadProfiles();
    openDraft();
  }, [loadProfiles, openDraft]);

  /**
   * One write, with the strip locked, the announcement made and errors shown.
   *
   * Every mutation answers with the Source Test as it now stands, and every
   * announcement is phrased from that answer — never from what the client
   * predicted the result would be.
   */
  async function write(
    kind: Exclude<Pending, null>,
    run: () => Promise<SourceTestView>,
    said: (after: SourceTestView) => string,
  ): Promise<void> {
    if (token === null || pending !== null) return;
    setPending(kind);
    setError(null);
    try {
      const after = await run();
      setSourceTest(after);
      announce(said(after));
    } catch (cause) {
      if (endsParentView(cause)) {
        leave();
        return;
      }
      setError(cause instanceof Error ? cause.message : parentCopy.capture.failed);
    } finally {
      setPending(null);
    }
  }

  const pages = sourceTest?.pages ?? [];
  const maxPages = sourceTest?.maxPages ?? 0;
  // Page management acts on a draft and on nothing else. A submitted Source Test
  // is terminal here: every write against it answers 409, so offering the
  // controls would only be a way of collecting that refusal.
  const isDraft = sourceTest !== null && sourceTest.status === 'Draft';
  const busy = pending !== null;
  const ready = sourceTest !== null && !draftLoading;
  // The server's submit gate counts `Ready` rows only — a page stranded in
  // `Uploading` (a crash between insert and byte write) holds no bytes yet.
  // Mirroring the full count here would show an enabled submit control the
  // server then refuses.
  const readyPageCount = pages.filter((page) => page.state === 'Ready').length;
  const submittable = isDraft && canSubmitPages(readyPageCount);
  const addable = isDraft && canAddPage(pages.length, maxPages);

  function move(pageId: string, ordinal: number, direction: MoveDirection): void {
    if (!isDraft) return;
    const ids = pages.map((page) => page.id);
    const next = movedOrder(ids, pageId, direction);
    // The rule says a move at either end changes nothing, so no request goes.
    if (next.join() === ids.join()) return;
    void write(
      'move',
      () => parentApi.reorderSourceTestPages(token!, sourceTest!.id, next),
      // Where the page actually landed, read off the server's answer: the
      // client's own prediction would still read as a success if the server
      // had applied something else.
      (after) =>
        parentCopy.capture.moved(ordinal, after.pages.findIndex((page) => page.id === pageId) + 1),
    );
  }

  function addPage(file: File): void {
    if (!isDraft) return;
    void write(
      'add',
      () => parentApi.addSourceTestPage(token!, sourceTest!.id, file),
      (after) => parentCopy.capture.added(after.pages.length),
    );
  }

  function retakePage(pageId: string, file: File): void {
    if (!isDraft) return;
    void write(
      'retake',
      () => parentApi.retakeSourceTestPage(token!, sourceTest!.id, pageId, file),
      (after) =>
        parentCopy.capture.retaken(after.pages.find((page) => page.id === pageId)?.ordinal ?? 0),
    );
  }

  function deletePage(pageId: string, ordinal: number): void {
    if (!isDraft) return;
    const total = pages.length;
    if (!window.confirm(parentCopy.capture.deleteConfirm(ordinal, total))) return;
    void write(
      'delete',
      async () => {
        // The route answers 204 and stores nothing to return; the strip is
        // re-read so what is on screen is the server's account of it.
        await parentApi.deleteSourceTestPage(token!, sourceTest!.id, pageId);
        return parentApi.sourceTest(token!, sourceTest!.id);
      },
      () => parentCopy.capture.deleted(ordinal, total),
    );
  }

  function submit(): void {
    if (!submittable) return;
    void write(
      'submit',
      () => parentApi.submitSourceTest(token!, sourceTest!.id),
      () => parentCopy.capture.submitted,
    );
  }

  return (
    <Card component="section" sx={{ maxWidth: 840, mx: 'auto' }}>
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {parentCopy.capture.title}
        </Typography>

        {error !== null && (
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            action={<Button onClick={retry}>{parentCopy.errors.retry}</Button>}
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <Alert severity="info" role="status" variant="outlined">
            {parentCopy.capture.loading}
          </Alert>
        ) : profiles.length === 0 ? (
          <Typography component="p">{parentCopy.capture.noProfiles}</Typography>
        ) : (
          <>
            <TextField
              id="capture-student"
              select
              size="small"
              disabled={busy}
              label={parentCopy.capture.childLabel}
              value={studentProfileId}
              onChange={(event) => setStudentProfileId(event.target.value)}
            >
              {profiles.map((profile) => (
                <MenuItem key={profile.id} value={profile.id}>
                  {profile.displayName}
                </MenuItem>
              ))}
            </TextField>

            <Typography id={ORDER_HEADING_ID} component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
              {parentCopy.capture.orderLabel}
            </Typography>

            {!ready ? (
              <Alert severity="info" role="status" variant="outlined">
                {parentCopy.capture.loading}
              </Alert>
            ) : (
              <>
                <Typography component="p" data-testid="page-count">
                  {parentCopy.capture.countLine(pages.length, maxPages)}
                </Typography>

                {/* A submitted Source Test is shown, not hidden — the parent's
                    work did not vanish — but nothing on it is editable. */}
                {!isDraft && (
                  <Typography component="p" data-testid="submitted-note">
                    {parentCopy.capture.submittedNote}
                  </Typography>
                )}

                {pages.length === 0 ? (
                  <Typography component="p" sx={{ color: 'text.secondary' }}>
                    {parentCopy.capture.empty}
                  </Typography>
                ) : (
                  <PageStrip
                    pages={pages}
                    editable={isDraft}
                    busy={busy}
                    onMove={move}
                    onRetake={retakePage}
                    onDelete={deletePage}
                  />
                )}

                {isDraft && (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
                      <Typography component="label" htmlFor="capture-add-page">
                        {parentCopy.capture.addPage}
                      </Typography>
                      <Box
                        component="input"
                        id="capture-add-page"
                        type="file"
                        accept="image/*"
                        disabled={busy || !addable}
                        aria-label={parentCopy.capture.addPage}
                        sx={controlSx}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) addPage(file);
                        }}
                      />
                      {/* Ingest re-encodes before the row leaves `Uploading`,
                          which is long enough that silence reads as a dead
                          control. */}
                      {pending === 'add' && (
                        <Typography component="span" data-testid="adding">
                          {parentCopy.capture.adding}
                        </Typography>
                      )}
                    </Box>
                    {!addable && (
                      <Typography component="p">
                        {parentCopy.capture.limitReached(maxPages)}
                      </Typography>
                    )}

                    <PrimaryButton
                      disabled={busy || !submittable}
                      sx={{ minHeight: density.tapTarget }}
                      onClick={submit}
                    >
                      {pending === 'submit'
                        ? parentCopy.capture.submitting
                        : parentCopy.capture.submit}
                    </PrimaryButton>
                    {/* The reason, on screen, whenever the control is refused
                        for it. The disabled button alone states nothing a
                        parent can act on. */}
                    {!submittable && (
                      <Typography component="p" data-testid="submit-blocked">
                        {parentCopy.capture.submitBlocked}
                      </Typography>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Client-side, so the provider holding the token stays mounted. */}
        <Link component={NextLink} href="/parent">
          {parentCopy.capture.back}
        </Link>
      </CardContent>
    </Card>
  );
}
