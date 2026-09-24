'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NextLink, { type LinkProps } from 'next/link';
import type { Route } from 'next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Screen } from '@/components/Screen';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  ParentApiError,
  type PracticeTestDraftSummary,
  type StudentProfileView,
} from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/**
 * A draft's own address, which is the whole of its review position.
 *
 * Spelled once, and typed against the app's generated route table rather than
 * left as a bare string: a review screen reached by a URL this file invented
 * would 404 in the browser rather than at compile time.
 */
function draftHref(practiceTestId: string): Route<`/parent/drafts/${string}`> {
  return `/parent/drafts/${practiceTestId}`;
}

/**
 * `NextLink`, pinned to the draft route.
 *
 * MUI's `component` prop takes a concrete component, and handing it the
 * generic `NextLink` collapses its route parameter to `unknown` — under which
 * every *dynamic* route stops being a legal href, this one included. Pinning
 * the parameter here keeps the client-side navigation and keeps the route
 * checked against the generated table.
 */
function DraftLink(props: LinkProps<`/parent/drafts/${string}`>) {
  return <NextLink {...props} />;
}

/**
 * Pending drafts: the practice tests this account is holding and nobody has
 * read yet.
 *
 * A first-class Parent View destination rather than a step of the generate
 * flow, and that is what makes the progress screen's "leaving loses nothing"
 * true: a parent who walked away from a running job finds the drafts they paid
 * for here, without the URL they left.
 *
 * It shows what a draft *is* and never what it holds — which child, which of
 * its job's drafts, how many questions, when it landed. The questions are the
 * review screen's, one draft at a time.
 */
/**
 * What the review screen was not around to say.
 *
 * Deleting the last Question of a draft discards the whole practice test, and
 * the screen that knows is the one being navigated away from — a live region
 * unmounted mid-announcement says nothing at all. So the fact travels in the
 * URL and is stated here, by the screen the parent actually lands on.
 *
 * Its own component behind `Suspense` because `useSearchParams` opts a route
 * out of static prerendering otherwise, and this list is static but for this
 * one sentence.
 */
function DiscardedNotice() {
  const discarded = useSearchParams().get('discarded') === '1';
  if (!discarded) return null;
  return (
    <Alert severity="info" role="status" variant="outlined" data-testid="drafts-discarded">
      {parentCopy.drafts.discarded}
    </Alert>
  );
}

export default function PendingDraftsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [drafts, setDrafts] = useState<PracticeTestDraftSummary[]>([]);
  /**
   * The child names, joined in the browser.
   *
   * The Practice Test module does not read an identity table (AD-17), so its
   * drafts carry a `studentProfileId` and this screen resolves the name from
   * the Student Profile read every Parent View surface already has.
   */
  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the drafts read has actually answered.
   *
   * Held apart from `loading`, because "not loading" is also what a *failed*
   * read leaves behind — and an empty list is an assertion this screen cannot
   * make when it never heard back. Without this, a failure would render the
   * error alert and "there are none waiting" together, one of them untrue.
   */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry, so a load that stopped on an error re-issues. */
  const [attempt, setAttempt] = useState(0);

  const requestId = useRef(0);
  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  useEffect(() => {
    const issued = (requestId.current += 1);
    current.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setLoaded(false);
    setError(null);

    // The two reads settle **independently**, and deliberately not as one
    // `Promise.all`. The drafts read is the screen; the profile read only puts
    // a name on each row. Failing them together would blank a list that came
    // back perfectly well because a name could not be looked up — and would
    // leave the neutral stand-in below unreachable in practice, since the only
    // way to have drafts without profiles would also have been an error.
    parentApi.practiceTestDrafts(token).then(
      applyIfCurrent(current.current, issued, (waiting: PracticeTestDraftSummary[]) => {
        setDrafts(waiting);
        setLoaded(true);
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setError(
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : cause instanceof Error
              ? cause.message
              : parentCopy.drafts.listFailed,
        );
      }),
    );

    // A name that could not be read is a name this screen does without: the
    // rows still say which job they came from and still open. An expiry is the
    // one failure it does act on, because that is not about the profiles.
    parentApi.students(token).then(
      applyIfCurrent(current.current, issued, setProfiles),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) leave();
      }),
    );
  }, [token, attempt, leave, router]);

  /** The child's own name, or a neutral stand-in if the profile is not in hand. */
  const studentName = (studentProfileId: string): string =>
    profiles.find((profile) => profile.id === studentProfileId)?.displayName ??
    parentCopy.drafts.unknownStudent;

  return (
    <Screen>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.drafts.listTitle}
      </Typography>

      <Suspense fallback={null}>
        <DiscardedNotice />
      </Suspense>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="drafts-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.drafts.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading ? (
        <Typography component="p" data-testid="drafts-loading">
          {parentCopy.drafts.loading}
        </Typography>
      ) : (
        // Only once the drafts read has answered. "There are none waiting" is
        // a claim about the account, and a screen whose read failed is in no
        // position to make it.
        loaded && (
          <>
            <Typography component="p">{parentCopy.drafts.listIntro}</Typography>
            {drafts.length === 0 ? (
              // Nothing waiting is a state, said as a plain sentence. The way
              // back is below, and is the same one every other case gets.
              <Typography component="p" data-testid="drafts-empty">
                {parentCopy.drafts.empty}
              </Typography>
            ) : (
              <Box
                component="ul"
                // `listStyle: 'none'` strips list semantics in Safari/VoiceOver,
                // which takes the item count with it — and the count is the one
                // thing a parent scanning what is waiting needs announced. The
                // roles put it back, exactly as `PageStrip.tsx` does.
                role="list"
                sx={{ display: 'grid', gap: `${density.gap}px`, p: 0, m: 0 }}
              >
                {drafts.map((draft) => (
                  <Card
                    key={draft.id}
                    component="li"
                    role="listitem"
                    sx={{ listStyle: 'none' }}
                    data-testid="draft-row"
                    data-draft-id={draft.id}
                  >
                    <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                      <Typography component="h2" variant="cardTitle">
                        {parentCopy.drafts.forStudent(studentName(draft.studentProfileId))}
                      </Typography>
                      {/* Both figures are the server's. The browser holds one
                          draft and could not count its siblings. */}
                      <Typography component="p" data-testid="draft-position">
                        {parentCopy.drafts.position(draft.ordinal, draft.siblingCount)}
                      </Typography>
                      {/* The stored column, and rightly so here: this screen
                          renders no questions, so it has nothing to count. */}
                      <Typography component="p" data-testid="draft-question-total">
                        {parentCopy.drafts.questionTotal(draft.questionCount)}
                      </Typography>
                      <Typography component="p">
                        {parentCopy.drafts.made(new Date(draft.createdAt).toLocaleString())}
                      </Typography>
                      {/* Client-side, so the provider holding the elevation
                          bearer stays mounted across the navigation. */}
                      <Link
                        component={DraftLink}
                        href={draftHref(draft.id)}
                        sx={{ minHeight: density.tapTarget }}
                      >
                        {parentCopy.drafts.open}
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </>
        )
      )}

      <Link component={NextLink} href="/parent">
        {parentCopy.drafts.backToParentView}
      </Link>
    </Screen>
  );
}
