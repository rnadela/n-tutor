'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import type { Route } from 'next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Link from '@mui/material/Link';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { PrimaryButton, DestructiveButton } from '@/components/Button';
import { AppDialog } from '@/components/Dialog';
import { RichText } from '@/components/RichText';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  ParentApiError,
  type DraftQuestionView,
  type PracticeTestDraftView,
  type StudentProfileView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { canSaveField, plainTextOf } from '@/lib/rich-text';
import { density } from '@/theme/tokens';

/**
 * How long a parent stops typing before the uncommitted edit is written to its
 * slot.
 *
 * Long enough that a sentence is one write rather than forty; short enough that
 * a parent who is interrupted mid-word loses at most the last moment of it.
 */
const SLOT_DEBOUNCE_MS = 800;

/**
 * Pending drafts, told that a practice test was just discarded.
 *
 * The flag travels in the URL because the screen that knows is the one being
 * navigated away from: a live region unmounted mid-announcement says nothing,
 * so the sentence is stated by the screen the parent actually lands on.
 */
const DISCARDED_DRAFTS_HREF = '/parent/drafts?discarded=1' as Route;

/**
 * Pending drafts, told that a practice test was just released.
 *
 * The same mechanism and the same reason: both transitions leave this screen on a
 * URL whose read now 404s, so rather than render the missing state — which reads
 * as a fault — the outcome travels in the URL and is stated by the screen the
 * parent actually lands on.
 */
const RELEASED_DRAFTS_HREF = '/parent/drafts?released=1' as Route;

/** One Question's editor, as the parent has it on screen right now. */
interface QuestionEdit {
  prompt: string;
  /** Empty and unused for a Multiple Choice question, where options carry it. */
  answer: string;
  choices: { ordinal: number; body: string }[];
  /** Which option the parent has marked correct, by its stored ordinal. */
  correctOrdinal: number | null;
  /** Whether anything has been typed since this editor was opened or restored. */
  dirty: boolean;
  /** Whether it came back from the `DraftEdit` slot rather than from the row. */
  restored: boolean;
}

/** The editor as the stored Question opens it: what is there, ready to type over. */
function editorFor(question: DraftQuestionView): QuestionEdit {
  return {
    // Plain text in the field, segments in the column. The browser renders one
    // direction only; turning text back into segments is the server's single
    // answer (AD-32).
    prompt: plainTextOf(question.prompt),
    answer: question.answer === null ? '' : plainTextOf(question.answer),
    choices: question.choices.map((choice) => ({
      ordinal: choice.ordinal,
      body: plainTextOf(choice.body),
    })),
    correctOrdinal: question.choices.find((choice) => choice.isCorrect)?.ordinal ?? null,
    dirty: false,
    restored: false,
  };
}

/** What an editor sends, with only the fields the Question actually has. */
function editPayload(question: DraftQuestionView, edit: QuestionEdit) {
  if (question.format === 'MultipleChoice') {
    return {
      prompt: edit.prompt,
      choices: edit.choices,
      // Sent every time: an edit of the options states which one is right
      // rather than inheriting a flag that may no longer belong to the body it
      // was set on. The server refuses an edit that names none.
      correctOrdinal: edit.correctOrdinal ?? undefined,
    };
  }
  return { prompt: edit.prompt, answer: edit.answer };
}

/** Whether the save control may fire — the client mirror of the server's rules. */
function canSave(question: DraftQuestionView, edit: QuestionEdit): boolean {
  if (!canSaveField(edit.prompt)) return false;
  if (question.format === 'MultipleChoice') {
    return (
      edit.correctOrdinal !== null && edit.choices.every((choice) => canSaveField(choice.body))
    );
  }
  return canSaveField(edit.answer);
}

/**
 * Draft review, and the write half of it.
 *
 * **The URL is the review position.** The screen is addressed by Practice Test
 * id and stores no position, so a reload, a return days later and a Parent View
 * idle expiry followed by a re-entry all resume on the same draft.
 *
 * Every Question the draft holds is rendered in one list, in stored order, each
 * with its correct answer, its options where it has them, and its Topics.
 * Nothing is paginated, collapsed or truncated: "every Question" is the
 * acceptance criterion the epic's human quality gate rests on.
 *
 * Since Story 4.4 the gate can be acted on: a Question is edited or deleted
 * **in place**, with no navigation, and every mutation re-renders from the view
 * the server answers with rather than from what this browser hoped it wrote.
 * Deleting the last Question discards the Practice Test, which the confirmation
 * says in words — along with the fact that the Generation Allowance already
 * spent on it is not given back (AD-14).
 *
 * A typed-but-unsaved edit is held in the `DraftEdit` uncommitted-state slot
 * Story 1.6 built for it, keyed to the draft's own Student Profile and scoped
 * by Question id. Nothing goes to any browser storage API: a device that has
 * fallen back to Student Mode must hold no trace of the work.
 *
 * Since Story 4.5 the gate can be **closed in either direction**: the draft as a
 * whole is released — visible to that child straight away, and unchangeable
 * thereafter — or discarded, which the child never sees. Each sits behind a
 * confirmation that states its consequence in words *before* it fires, because
 * there is no undo, no recall and no refund for either. On success the parent
 * lands on Pending drafts with the outcome in the URL, since the URL they are
 * standing on now 404s by construction.
 *
 * The child's display name on the confirmation is joined in the browser from the
 * Student Profile read, exactly as Pending drafts does it: `practicetest` reads no
 * identity table (AD-17). A name not in hand falls back to a neutral stand-in and
 * never blocks the release control.
 *
 * The timer is Story 4.6. There is no control here for it.
 */
