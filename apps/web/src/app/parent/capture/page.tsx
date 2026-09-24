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
import { EXTRACTION_POLL_MS, isSettled, warningNeeded } from '@/lib/extraction-status';
import { canAddPage, canSubmitPages, movedOrder, type MoveDirection } from '@/lib/page-order';
import {
  parentApi,
  type ExtractionStatusView,
  type SourceTestView,
  type StudentProfileView,
  type TaxonomyItem,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density } from '@/theme/tokens';
import { controlSx, ORDER_HEADING_ID, PageStrip } from './PageStrip';
import { ThinExtractionWarning } from './ThinExtractionWarning';

/**
 * The classification section's heading, which names the section rather than the
 * section repeating those words as an `aria-label` — the same arrangement the
 * page strip uses with `ORDER_HEADING_ID`.
 */
const CLASSIFICATION_HEADING_ID = 'capture-classification-heading';

/** The generate step's own heading, named the same way the other two sections are. */
const GENERATE_HEADING_ID = 'capture-generate-heading';

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
  /**
   * The Extraction status poll, with the same guard the other four streams
   * carry — and it needs it most: it re-issues on a timer, so a slow read has
   * every chance of landing after a later one.
   */
  const extractionRequestId = useRef(0);
  const extractionCurrent = useRef({ value: 0 });
  extractionCurrent.current.value = extractionRequestId.current;

  /**
   * Where the committed upload's reading stands, and what the parent has done
   * about it. None of it is persisted: it is a screen state, not a row.
   */
  const [extraction, setExtraction] = useState<ExtractionStatusView | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);

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
   *
   * `onOpened` runs only on the draft the server actually answered with, so a
   * caller with something to say about the new upload — the retake, which
   * announces one — says it once the upload exists and says nothing when the
   * open failed.
   */
  const openDraft = useCallback(
    (onOpened?: (opened: SourceTestView) => void) => {
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
          onOpened?.(opened);
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
    },
    [token, studentProfileId, leave],
  );

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
   * The committed upload the generate step is about, or null while there is
   * none. A Draft has no Extraction job at all — the status read answers 404 —
   * so the step and its poll exist only past submit.
   */
  const submittedSourceTestId =
    sourceTest !== null && sourceTest.status === 'Submitted' ? sourceTest.id : null;
  /** Bumped by Retry, so a poll that stopped on an error can be re-issued. */
  const [extractionAttempt, setExtractionAttempt] = useState(0);

  /**
   * The Extraction status, read on entering the generate step and then polled
   * until the job settles.
   *
   * A poll rather than a held connection because the job deliberately outlives
   * the request that enqueued it. Everything the step held is cleared as the
   * state is entered, so a fresh upload never shows the previous one's outcome;
   * and the cleanup both cancels the pending timer and bumps the counter, which
   * is what makes a response already in flight inapplicable after unmount.
   */
  useEffect(() => {
    const issued = (extractionRequestId.current += 1);
    extractionCurrent.current.value = issued;
    setExtraction(null);
    setWarningOpen(false);
    if (token === null || submittedSourceTestId === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const read = (): void => {
      parentApi.extraction(token, submittedSourceTestId).then(
        applyIfCurrent(extractionCurrent.current, issued, (view: ExtractionStatusView) => {
          setExtraction(view);
          if (!stopped && !isSettled(view.status)) timer = setTimeout(read, EXTRACTION_POLL_MS);
        }),
        applyIfCurrent(extractionCurrent.current, issued, (cause: unknown) => {
          if (endsParentView(cause)) {
            leave();
            return;
          }
          // Stops rather than hammers: the screen's Retry re-issues it.
          setError(cause instanceof Error ? cause.message : parentCopy.capture.generate.readFailed);
        }),
      );
    };
    read();

    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      extractionRequestId.current += 1;
      extractionCurrent.current.value = extractionRequestId.current;
    };
  }, [token, submittedSourceTestId, extractionAttempt, leave]);

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
    // The Extraction poll stops on its own failure, so Retry has to re-issue
    // it too — clearing the error without re-reading would retry nothing.
    setExtractionAttempt((attempt) => attempt + 1);
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
  /**
   * The two figures the warning states, or null when the read has not produced
   * them. Narrowed rather than defaulted: a `?? 0` would let the warning say
   * "0 usable questions were found across 0 pages" about counts that simply are
   * not in yet, so the absence has to stop the dialog existing at all.
   */
  const warningCounts =
    extraction !== null && extraction.usableQuestionCount !== null && extraction.pageCount !== null
      ? { usable: extraction.usableQuestionCount, pages: extraction.pageCount }
      : null;
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

  /**
   * The gate, and the whole of it: the warning when the server called this
   * Extraction thin, and the generate step otherwise.
   *
   * `warningNeeded` decides, not `thin` read here — an unfinished job's `null`
   * must read as neither thin nor healthy, and that distinction belongs in the
   * pure rule where a test can state it.
   */
  function proceedToGenerate(): void {
    if (warningNeeded(extraction) && warningCounts !== null) {
      setWarningOpen(true);
      return;
    }
    reachGenerateStep();
  }

  /**
   * Dismissing the warning — Escape, or a tap on the scrim — is a cancel, as it
   * is everywhere else in this app. It closes the warning and leaves the parent
   * on the proceed control; it is not a quiet way of continuing.
   */
  function dismissWarning(): void {
    setWarningOpen(false);
  }

  /**
   * Past the gate, and off this screen.
   *
   * A navigation rather than a section revealed in place, and that is the whole
   * of it: generation is asynchronous and a parent may leave and come back, so
   * the state they come back to has to be addressable by a URL and read from
   * the server. A section here could only ever restore what this browser
   * happened to still be holding.
   */
  function reachGenerateStep(): void {
    setWarningOpen(false);
    announce(parentCopy.capture.generate.leaving);
    router.push(`/parent/generate/${sourceTest!.id}`);
  }

  /**
   * Retake: a fresh upload for the same child, because a Submitted Source Test
   * is terminal (AD-16) and the old pages cannot come back. `openDraft` is the
   * open-or-resume call the screen already makes, so a failure surfaces as the
   * screen's own error with Retry.
   *
   * The announcement waits for the draft the server answered with: said up
   * front, it would tell a parent a new upload had started while the screen
   * beside it showed the open having failed.
   */
  function retakePages(): void {
    setWarningOpen(false);
    openDraft(() => announce(parentCopy.capture.generate.retakeStarted));
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

                {/* The generate step, and the gate on the way into it. It
                    exists only past submit: a Draft has no Extraction job, and
                    the status read answers 404 for one. */}
                {!isDraft && (
                  <Box
                    component="section"
                    aria-labelledby={GENERATE_HEADING_ID}
                    sx={{ display: 'grid', gap: `${density.gap}px` }}
                  >
                    <Typography
                      id={GENERATE_HEADING_ID}
                      component="h2"
                      sx={{ fontSize: 18, fontWeight: 700 }}
                    >
                      {parentCopy.capture.generate.heading}
                    </Typography>

                    {extraction === null || !isSettled(extraction.status) ? (
                      <Typography component="p" data-testid="extraction-reading">
                        {parentCopy.capture.generate.reading}
                      </Typography>
                    ) : extraction.status === 'Failed' ? (
                      // The job's own stored reason, which is a written
                      // constant and never a provider string — announced as a
                      // failure the way every other failure on this screen is,
                      // so a screen reader is told rather than left to find it.
                      <Alert
                        severity="error"
                        role="alert"
                        variant="outlined"
                        data-testid="extraction-failed"
                      >
                        {extraction.failureReason ?? parentCopy.capture.generate.readFailed}
                      </Alert>
                    ) : (
                      <>
                        {/* Never disabled by the verdict: the warning informs,
                            it does not block. */}
                        <PrimaryButton
                          sx={{ minHeight: density.tapTarget }}
                          onClick={proceedToGenerate}
                          data-testid="extraction-proceed"
                        >
                          {parentCopy.capture.generate.proceed}
                        </PrimaryButton>
                      </>
                    )}

                    {/* Mounted only once both figures are in: the warning
                        states counts it was handed, and there is nothing to
                        hand it until the read produced them. */}
                    {warningCounts !== null && (
                      <ThinExtractionWarning
                        open={warningOpen}
                        usableQuestionCount={warningCounts.usable}
                        pageCount={warningCounts.pages}
                        busy={busy || draftLoading}
                        onContinue={reachGenerateStep}
                        onRetake={retakePages}
                        onDismiss={dismissWarning}
                      />
                    )}
                  </Box>
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
