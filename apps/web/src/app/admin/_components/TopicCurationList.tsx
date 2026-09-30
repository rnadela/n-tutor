'use client';

import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminCopy } from '@/copy/admin';
import type { CanonicalTopic, ProvisionalTopic } from '@/lib/admin-api';
import { density } from '@/theme/tokens';

export interface TopicCurationListProps {
  topics: ProvisionalTopic[];
  /** Resolves `true` only when the write succeeded. */
  onConfirm: (topic: ProvisionalTopic) => Promise<boolean>;
  onRename: (topic: ProvisionalTopic, name: string) => Promise<boolean>;
  onMerge: (topic: ProvisionalTopic, target: CanonicalTopic) => Promise<boolean>;
  /** That Subject's whole canonical set. Rejects like any other read. */
  loadTargets: (subjectId: string) => Promise<CanonicalTopic[]>;
}

/**
 * The queue's `createdAt`, in one fixed rendering.
 *
 * **An explicit locale and an explicit zone, never the ambient ones.** This screen is
 * server-rendered and then hydrated, and `toLocaleString()` reads whatever locale and
 * timezone the process it runs in happens to have — so the server's rendering and the
 * browser's disagree, which React reports as a hydration mismatch and an operator sees
 * as a flicker. Two operators comparing the same queue in two zones would also be
 * reading two different instants for one row.
 *
 * The zone name is part of the format rather than a string in this file (AD-32): it
 * comes out of the formatter, so the rendered value says which instant it is without
 * this component writing a word.
 */
const CREATED_FORMAT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
  timeZoneName: 'short',
});

/** The stored instant, or a dash for one that will not parse. */
function createdOn(createdAt: string): string {
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) return adminCopy.topics.createdUndated;
  return CREATED_FORMAT.format(when);
}

/**
 * The curation queue: one row per provisional Topic, with the three actions.
 *
 * **The merge target set is per Subject, so it is fetched per row's Subject.** A
 * merge across Subjects is refused by the API — the canonical set is scoped by
 * Subject — so one global list would offer an operator targets every one of which
 * would come back a 400. The fetch happens when the operator opens the merge control
 * on a row, not on load: the queue spans Subjects, and loading every Subject's whole
 * canonical set to draw a table nobody has acted on yet is a read per row for
 * nothing.
 *
 * **The merge states what it is about to do before it fires.** The confirmation names
 * both Topics and how many Questions move, because nothing on this screen undoes a
 * merge: the tags move, the folded-away Topic is removed, and every affected child's
 * Mastery is recomputed.
 *
 * **The row itself never merges into itself**: the Topic being merged is filtered out
 * of its own target list, so the one refusal an operator could otherwise walk into by
 * mis-clicking is not offered.
 *
 * One write at a time per row, so a double-click cannot issue duplicate requests
 * whose responses land out of order.
 */
