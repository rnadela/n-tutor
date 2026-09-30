'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { adminCopy } from '@/copy/admin';
import {
  AdminApiError,
  adminApi,
  clearToken,
  readToken,
  type ProvisionalTopic,
} from '@/lib/admin-api';
import { density } from '@/theme/tokens';
import { TopicCurationList } from '../_components/TopicCurationList';

/**
 * The Topic curation screen: the provisional queue, and the three actions on it.
 *
 * **Why the screen exists.** The AD-11 cascade mints a provisional Topic whenever a
 * label matches nothing, and until now nothing could confirm, rename or merge one —
 * so a Subject's canonical set accumulates unreviewed near-duplicates and every
 * parent's Mastery picture fragments quietly as a term goes on. This is where an
 * operator drains that queue.
 *
 * **Every action is the server's.** Nothing here re-points a tag, deletes a Topic or
 * recomputes a figure: each control is one call, and the API does all three inside
 * one transaction. This screen decides nothing and re-derives nothing — not the
 * queue's order, not the tagged count, not which Topics may be merged.
 *
 * It follows the taxonomy screen's shape exactly: the token check, the `reload`, the
 * live region every change is announced into, and the 401-only bounce back to
 * sign-in. Any other failure is a sentence with a Retry rather than a thrown-away
 * session.
 */
export default function TopicCurationPage() {
  const router = useRouter();
  /** `null` until the read answers, so "the queue is empty" is never the first render. */
  const [topics, setTopics] = useState<ProvisionalTopic[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toLogin = useCallback(() => {
    // Cleared first, so the login screen's already-signed-in check cannot bounce
    // straight back here on a token the server has already rejected.
    clearToken();
    router.replace('/admin/login');
  }, [router]);

  const reload = useCallback(async () => {
    setTopics(await adminApi.provisionalTopics());
  }, []);

  const load = useCallback(() => {
    if (!readToken()) {
      router.replace('/admin/login');
      return;
    }
    setError(null);
    reload().catch((cause: unknown) => {
      if (cause instanceof AdminApiError && cause.status === 401) {
        toLogin();
        return;
      }
      setError(adminCopy.topics.loadFailed);
    });
  }, [reload, router, toLogin]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Re-reads the queue and never reports the read as the action's own outcome.
   *
   * The queue is re-read after every write, successful or not, so a row drawn from it
   * can never be left disagreeing with the server — a merge in particular removes a
   * row, and a screen still showing it would offer actions on a Topic that no longer
   * exists. But a read that fails is a **load** failure, not the write's: the write
   * already committed, and telling the operator their action failed is what sends them
   * back to retry a confirm on a Topic that is already confirmed, or a merge on a Topic
   * that is already gone.
   */
  const refresh = useCallback(async () => {
    try {
      await reload();
    } catch (cause: unknown) {
      if (cause instanceof AdminApiError && cause.status === 401) {
        toLogin();
        return;
      }
      setError(adminCopy.topics.loadFailed);
    }
  }, [reload, toLogin]);

  /**
   * Runs one write. Resolves `true` only when **the write** succeeded, so a control
   * keeps the operator's typed input on failure and discards it on success.
   *
   * The write's outcome and the re-read's are deliberately separate: a success is
   * announced before the queue is re-read, so a re-read that then fails leaves the
   * operator holding both facts — what their action did, and that the list beneath it
   * is stale — rather than one sentence that contradicts the server.
   */
  const run = useCallback(
    async (action: () => Promise<string>): Promise<boolean> => {
      setError(null);
      let message: string;
      try {
        message = await action();
      } catch (cause: unknown) {
        if (cause instanceof AdminApiError && cause.status === 401) {
          toLogin();
          return false;
        }
        setError(cause instanceof AdminApiError ? cause.message : adminCopy.errors.generic);
        // The write failed, but the queue may still have moved under it.
        await refresh();
        return false;
      }
      // Announced before the re-read, so the success cannot be lost to it.
      setAnnouncement(message);
      await refresh();
      return true;
    },
    [refresh, toLogin],
  );

  if (topics === null) {
    return error ? (
      <Box sx={{ display: 'grid', gap: `${density.gap}px`, justifyItems: 'start' }}>
        <Alert severity="error" role="alert" variant="outlined" data-testid="topics-error">
          {error}
        </Alert>
        <Button type="button" variant="contained" onClick={load}>
          {adminCopy.topics.retry}
        </Button>
      </Box>
    ) : (
      <Typography component="p" role="status" data-testid="topics-loading">
        {adminCopy.topics.loading}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: `${density.sectionMargin}px` }}>
      <Box>
        <Typography id="topics-heading" component="h1" sx={{ fontSize: 22, fontWeight: 700 }}>
          {adminCopy.topics.title}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {adminCopy.topics.intro}
        </Typography>
      </Box>

      {/* Every change is announced here. */}
      <Box aria-live="polite" role="status" sx={{ minHeight: density.gap * 2 }}>
        <Typography component="span">{announcement}</Typography>
      </Box>

      {error && (
        <Alert severity="error" role="alert" variant="outlined" data-testid="topics-error">
          {error}
        </Alert>
      )}

      <TopicCurationList
        topics={topics}
        loadTargets={async (subjectId) => {
          try {
            return await adminApi.subjectTopics(subjectId);
          } catch (cause: unknown) {
            if (cause instanceof AdminApiError && cause.status === 401) {
              toLogin();
            }
            throw cause;
          }
        }}
        onConfirm={(topic) =>
          run(async () => {
            const confirmed = await adminApi.confirmTopic(topic.topicId);
            return adminCopy.announce.topicConfirmed(confirmed.name);
          })
        }
        onRename={(topic, name) =>
          run(async () => {
            const renamed = await adminApi.renameTopic(topic.topicId, name);
            return adminCopy.announce.topicRenamed(topic.name, renamed.name);
          })
        }
        onMerge={(topic, target) =>
          run(async () => {
            const result = await adminApi.mergeTopic(topic.topicId, target.topicId);
            return adminCopy.announce.topicMerged(topic.name, target.name, result.repointed);
          })
        }
      />
    </Box>
  );
}
