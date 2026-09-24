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
import {
  classificationAnnouncement,
  isClassified,
  optionsWithStored,
  submitBlockedReasons,
} from '@/lib/classification';
import { canAddPage, canSubmitPages, movedOrder, type MoveDirection } from '@/lib/page-order';
import {
  parentApi,
  type SourceTestView,
  type StudentProfileView,
  type TaxonomyItem,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density } from '@/theme/tokens';
import { controlSx, ORDER_HEADING_ID, PageStrip } from './PageStrip';

/**
 * The classification section's heading, which names the section rather than the
 * section repeating those words as an `aria-label` — the same arrangement the
 * page strip uses with `ORDER_HEADING_ID`.
 */
const CLASSIFICATION_HEADING_ID = 'capture-classification-heading';

/**
 * Which write is in flight, so the screen can say what it is doing rather than
 * only that it is doing something. `null` is "nothing in flight"; every other
 * value locks the whole strip, because two writes against one ordinal sequence
 * could land out of order.
 */
type Pending = 'add' | 'retake' | 'move' | 'delete' | 'submit' | 'classify' | null;

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
  /** The taxonomy the two selects are fed from. Both are the server's answer. */
  const [gradeLevels, setGradeLevels] = useState<TaxonomyItem[]>([]);
  const [gradeLevelsLoading, setGradeLevelsLoading] = useState(false);
  const [subjects, setSubjects] = useState<TaxonomyItem[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
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
  /**
   * The Subject list is re-read every time the Grade Level moves, so it has a
   * counter of its own: a slow read for the grade the parent has just moved off
   * must not land after the fast one for the grade they moved to.
   */
  const subjectsRequestId = useRef(0);
  const subjectsCurrent = useRef({ value: 0 });
  subjectsCurrent.current.value = subjectsRequestId.current;
  /**
   * Retry can re-issue `loadGradeLevels` while an earlier call is still in
   * flight, so it gets the same guard the other streams have: a slow first
   * attempt must not overwrite what a faster retry already rendered.
   */
  const gradeLevelsRequestId = useRef(0);
  const gradeLevelsCurrent = useRef({ value: 0 });
  gradeLevelsCurrent.current.value = gradeLevelsRequestId.current;

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

  /**
   * The Grade Levels a parent may choose — the same parent-facing taxonomy read
   * the Students screen makes, and the enabled ones only.
   *
   * A failure is surfaced as the screen's error, exactly as the Subject read's
   * is: left silent it would render the empty state instead, and "no grade
   * levels exist, ask an administrator" is a false statement about a network
   * fault as well as advice that sends the parent somewhere useless.
   */
  const loadGradeLevels = useCallback(() => {
    if (token === null) return;
    const issued = (gradeLevelsRequestId.current += 1);
    gradeLevelsCurrent.current.value = issued;
    setGradeLevelsLoading(true);
    parentApi.gradeLevels(token).then(
      applyIfCurrent(gradeLevelsCurrent.current, issued, (items: TaxonomyItem[]) => {
        setGradeLevels(items);
        setGradeLevelsLoading(false);
      }),
      applyIfCurrent(gradeLevelsCurrent.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setGradeLevels([]);
        setGradeLevelsLoading(false);
        setError(
          cause instanceof Error
            ? cause.message
            : parentCopy.capture.classification.gradeLevelsFailed,
        );
      }),
    );
  }, [token, leave]);

  /**
   * The Subjects offered for the Grade Level the draft currently holds.
   *
   * Re-read on every Grade Level change rather than filtered from a cached
   * list: availability is the server's three-flag conjunction, and a copy of it
   * here would be a second place the rule could drift.
   */
  const loadSubjects = useCallback(
    (gradeLevelId: string | null) => {
      const issued = (subjectsRequestId.current += 1);
      subjectsCurrent.current.value = issued;
      if (token === null || gradeLevelId === null) {
        setSubjects([]);
        setSubjectsLoading(false);
        return;
      }
      setSubjectsLoading(true);
      parentApi.sourceTestSubjects(token, gradeLevelId).then(
        applyIfCurrent(subjectsCurrent.current, issued, (items: TaxonomyItem[]) => {
          setSubjects(items);
          setSubjectsLoading(false);
        }),
        applyIfCurrent(subjectsCurrent.current, issued, (cause: unknown) => {
          if (endsParentView(cause)) {
            leave();
            return;
          }
          setSubjects([]);
          setSubjectsLoading(false);
          setError(cause instanceof Error ? cause.message : parentCopy.capture.failed);
        }),
      );
    },
    [token, leave],
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    openDraft();
  }, [openDraft]);

  useEffect(() => {
    loadGradeLevels();
  }, [loadGradeLevels]);

  const draftGradeLevelId = sourceTest?.gradeLevelId ?? null;
  useEffect(() => {
    loadSubjects(draftGradeLevelId);
  }, [loadSubjects, draftGradeLevelId]);

  /**
   * What the error Alert's Retry does: every read, not only the first — the
   * Subject read included, because it is one of the reads that can be the
   * reason the Alert is on screen at all, and clearing an error without
   * re-issuing the request that caused it is a Retry that retries nothing.
   */
  const retry = useCallback(() => {
    loadProfiles();
    openDraft();
    loadGradeLevels();
    loadSubjects(draftGradeLevelId);
  }, [loadProfiles, openDraft, loadGradeLevels, loadSubjects, draftGradeLevelId]);

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
  /**
   * Both server gates, mirrored: the pages that landed, and the classification.
   * The button being disabled is a courtesy; the server refuses either way.
   */
  const classification = {
    subjectId: sourceTest?.subjectId ?? null,
    gradeLevelId: sourceTest?.gradeLevelId ?? null,
  };
  const blockedReasons = submitBlockedReasons(classification, readyPageCount);
  const submittable = isDraft && canSubmitPages(readyPageCount) && isClassified(classification);
  const addable = isDraft && canAddPage(pages.length, maxPages);

  /**
   * What each select renders: everything offered, plus whatever the draft
   * already holds. Only the offered lists decide what may be *chosen* — the
   * stored row is there so the control can say what the upload is.
   */
  const gradeLevelOptions = optionsWithStored(
    gradeLevels,
    classification.gradeLevelId,
    sourceTest?.gradeLevelName ?? null,
  );
  const subjectOptions = optionsWithStored(
    subjects,
    classification.subjectId,
    sourceTest?.subjectName ?? null,
  );

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

  /**
   * One classification write, on the same `write()` path every other mutation
   * takes — so the strip is locked while it is in flight and the answer is
   * announced from the view the server returned, never from what was asked for.
   *
   * The Grade Level case is why that matters: the server may answer with the
   * Subject cleared, and the announcement has to say so.
   */
  function classify(patch: { subjectId?: string; gradeLevelId?: string }): void {
    if (!isDraft) return;
    void write(
      'classify',
      () => parentApi.classifySourceTest(token!, sourceTest!.id, patch),
      (after) => {
        const announcement = classificationAnnouncement(classification, patch, after);
        switch (announcement.kind) {
          case 'subjectSet':
            return parentCopy.capture.classification.subjectSet(announcement.subjectName);
          case 'gradeLevelSet':
            return parentCopy.capture.classification.gradeLevelSet(announcement.gradeLevelName);
          case 'gradeLevelSetSubjectCleared':
            return parentCopy.capture.classification.gradeLevelSetSubjectCleared(
              announcement.gradeLevelName,
            );
        }
      },
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

            {ready && isDraft && (
              <Box
                component="section"
                aria-labelledby={CLASSIFICATION_HEADING_ID}
                sx={{ display: 'grid', gap: `${density.gap}px` }}
              >
                <Typography
                  id={CLASSIFICATION_HEADING_ID}
                  component="h2"
                  sx={{ fontSize: 18, fontWeight: 700 }}
                >
                  {parentCopy.capture.classification.heading}
                </Typography>
                {/* Says plainly what changing the grade level here does *not*
                    touch, because the default came from the child's profile. */}
                <Typography component="p">{parentCopy.capture.classification.intro}</Typography>

                {gradeLevelsLoading ? (
                  <Typography component="p" data-testid="grade-levels-loading">
                    {parentCopy.capture.classification.loadingGradeLevels}
                  </Typography>
                ) : gradeLevelOptions.length === 0 ? (
                  <Typography component="p" data-testid="no-grade-levels">
                    {parentCopy.capture.classification.noGradeLevels}
                  </Typography>
                ) : (
                  <TextField
                    id="capture-grade-level"
                    select
                    size="small"
                    disabled={busy}
                    label={parentCopy.capture.classification.gradeLevelLabel}
                    value={
                      gradeLevelOptions.some((item) => item.id === sourceTest.gradeLevelId)
                        ? sourceTest.gradeLevelId!
                        : ''
                    }
                    onChange={(event) => classify({ gradeLevelId: event.target.value })}
                  >
                    {gradeLevelOptions.map((gradeLevel) => (
                      <MenuItem
                        key={gradeLevel.id}
                        value={gradeLevel.id}
                        disabled={!gradeLevel.enabled}
                      >
                        {gradeLevel.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}

                {/* The Subject list is a function of the Grade Level, so each
                    state of that function says which one it is in. */}
                {sourceTest.gradeLevelId === null ? (
                  <Typography component="p" data-testid="choose-grade-level-first">
                    {parentCopy.capture.classification.chooseGradeLevelFirst}
                  </Typography>
                ) : subjectsLoading ? (
                  <Typography component="p" data-testid="subjects-loading">
                    {parentCopy.capture.classification.loadingSubjects}
                  </Typography>
                ) : subjectOptions.length === 0 ? (
                  <Typography component="p" data-testid="no-subjects">
                    {parentCopy.capture.classification.noSubjects}
                  </Typography>
                ) : (
                  <TextField
                    id="capture-subject"
                    select
                    size="small"
                    disabled={busy}
                    label={parentCopy.capture.classification.subjectLabel}
                    value={
                      subjectOptions.some((item) => item.id === sourceTest.subjectId)
                        ? sourceTest.subjectId!
                        : ''
                    }
                    onChange={(event) => classify({ subjectId: event.target.value })}
                  >
                    {subjectOptions.map((subject) => (
                      <MenuItem key={subject.id} value={subject.id} disabled={!subject.enabled}>
                        {subject.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}

                {pending === 'classify' && (
                  <Typography component="span" data-testid="classifying">
                    {parentCopy.capture.classification.saving}
                  </Typography>
                )}
              </Box>
            )}

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
                        {parentCopy.capture.submitBlocked(blockedReasons)}
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