export function TopicCurationList(props: TopicCurationListProps) {
  const { topics } = props;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [targets, setTargets] = useState<CanonicalTopic[] | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState('');
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * Which target read the panel is currently waiting on.
   *
   * Opening row A's merge control and then row B's before A's Subject has answered
   * would otherwise land A's targets under B — a list of another Subject's Topics, every
   * one of which the API refuses, and which can include B itself. The counter is bumped
   * by every open and every close, so a read that is no longer the open one writes
   * nothing. A ref and not state: nothing renders from it, and a re-render between the
   * request and its answer must not reset it.
   */
  const targetsRequest = useRef(0);

  const isPending = (id: string) => pendingIds.has(id);

  async function withPending(id: string, run: () => Promise<boolean>): Promise<boolean> {
    if (pendingIds.has(id)) return false;
    setPendingIds((current) => new Set(current).add(id));
    try {
      return await run();
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function closeMerge() {
    // Any read still in flight is abandoned: its answer is about a panel nobody has open.
    targetsRequest.current += 1;
    setMergingId(null);
    setTargets(null);
    setTargetsError(null);
    setTargetId('');
  }

  async function openMerge(topic: ProvisionalTopic) {
    targetsRequest.current += 1;
    const request = targetsRequest.current;
    setRenamingId(null);
    setMergingId(topic.topicId);
    setTargets(null);
    setTargetsError(null);
    setTargetId('');
    try {
      const found = await props.loadTargets(topic.subjectId);
      // A read the operator has since moved on from answers nothing: showing one
      // Subject's set under another row is how a merge is offered a target the API
      // refuses — or the row itself.
      if (targetsRequest.current !== request) return;
      // The row's own Topic is never a target: merging a Topic into itself is the one
      // refusal an operator could walk into by mis-clicking.
      setTargets(found.filter((candidate) => candidate.topicId !== topic.topicId));
    } catch {
      if (targetsRequest.current !== request) return;
      setTargetsError(adminCopy.topics.loadFailed);
    }
  }

  if (topics.length === 0) {
    return (
      <Typography component="p" data-testid="topics-empty" sx={{ color: 'text.secondary' }}>
        {adminCopy.topics.empty}
      </Typography>
    );
  }

  return (
    <Card component="section" aria-labelledby="topics-heading">
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Table size="small" aria-labelledby="topics-heading">
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">
                {adminCopy.topics.nameColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {adminCopy.topics.subjectColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {adminCopy.topics.taggedColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {adminCopy.topics.createdColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {adminCopy.topics.actionsColumn}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {topics.map((topic) => (
              <TableRow
                key={topic.topicId}
                data-testid="topic-row"
                data-topic-id={topic.topicId}
                data-name={topic.name}
              >
                <TableCell>
                  {renamingId === topic.topicId ? (
                    <Box
                      component="form"
                      sx={{ display: 'flex', gap: `${density.gap}px` }}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const name = renameDraft.trim();
                        if (!name || isPending(topic.topicId)) return;
                        const saved = await withPending(topic.topicId, () =>
                          props.onRename(topic, name),
                        );
                        // Only close on success; a rejected name must survive the error.
                        if (saved) setRenamingId(null);
                      }}
                    >
                      <TextField
                        id={`topic-rename-${topic.topicId}`}
                        label={adminCopy.topics.renameLabel}
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        size="small"
                      />
                      <Button type="submit" variant="contained" disabled={isPending(topic.topicId)}>
                        {adminCopy.topics.saveName}
                      </Button>
                      <Button type="button" onClick={() => setRenamingId(null)}>
                        {adminCopy.topics.cancelRename}
                      </Button>
                    </Box>
                  ) : (
                    topic.name
                  )}
                </TableCell>
                <TableCell>{topic.subjectName}</TableCell>
                <TableCell data-testid="topic-tagged-count">{topic.taggedQuestionCount}</TableCell>
                <TableCell>{createdOn(topic.createdAt)}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'grid', gap: `${density.gap}px`, justifyItems: 'start' }}>
                    <Box sx={{ display: 'flex', gap: `${density.gap}px` }}>
                      <Button
                        type="button"
                        variant="contained"
                        disabled={isPending(topic.topicId)}
                        onClick={() => withPending(topic.topicId, () => props.onConfirm(topic))}
                        aria-label={`${adminCopy.topics.confirm} ${topic.name}`}
                      >
                        {adminCopy.topics.confirm}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          closeMerge();
                          setRenamingId(topic.topicId);
                          setRenameDraft(topic.name);
                        }}
                        aria-label={`${adminCopy.topics.rename} ${topic.name}`}
                      >
                        {adminCopy.topics.rename}
                      </Button>
                      <Button
                        type="button"
                        onClick={() =>
                          mergingId === topic.topicId ? closeMerge() : openMerge(topic)
                        }
                        aria-label={`${adminCopy.topics.startMerge} ${topic.name}`}
                      >
                        {mergingId === topic.topicId
                          ? adminCopy.topics.cancelMerge
                          : adminCopy.topics.startMerge}
                      </Button>
                    </Box>

                    {mergingId === topic.topicId && (
                      <Box
                        data-testid="topic-merge-panel"
                        sx={{ display: 'grid', gap: `${density.gap}px`, justifyItems: 'start' }}
                      >
                        {targetsError !== null ? (
                          <Alert severity="error" role="alert" variant="outlined">
                            {targetsError}
                          </Alert>
                        ) : targets === null ? (
                          <Typography component="p" role="status">
                            {adminCopy.topics.loadingTargets}
                          </Typography>
                        ) : targets.length === 0 ? (
                          <Typography component="p" sx={{ color: 'text.secondary' }}>
                            {adminCopy.topics.noTargets}
                          </Typography>
                        ) : (
                          <>
                            <TextField
                              select
                              id={`topic-merge-target-${topic.topicId}`}
                              label={adminCopy.topics.mergeTargetLabel}
                              value={targetId}
                              onChange={(event) => setTargetId(event.target.value)}
                              size="small"
                              sx={{ minWidth: 240 }}
                            >
                              <MenuItem value="">{adminCopy.topics.mergeTargetUnchosen}</MenuItem>
                              {targets.map((candidate) => (
                                <MenuItem key={candidate.topicId} value={candidate.topicId}>
                                  {`${candidate.name} (${
                                    candidate.provisional
                                      ? adminCopy.topics.targetProvisional
                                      : adminCopy.topics.targetConfirmed
                                  })`}
                                </MenuItem>
                              ))}
                            </TextField>

                            {/* Stated before it fires, and only once a target is chosen:
                                the count is the difference between folding away a stray
                                spelling and folding away a term's worth of history. */}
                            {targetId !== '' && (
                              <Typography component="p" data-testid="topic-merge-confirmation">
                                {adminCopy.topics.mergeConfirmation(
                                  topic.name,
                                  targets.find((candidate) => candidate.topicId === targetId)
                                    ?.name ?? '',
                                  topic.taggedQuestionCount,
                                )}
                              </Typography>
                            )}

                            <Button
                              type="button"
                              variant="contained"
                              disabled={targetId === '' || isPending(topic.topicId)}
                              onClick={async () => {
                                const target = targets.find(
                                  (candidate) => candidate.topicId === targetId,
                                );
                                if (target === undefined) return;
                                const merged = await withPending(topic.topicId, () =>
                                  props.onMerge(topic, target),
                                );
                                if (merged) closeMerge();
                              }}
                            >
                              {adminCopy.topics.merge}
                            </Button>
                          </>
                        )}
                      </Box>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