export default function DraftReviewPage() {
  const router = useRouter();
  const params = useParams<{ practiceTestId: string }>();
  const practiceTestId = params.practiceTestId;
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [draft, setDraft] = useState<PracticeTestDraftView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * A draft that is not there, held apart from every other failure.
   *
   * A 404 is a state this screen renders — the draft was discarded, released,
   * or never belonged to this account — and it offers the way back to Pending
   * drafts rather than a Retry that would ask for the same nothing again.
   */
  const [missing, setMissing] = useState(false);
  /** Bumped by Retry, so a load that stopped on an error re-issues. */
  const [attempt, setAttempt] = useState(0);

  /** The open editors, by Question id. Several may be open at once. */
  const [edits, setEdits] = useState<Record<string, QuestionEdit>>({});
  /** The `DraftEdit` slot holding each Question's uncommitted text, by its id. */
  const [slots, setSlots] = useState<Record<string, string>>({});
  /** The Question a mutation is in flight for, so its controls cannot double-fire. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The Question a delete has been asked for and not yet confirmed. */
  const [pendingDelete, setPendingDelete] = useState<DraftQuestionView | null>(null);
  /** What just happened, in the same words the screen shows. */
  const [notice, setNotice] = useState<string | null>(null);
  /** A failed edit, delete or transition, held apart from the read's own failure. */
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * Which terminal transition has been asked for and not yet confirmed.
   *
   * One piece of state for both, so the two dialogs cannot be open at once and
   * the confirm control always knows which consequence was the one stated.
   */
  const [pendingTransition, setPendingTransition] = useState<'release' | 'discard' | null>(null);
  /**
   * The account's student profiles, for the child's name on the confirmation.
   *
   * Joined here because `practicetest` does not read an identity table (AD-17),
   * and read independently of the draft: a name that could not be looked up is a
   * name this screen does without, and it must never be what stops a parent
   * releasing something they have finished reading.
   */
  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);

  /**
   * `slots` as it is right now, for a callback that must not read a stale map.
   *
   * Mirrored in an effect rather than assigned in the render body: a render
   * that React discards under StrictMode or a concurrent re-render would
   * otherwise leave the ref holding a map that was never committed.
   */
  const liveSlots = useRef<Record<string, string>>({});
  useEffect(() => {
    liveSlots.current = slots;
  }, [slots]);

  /** The draft whose slots have already been restored, so it happens once. */
  const restoredFor = useRef<string | null>(null);

  /** Where focus is owed after the next render, and to what. */
  const [focusTarget, setFocusTarget] = useState<
    { kind: 'prompt' | 'edit'; questionId: string } | { kind: 'total' } | null
  >(null);
  const promptFields = useRef<Record<string, HTMLElement | null>>({});
  const editControls = useRef<Record<string, HTMLElement | null>>({});
  const totalLine = useRef<HTMLElement | null>(null);

  /** The pending re-announce, cleared on unmount so it cannot fire into nothing. */
  const announcement = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestId = useRef(0);
  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  /**
   * Says something in the live region, and says it again when it is the same
   * sentence twice.
   *
   * A live region only announces what *changes* inside it, so setting the same
   * text again is silent — which would mean saving the same Question twice
   * announces once. Emptying it first, on its own tick, is what makes the
   * second save audible. The region itself stays mounted throughout: a region
   * that arrives already holding text is not reliably read.
   */
  const announce = useCallback((text: string) => {
    if (announcement.current !== null) clearTimeout(announcement.current);
    setNotice(null);
    announcement.current = setTimeout(() => setNotice(text), 0);
  }, []);

  useEffect(
    () => () => {
      if (announcement.current !== null) clearTimeout(announcement.current);
    },
    [],
  );

  /**
   * Moves focus where the last action left it owed.
   *
   * Every one of the three transitions moves something out from under the
   * keyboard: opening an editor replaces the row, saving removes the fields,
   * and deleting removes the card the focused control was on — which drops
   * focus to `<body>` and loses a keyboard parent's place entirely.
   */
  useEffect(() => {
    if (focusTarget === null) return;
    const node =
      focusTarget.kind === 'prompt'
        ? promptFields.current[focusTarget.questionId]
        : focusTarget.kind === 'edit'
          ? editControls.current[focusTarget.questionId]
          : totalLine.current;
    node?.focus();
    setFocusTarget(null);
  }, [focusTarget, draft, edits]);

  /** Every failure either mutation can end in, answered the same way. */
  const failed = useCallback(
    (cause: unknown, fallback: string) => {
      if (endsParentView(cause)) {
        leave();
        return;
      }
      if (cause instanceof ParentApiError && cause.status === 404) {
        // The draft moved out from under this screen — released, discarded, or
        // gone. The same state a missing read renders, with the way back.
        setMissing(true);
        return;
      }
      setActionError(
        cause instanceof ParentApiError && cause.reason !== null
          ? cause.reason
          : cause instanceof Error
            ? cause.message
            : fallback,
      );
    },
    [leave],
  );

  useEffect(() => {
    const issued = (requestId.current += 1);
    current.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      // They come back to this same URL, which is the whole review position.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    setMissing(false);
    parentApi.practiceTestDraft(token, practiceTestId).then(
      applyIfCurrent(current.current, issued, (view: PracticeTestDraftView) => {
        setDraft(view);
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        if (cause instanceof ParentApiError && cause.status === 404) {
          setMissing(true);
          return;
        }
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : cause instanceof Error
              ? cause.message
              : parentCopy.drafts.openFailed,
        );
      }),
    );

    // Settled **independently** of the draft read, and deliberately not as one
    // `Promise.all`. The draft is the screen; the profile read only puts a name on
    // the confirmation. Failing them together would blank a draft that came back
    // perfectly well because a name could not be looked up — and would leave the
    // neutral stand-in below unreachable in practice. An expiry is the one failure
    // it still acts on, because that is not about the profiles.
    parentApi.students(token).then(
      applyIfCurrent(current.current, issued, setProfiles),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) leave();
      }),
    );
  }, [token, practiceTestId, attempt, leave, router]);

  /**
   * Puts back what was typed and not saved.
   *
   * Read **once per Practice Test id**, not once per draft object. Every save
   * and every delete replaces `draft` with a new identity, and restoring again
   * on each of them would race the fire-and-forget slot discard: a slow or
   * failed DELETE would come back as a "restored" edit and reopen an editor the
   * parent had already saved or cancelled, holding text they abandoned.
   *
   * Keyed to the draft's own Student Profile and matched to a Question by the
   * slot's scope. A slot whose Question is no longer in the draft is simply not
   * opened — the Question was deleted, and the edit has nothing left to apply
   * to.
   *
   * **A failure here never blocks the screen.** The stored text is what the
   * parent sees instead, which is the truth about the row; losing a draft edit
   * is a smaller harm than a review screen that will not render.
   */
  useEffect(() => {
    if (token === null || draft === null) return;
    if (restoredFor.current === practiceTestId) return;
    restoredFor.current = practiceTestId;
    let live = true;
    parentApi
      .uncommittedState(token, draft.studentProfileId)
      .then((held) => {
        if (!live) return;
        const byId = new Map(draft.questions.map((question) => [question.id, question]));
        const restored: Record<string, QuestionEdit> = {};
        const ids: Record<string, string> = {};
        for (const slot of held) {
          const question = byId.get(slot.scope);
          if (slot.kind !== 'DraftEdit' || question === undefined) continue;
          ids[question.id] = slot.id;
          const payload = slot.payload as Partial<QuestionEdit> | null;
          if (payload === null || typeof payload !== 'object') continue;
          const base = editorFor(question);
          restored[question.id] = {
            ...base,
            prompt: typeof payload.prompt === 'string' ? payload.prompt : base.prompt,
            answer: typeof payload.answer === 'string' ? payload.answer : base.answer,
            // Every field is checked, not only the top-level ones: a slot is
            // opaque JSON, and an option body that is not a string would land
            // in a controlled field as `undefined` and take the editor with it.
            choices: Array.isArray(payload.choices)
              ? base.choices.map((choice) => {
                  const typed = payload.choices?.find((one) => one.ordinal === choice.ordinal);
                  return typed === undefined || typeof typed.body !== 'string'
                    ? choice
                    : { ...choice, body: typed.body };
                })
              : base.choices,
            // And an ordinal the Question no longer has is not a correct
            // option: it would leave the radio group with nothing selected and
            // a save the server refuses for a reason the screen never showed.
            correctOrdinal:
              typeof payload.correctOrdinal === 'number' &&
              base.choices.some((choice) => choice.ordinal === payload.correctOrdinal)
                ? payload.correctOrdinal
                : base.correctOrdinal,
            restored: true,
          };
        }
        setSlots(ids);
        // Only where nothing is already open: a parent mid-sentence must not
        // have the field replaced under them by a late read.
        setEdits((open) => ({ ...restored, ...open }));
      })
      .catch(() => {
        /* The stored text stands. A slot read never blocks the screen. */
      });
    return () => {
      live = false;
    };
  }, [token, draft, practiceTestId]);

  /**
   * Writes what is typed into the `DraftEdit` slot, once the typing pauses.
   *
   * Debounced rather than per-keystroke, and never allowed to surface as an
   * error: this is a safety net under the parent's work, and a net that
   * interrupts them with a failure they cannot act on is worse than one that
   * quietly does not catch.
   */
  useEffect(() => {
    if (token === null || draft === null) return;
    const dirty = Object.entries(edits).filter(([, edit]) => edit.dirty);
    if (dirty.length === 0) return;
    const pause = setTimeout(() => {
      for (const [questionId, edit] of dirty) {
        const payload = {
          prompt: edit.prompt,
          answer: edit.answer,
          choices: edit.choices,
          correctOrdinal: edit.correctOrdinal,
        };
        parentApi
          .saveUncommittedState(token, {
            studentProfileId: draft.studentProfileId,
            kind: 'DraftEdit',
            scope: questionId,
            payload,
          })
          .then((slot) => {
            setSlots((held) => ({ ...held, [questionId]: slot.id }));
            // Only the typed text this write actually saved goes clean — a
            // keystroke that landed after the write started must still be
            // saved on its own next pause, not silently treated as covered.
            setEdits((open) => {
              const current = open[questionId];
              if (current === undefined || !current.dirty) return open;
              const stillSame =
                JSON.stringify({
                  prompt: current.prompt,
                  answer: current.answer,
                  choices: current.choices,
                  correctOrdinal: current.correctOrdinal,
                }) === JSON.stringify(payload);
              return stillSame ? { ...open, [questionId]: { ...current, dirty: false } } : open;
            });
          })
          .catch(() => {
            /* Nothing to tell the parent: the text is still on screen. */
          });
      }
    }, SLOT_DEBOUNCE_MS);
    return () => clearTimeout(pause);
  }, [edits, token, draft]);

  /**
   * Drops the slot behind one Question — the edit is committed or abandoned.
   *
   * Read through a ref rather than the state it mirrors: a save that started
   * before the debounced slot write finished would otherwise close over the
   * slot map as it was, and leave behind the very row it was meant to clear.
   */
  const discardSlot = useCallback(
    (questionId: string) => {
      const slotId = liveSlots.current[questionId];
      setSlots(({ [questionId]: _dropped, ...rest }) => rest);
      if (token === null || slotId === undefined) return;
      parentApi.discardUncommittedState(token, slotId).catch(() => {
        /* It expires on its own. A failed cleanup is not the parent's problem. */
      });
    },
    [token],
  );

  /**
   * Drops every slot this draft is holding — the draft itself is gone.
   *
   * Deleting the last Question discards the Practice Test, and the slots behind
   * its *other* Questions outlive it: left alone they sit out their TTL and
   * would come back as "restored" edits against a draft that no longer exists.
   */
  const discardEverySlot = useCallback(() => {
    const held = Object.values(liveSlots.current);
    setSlots({});
    if (token === null) return;
    for (const slotId of held) {
      parentApi.discardUncommittedState(token, slotId).catch(() => {
        /* They expire on their own. A failed cleanup is not the parent's problem. */
      });
    }
  }, [token]);

  const change = useCallback((questionId: string, patch: Partial<QuestionEdit>) => {
    setEdits((open) => {
      const edit = open[questionId];
      if (edit === undefined) return open;
      return { ...open, [questionId]: { ...edit, ...patch, dirty: true, restored: false } };
    });
  }, []);

  const closeEditor = useCallback((questionId: string) => {
    setEdits(({ [questionId]: _closed, ...rest }) => rest);
  }, []);

  const save = useCallback(
    (question: DraftQuestionView) => {
      const edit = edits[question.id];
      if (token === null || edit === undefined || !canSave(question, edit)) return;
      setBusy(question.id);
      setActionError(null);
      parentApi
        .editDraftQuestion(token, practiceTestId, question.id, editPayload(question, edit))
        .then((view) => {
          setBusy(null);
          // Re-rendered from the server's own account of what is stored, never
          // from what this browser sent.
          setDraft(view);
          closeEditor(question.id);
          discardSlot(question.id);
          announce(parentCopy.drafts.edited(question.ordinal));
          // The fields the parent was in have gone; focus goes back to the
          // control that opened them rather than to the top of the document.
          setFocusTarget({ kind: 'edit', questionId: question.id });
        })
        .catch((cause: unknown) => {
          setBusy(null);
          // A stale success sentence beside a fresh failure is a screen saying
          // two contradictory things at once.
          setNotice(null);
          failed(cause, parentCopy.drafts.editFailed);
        });
    },
    [edits, token, practiceTestId, closeEditor, discardSlot, failed, announce],
  );

  const confirmDelete = useCallback(() => {
    const question = pendingDelete;
    if (token === null || question === null) return;
    setBusy(question.id);
    setActionError(null);
    parentApi
      .deleteDraftQuestion(token, practiceTestId, question.id)
      .then((view) => {
        setBusy(null);
        setPendingDelete(null);
        closeEditor(question.id);
        if (view.status !== 'Draft') {
          // The last Question went, and the Practice Test went with it. There
          // is nothing left on this screen to render — and nothing left for any
          // of its other Questions' slots to apply to either.
          discardEverySlot();
          // Carried to Pending drafts rather than said here: this screen is
          // about to be replaced, and a sentence a parent never gets to read is
          // not a sentence. The list states the discard on arrival.
          router.replace(DISCARDED_DRAFTS_HREF);
          return;
        }
        discardSlot(question.id);
        setDraft(view);
        announce(parentCopy.drafts.deleted(view.questions.length));
        // The card the focused control was on has gone. Focus lands on the
        // line that states what is left, rather than dropping to the document.
        setFocusTarget({ kind: 'total' });
      })
      .catch((cause: unknown) => {
        setBusy(null);
        setPendingDelete(null);
        setNotice(null);
        failed(cause, parentCopy.drafts.deleteFailed);
      });
  }, [
    pendingDelete,
    token,
    practiceTestId,
    closeEditor,
    discardSlot,
    discardEverySlot,
    failed,
    router,
    announce,
  ]);

  /**
   * Releases or discards the whole draft, whichever the confirmation named.
   *
   * Both leave this screen on a URL whose read now 404s by construction, so both
   * hand the outcome to Pending drafts rather than rendering the missing state —
   * which would read as a fault for something the parent just chose. And both drop
   * every slot the draft was holding: left alone they would sit out their TTL and
   * come back as restored edits of a practice test nobody can reach.
   */
  const confirmTransition = useCallback(() => {
    const transition = pendingTransition;
    if (token === null || transition === null) return;
    setBusy(practiceTestId);
    setActionError(null);
    const call =
      transition === 'release' ? parentApi.releasePracticeTest : parentApi.discardPracticeTest;
    call(token, practiceTestId)
      .then(() => {
        setBusy(null);
        setPendingTransition(null);
        discardEverySlot();
        router.replace(transition === 'release' ? RELEASED_DRAFTS_HREF : DISCARDED_DRAFTS_HREF);
      })
      .catch((cause: unknown) => {
        setBusy(null);
        setPendingTransition(null);
        // A stale success sentence beside a fresh failure is a screen saying two
        // contradictory things at once.
        setNotice(null);
        failed(
          cause,
          transition === 'release'
            ? parentCopy.drafts.releaseFailed
            : parentCopy.drafts.discardFailed,
        );
      });
  }, [pendingTransition, token, practiceTestId, discardEverySlot, failed, router]);

  const lastQuestion = draft !== null && draft.questions.length === 1;

  /** The child this draft was made for, or a neutral stand-in if not in hand. */
  const studentName =
    profiles.find((profile) => profile.id === draft?.studentProfileId)?.displayName ??
    parentCopy.drafts.unknownStudent;

  return (
    <Screen>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.drafts.reviewTitle}
      </Typography>

      {missing && (
        // Not an error to retry: the draft is gone, and the only useful thing
        // on screen is the way back to what is still there.
        <Alert severity="info" role="status" variant="outlined" data-testid="draft-missing">
          {parentCopy.drafts.notFound}
        </Alert>
      )}

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="draft-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.drafts.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {actionError !== null && (
        <Alert severity="error" role="alert" variant="outlined" data-testid="draft-action-error">
          {actionError}
        </Alert>
      )}

      {/* Every state change that matters, announced in the same words it is
          shown in. Polite: nothing here interrupts what is being read. */}
      <Box role="status" aria-live="polite" data-testid="draft-notice">
        {notice}
      </Box>

      {loading ? (
        <Typography component="p" data-testid="draft-loading">
          {parentCopy.drafts.loading}
        </Typography>
      ) : (
        draft !== null &&
        !missing && (
          <>
            {/* Both figures are the server's: this browser holds one draft and
                could not count the others its job landed. */}
            <Typography component="p" data-testid="draft-position" sx={{ fontWeight: 700 }}>
              {parentCopy.drafts.position(draft.ordinal, draft.siblingCount)}
            </Typography>
            {/* Counted from the questions actually rendered, not from the
                stored `questionCount` column. The heading and the list would
                otherwise be two sources for one figure, and a row written
                without bumping the column would put them out of step — which
                is exactly the skew a parent reading "every question" must
                never be shown. */}
            {/* `tabIndex={-1}` so a delete can put focus here: the card the
                focused control was on has just gone, and this is the line that
                says what is left. Not reachable by tabbing. */}
            <Typography
              component="p"
              tabIndex={-1}
              ref={(node: HTMLElement | null) => {
                totalLine.current = node;
              }}
              data-testid="draft-question-total"
            >
              {parentCopy.drafts.questionTotal(draft.questions.length)}
            </Typography>

            {/* Every Question, in stored order, in one list. No pagination and
                nothing behind a control. */}
            <Box
              component="ol"
              // `listStyle: 'none'` strips list semantics in Safari/VoiceOver,
              // and with them the item count — which on this screen is the
              // whole point: "every Question" is what a parent is here to
              // verify. Put back by hand, as `PageStrip.tsx` does.
              role="list"
              sx={{ display: 'grid', gap: `${density.gap}px`, p: 0, m: 0 }}
            >
              {draft.questions.map((question) => {
                const edit = edits[question.id];
                const editing = edit !== undefined;
                return (
                  <Card
                    key={question.id}
                    component="li"
                    role="listitem"
                    sx={{ listStyle: 'none' }}
                    data-testid="draft-question"
                    data-ordinal={question.ordinal}
                    data-format={question.format}
                    data-editing={editing ? 'true' : 'false'}
                  >
                    <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                      <Typography component="h2" variant="label">
                        {parentCopy.drafts.questionHeading(question.ordinal)}
                      </Typography>

                      {editing ? (
                        <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
                          {edit.restored && (
                            <Alert
                              severity="info"
                              role="status"
                              variant="outlined"
                              data-testid="draft-edit-restored"
                            >
                              {parentCopy.drafts.editRestored}
                            </Alert>
                          )}
                          {/* Said once, before the save: what is stored here is
                              what the student is marked against. */}
                          <Typography component="p" data-testid="draft-edit-hint">
                            {parentCopy.drafts.editHint}
                          </Typography>

                          <TextField
                            id={`prompt-${question.id}`}
                            label={parentCopy.drafts.editPrompt}
                            multiline
                            value={edit.prompt}
                            // Focus lands here when the editor opens: the row a
                            // parent was on has been replaced by fields, and
                            // leaving focus behind on a control that no longer
                            // exists loses their place.
                            inputRef={(node: HTMLElement | null) => {
                              promptFields.current[question.id] = node;
                            }}
                            slotProps={{ htmlInput: { 'data-testid': 'draft-edit-prompt' } }}
                            onChange={(event) =>
                              change(question.id, { prompt: event.target.value })
                            }
                          />

                          {question.format === 'MultipleChoice' ? (
                            <>
                              {edit.choices.map((choice) => (
                                <TextField
                                  key={choice.ordinal}
                                  id={`choice-${question.id}-${choice.ordinal}`}
                                  label={parentCopy.drafts.editOption(choice.ordinal)}
                                  multiline
                                  value={choice.body}
                                  slotProps={{
                                    htmlInput: {
                                      'data-testid': 'draft-edit-choice',
                                      'data-ordinal': choice.ordinal,
                                    },
                                  }}
                                  onChange={(event) =>
                                    change(question.id, {
                                      choices: edit.choices.map((one) =>
                                        one.ordinal === choice.ordinal
                                          ? { ...one, body: event.target.value }
                                          : one,
                                      ),
                                    })
                                  }
                                />
                              ))}
                              {/* Which option is right is a choice of one, so
                                  it is a radio group with a real legend — never
                                  a colour, a position or a checkbox each. */}
                              <FormControl>
                                <FormLabel id={`correct-${question.id}`}>
                                  {parentCopy.drafts.editCorrectLegend}
                                </FormLabel>
                                <RadioGroup
                                  aria-labelledby={`correct-${question.id}`}
                                  value={edit.correctOrdinal ?? ''}
                                  onChange={(event) =>
                                    change(question.id, {
                                      correctOrdinal: Number(event.target.value),
                                    })
                                  }
                                >
                                  {edit.choices.map((choice) => (
                                    <FormControlLabel
                                      key={choice.ordinal}
                                      value={choice.ordinal}
                                      control={
                                        <Radio
                                          slotProps={{
                                            input: {
                                              'data-testid': 'draft-edit-correct',
                                              'data-ordinal': choice.ordinal,
                                            } as React.InputHTMLAttributes<HTMLInputElement>,
                                          }}
                                        />
                                      }
                                      label={parentCopy.drafts.editCorrectOption(choice.ordinal)}
                                    />
                                  ))}
                                </RadioGroup>
                              </FormControl>
                            </>
                          ) : (
                            <TextField
                              id={`answer-${question.id}`}
                              label={parentCopy.drafts.editAnswer}
                              multiline
                              value={edit.answer}
                              slotProps={{ htmlInput: { 'data-testid': 'draft-edit-answer' } }}
                              onChange={(event) =>
                                change(question.id, { answer: event.target.value })
                              }
                            />
                          )}

                          <Box sx={{ display: 'flex', gap: `${density.gap}px` }}>
                            <PrimaryButton
                              disabled={busy === question.id || !canSave(question, edit)}
                              data-testid="draft-edit-save"
                              onClick={() => save(question)}
                            >
                              {parentCopy.drafts.save}
                            </PrimaryButton>
                            <Button
                              type="button"
                              variant="outlined"
                              disabled={busy === question.id}
                              data-testid="draft-edit-cancel"
                              onClick={() => {
                                closeEditor(question.id);
                                discardSlot(question.id);
                                setFocusTarget({ kind: 'edit', questionId: question.id });
                              }}
                            >
                              {parentCopy.drafts.cancel}
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        <>
                          {/* Generated content, so the paper role and the serif
                              face — on the parent side too (UX-DR6). */}
                          <Typography
                            component="p"
                            variant="questionBody"
                            data-testid="draft-question-prompt"
                          >
                            <RichText segments={question.prompt} />
                          </Typography>

                          {question.choices.length > 0 && (
                            <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
                              <Typography component="h3" variant="label">
                                {parentCopy.drafts.optionsLabel}
                              </Typography>
                              <Box
                                component="ul"
                                // As above: the roles keep the option count
                                // audible once `listStyle: 'none'` has taken
                                // the semantics.
                                role="list"
                                sx={{ display: 'grid', gap: 0, p: 0, m: 0 }}
                              >
                                {question.choices.map((choice) => (
                                  <Typography
                                    key={choice.ordinal}
                                    component="li"
                                    role="listitem"
                                    variant="questionBody"
                                    sx={{ listStyle: 'none' }}
                                    data-testid="draft-choice"
                                    data-correct={choice.isCorrect ? 'true' : 'false'}
                                  >
                                    <RichText segments={choice.body} />
                                    {/* The correct option is marked in words,
                                        never by colour or position alone. */}
                                    {choice.isCorrect && (
                                      <Typography
                                        component="span"
                                        variant="label"
                                        data-testid="draft-choice-correct"
                                        sx={{ ml: `${density.gap}px` }}
                                      >
                                        {parentCopy.drafts.correctOption}
                                      </Typography>
                                    )}
                                  </Typography>
                                ))}
                              </Box>
                            </Box>
                          )}

                          {question.answer !== null && (
                            <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
                              <Typography component="h3" variant="label">
                                {parentCopy.drafts.correctAnswerLabel}
                              </Typography>
                              <Typography
                                component="p"
                                variant="questionBody"
                                data-testid="draft-question-answer"
                              >
                                <RichText segments={question.answer} />
                              </Typography>
                            </Box>
                          )}

                          <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
                            <Typography component="h3" variant="label">
                              {parentCopy.drafts.topicsLabel}
                            </Typography>
                            {/* Raw as stored (AD-11). Nothing here retitles,
                                merges or truncates a label read off the
                                parent's own page. */}
                            <Typography component="p" data-testid="draft-question-topics">
                              {question.topics.length === 0
                                ? parentCopy.drafts.noTopics
                                : question.topics.join(', ')}
                            </Typography>
                          </Box>

                          {/* Both act in place, on this row, with no
                              navigation. Real buttons with names that say which
                              Question they belong to. */}
                          <Box sx={{ display: 'flex', gap: `${density.gap}px` }}>
                            <Button
                              type="button"
                              variant="outlined"
                              ref={(node: HTMLElement | null) => {
                                editControls.current[question.id] = node;
                              }}
                              data-testid="draft-edit-open"
                              onClick={() => {
                                // Whatever was last announced is about to stop
                                // being what is on screen.
                                setNotice(null);
                                setActionError(null);
                                setEdits((open) => ({
                                  ...open,
                                  [question.id]: editorFor(question),
                                }));
                                setFocusTarget({ kind: 'prompt', questionId: question.id });
                              }}
                            >
                              {parentCopy.drafts.edit(question.ordinal)}
                            </Button>
                            <Button
                              type="button"
                              variant="outlined"
                              data-testid="draft-delete-open"
                              onClick={() => setPendingDelete(question)}
                            >
                              {parentCopy.drafts.delete(question.ordinal)}
                            </Button>
                          </Box>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </Box>

            {/* The draft as a whole, in either direction. Per draft and never in
                a batch: a released practice test appears on Student Home on its
                own, as each one is released. Both are real focusable buttons, and
                neither acts until the confirmation beside it has been read. */}
            <Box sx={{ display: 'flex', gap: `${density.gap}px` }}>
              <PrimaryButton
                disabled={busy !== null}
                data-testid="draft-release-open"
                onClick={() => {
                  setNotice(null);
                  setActionError(null);
                  setPendingTransition('release');
                }}
              >
                {parentCopy.drafts.release}
              </PrimaryButton>
              <Button
                type="button"
                variant="outlined"
                disabled={busy !== null}
                data-testid="draft-discard-open"
                onClick={() => {
                  setNotice(null);
                  setActionError(null);
                  setPendingTransition('discard');
                }}
              >
                {parentCopy.drafts.discard}
              </Button>
            </Box>
          </>
        )
      )}

      {/*
        An `AppDialog`, deliberately not the credential-gated confirmation in
        `Dialog.tsx`: that one re-asks for the account credential and is the
        account- and profile-deletion ceremony. A question is not that, and
        re-asking here would train a parent to type it at a dialog that does
        not need it.

        It names what is destroyed **before** anything is: which Question, and
        how many would be left. The last-Question variant says instead that the
        practice test is discarded and that the already-spent Generation
        Allowance is not given back — the epic requires both, in words, in
        advance. Cancel leaves the draft exactly as it was.
      */}
      <AppDialog
        open={pendingDelete !== null}
        title={lastQuestion ? parentCopy.drafts.deleteLastTitle : parentCopy.drafts.deleteTitle}
        onClose={() => setPendingDelete(null)}
        actions={
          <>
            <Button
              type="button"
              disabled={busy !== null}
              data-testid="draft-delete-cancel"
              onClick={() => setPendingDelete(null)}
            >
              {parentCopy.drafts.cancel}
            </Button>
            <DestructiveButton
              disabled={busy !== null}
              data-testid="draft-delete-confirm"
              onClick={confirmDelete}
            >
              {parentCopy.drafts.deleteConfirm}
            </DestructiveButton>
          </>
        }
      >
        <Typography component="p" data-testid="draft-delete-body">
          {pendingDelete === null
            ? ''
            : lastQuestion
              ? parentCopy.drafts.deleteLastBody
              : parentCopy.drafts.deleteBody(
                  pendingDelete.ordinal,
                  (draft?.questions.length ?? 1) - 1,
                )}
        </Typography>
      </AppDialog>

      {/*
        The same ordinary `AppDialog`, and for the same reason: re-asking for the
        account credential here would train a parent to type it at a dialog that
        does not need it.

        It names the consequence **before** the action, because neither has one
        afterwards: release, that the child can see it straight away and it can no
        longer be changed; discard, that the child never sees it and the Generation
        Allowance already spent is not given back. Cancel leaves the draft exactly
        as it was.
      */}
      <AppDialog
        open={pendingTransition !== null}
        title={
          pendingTransition === 'release'
            ? parentCopy.drafts.releaseTitle
            : parentCopy.drafts.discardTitle
        }
        onClose={() => setPendingTransition(null)}
        actions={
          <>
            <Button
              type="button"
              disabled={busy !== null}
              data-testid="draft-transition-cancel"
              onClick={() => setPendingTransition(null)}
            >
              {parentCopy.drafts.cancel}
            </Button>
            {pendingTransition === 'release' ? (
              <PrimaryButton
                disabled={busy !== null}
                data-testid="draft-release-confirm"
                onClick={confirmTransition}
              >
                {parentCopy.drafts.releaseConfirm}
              </PrimaryButton>
            ) : (
              <DestructiveButton
                disabled={busy !== null}
                data-testid="draft-discard-confirm"
                onClick={confirmTransition}
              >
                {parentCopy.drafts.discardConfirm}
              </DestructiveButton>
            )}
          </>
        }
      >
        <Typography component="p" data-testid="draft-transition-body">
          {pendingTransition === null
            ? ''
            : pendingTransition === 'release'
              ? parentCopy.drafts.releaseBody(studentName)
              : parentCopy.drafts.discardBody(studentName)}
        </Typography>
      </AppDialog>

      {/* Client-side, so the provider holding the elevation bearer survives the
          navigation. Offered in every state, including the missing one. */}
      <Link component={NextLink} href="/parent/drafts">
        {parentCopy.drafts.backToList}
      </Link>
    </Screen>
  );
}
