'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { RichText } from '@/components/RichText';
import { Screen } from '@/components/Screen';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { parentApi, ParentApiError, type PracticeTestDraftView } from '@/lib/parent-api';
import { applyIfCurrent, endsParentView } from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/**
 * Draft review: one draft, read whole.
 *
 * **The URL is the review position.** The screen is addressed by Practice Test
 * id and stores nothing, so a reload, a return days later and a Parent View
 * idle expiry followed by a re-entry all resume on the same draft. A stored
 * position would be a slot to save to, a restore path to test and a second
 * answer to a question the address bar already holds durably and for free.
 *
 * Every Question the draft holds is rendered in one list, in stored order, each
 * with its correct answer, its options where it has them, and its Topics.
 * Nothing is paginated, collapsed or truncated: "every Question" is the
 * acceptance criterion the epic's human quality gate rests on.
 *
 * It is read-only by design. Editing is Story 4.4's, release and discard
 * 4.5's, the timer 4.6's — there is no control here that changes a draft.
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
  }, [token, practiceTestId, attempt, leave, router]);

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
            <Typography component="p" data-testid="draft-question-total">
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
              {draft.questions.map((question) => (
                <Card
                  key={question.id}
                  component="li"
                  role="listitem"
                  sx={{ listStyle: 'none' }}
                  data-testid="draft-question"
                  data-ordinal={question.ordinal}
                  data-format={question.format}
                >
                  <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
                    <Typography component="h2" variant="label">
                      {parentCopy.drafts.questionHeading(question.ordinal)}
                    </Typography>

                    {/* Generated content, so the paper role and the serif face
                        — on the parent side too (UX-DR6). */}
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
                          // As above: the roles keep the option count audible
                          // once `listStyle: 'none'` has taken the semantics.
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
                              {/* The correct option is marked in words, never
                                  by colour or position alone. */}
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
                      {/* Raw as stored (AD-11). Nothing here retitles, merges
                          or truncates a label read off the parent's own page. */}
                      <Typography component="p" data-testid="draft-question-topics">
                        {question.topics.length === 0
                          ? parentCopy.drafts.noTopics
                          : question.topics.join(', ')}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </>
        )
      )}

      {/* Client-side, so the provider holding the elevation bearer survives the
          navigation. Offered in every state, including the missing one. */}
      <Link component={NextLink} href="/parent/drafts">
        {parentCopy.drafts.backToList}
      </Link>
    </Screen>
  );
}
