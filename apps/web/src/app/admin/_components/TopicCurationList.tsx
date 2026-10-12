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
import { Check, CircleCheck, GitMerge, Pencil, TriangleAlert } from 'lucide-react';
import { RowActions } from '@/components/RowActions';
import { CardField, CardList, TableCard, TableOnDesktop } from '@/components/TableCards';
import { adminCopy } from '@/copy/admin';
import type { CanonicalTopic, ProvisionalTopic } from '@/lib/admin-api';
import { density, rounded } from '@/theme/tokens';

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
 *
 * **Two layouts, one state (UX-DR44).** From the desktop breakpoint this is the
 * five-column table; below it every row is a card titled by the Topic, with the
 * Subject, the tagged count and the created instant as labeled fields and the
 * rename form and the merge panel opening inside the card they belong to. Both
 * layouts read `renamingId`, `mergingId`, `targets` and `pendingIds` — there is no
 * second copy of any of them, and no second read of a Subject's canonical set. The
 * card's row-scoped ids are suffixed `-card` so no `<label>` points at an `id`
 * that appears twice.
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

  /**
   * The rename form, in whichever layout is asking for it. `idSuffix` is empty in
   * the table and `-card` on the card, so the one visible input is the one its own
   * label points at.
   */
  function renameForm(topic: ProvisionalTopic, idSuffix: string) {
    return (
      <Box
        component="form"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: `${density.gap}px`, flex: 1, minWidth: 0 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const name = renameDraft.trim();
          if (!name || isPending(topic.topicId)) return;
          const saved = await withPending(topic.topicId, () => props.onRename(topic, name));
          // Only close on success; a rejected name must survive the error.
          if (saved) setRenamingId(null);
        }}
      >
        <TextField
          id={`topic-rename-${topic.topicId}${idSuffix}`}
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
    );
  }

  /**
   * The row's three actions, unchanged in either layout.
   *
   * All three go behind the ⋮ (UX-DR43): a confirm, a merge and a rename are none
   * of them a glyph an operator could read standing alone, and three text buttons
   * are what made this cell wrap.
   */
  function rowActions(topic: ProvisionalTopic) {
    return (
      <RowActions
        menuLabel={adminCopy.rowActionsLabel(topic.name)}
        actions={[
          {
            key: 'confirm',
            label: adminCopy.topics.confirm,
            ariaLabel: `${adminCopy.topics.confirm} ${topic.name}`,
            icon: <Check size={16} aria-hidden="true" />,
            disabled: isPending(topic.topicId),
            onClick: () => {
              void withPending(topic.topicId, () => props.onConfirm(topic));
            },
          },
          {
            key: 'rename',
            label: adminCopy.topics.rename,
            ariaLabel: `${adminCopy.topics.rename} ${topic.name}`,
            icon: <Pencil size={16} aria-hidden="true" />,
            selfEvident: true,
            onClick: () => {
              closeMerge();
              setRenamingId(topic.topicId);
              setRenameDraft(topic.name);
            },
          },
          {
            key: 'merge',
            // The item is the toggle, so it says which way it goes and carries
            // the panel's open state with it.
            label:
              mergingId === topic.topicId
                ? adminCopy.topics.cancelMerge
                : adminCopy.topics.startMerge,
            // The accessible name mirrors the visible label, both ways (WCAG
            // 2.5.3): an item reading "Cancel merge" that answers to "Merge
            // Fractions" is a control a voice user cannot name.
            ariaLabel: `${
              mergingId === topic.topicId
                ? adminCopy.topics.cancelMerge
                : adminCopy.topics.startMerge
            } ${topic.name}`,
            icon: <GitMerge size={16} aria-hidden="true" />,
            expanded: mergingId === topic.topicId,
            onClick: () => {
              if (mergingId === topic.topicId) closeMerge();
              else void openMerge(topic);
            },
          },
        ]}
      />
    );
  }

  /** The merge panel, rendered inside whichever layout the row is drawn in. */
  function mergePanel(topic: ProvisionalTopic, idSuffix: string) {
    return (
      <Box
        data-testid={`topic-merge-panel${idSuffix}`}
        sx={{
          display: 'grid',
          gap: `${density.gap}px`,
          justifyItems: 'start',
          p: `${density.cardPadding}px`,
          bgcolor: 'action.hover',
          borderRadius: `${rounded.control}px`,
          width: 1,
        }}
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
              id={`topic-merge-target-${topic.topicId}${idSuffix}`}
              label={adminCopy.topics.mergeTargetLabel}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              size="small"
              sx={{ minWidth: 240, maxWidth: '100%' }}
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

            {/* Stated before it fires, and only once a target is chosen: the count
              is the difference between folding away a stray spelling and folding
              away a term's worth of history. */}
            {targetId !== '' && (
              <Typography
                component="p"
                data-testid={`topic-merge-confirmation${idSuffix}`}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: `${density.gap}px`,
                  color: 'warning.main',
                }}
              >
                <TriangleAlert size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                {adminCopy.topics.mergeConfirmation(
                  topic.name,
                  targets.find((candidate) => candidate.topicId === targetId)?.name ?? '',
                  topic.taggedQuestionCount,
                )}
              </Typography>
            )}

            <Button
              type="button"
              variant="contained"
              disabled={targetId === '' || isPending(topic.topicId)}
              onClick={async () => {
                const target = targets.find((candidate) => candidate.topicId === targetId);
                if (target === undefined) return;
                const merged = await withPending(topic.topicId, () => props.onMerge(topic, target));
                if (merged) closeMerge();
              }}
            >
              {adminCopy.topics.merge}
            </Button>
          </>
        )}
      </Box>
    );
  }

  if (topics.length === 0) {
    return (
      <Box
        sx={{
          display: 'grid',
          justifyItems: 'center',
          gap: `${density.gap}px`,
          py: `${density.sectionMargin * 1.5}px`,
          px: `${density.cardPadding}px`,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: `${rounded.control}px`,
          color: 'text.secondary',
          textAlign: 'center',
        }}
      >
        <CircleCheck size={28} aria-hidden="true" />
        <Typography component="p" data-testid="topics-empty">
          {adminCopy.topics.empty}
        </Typography>
      </Box>
    );
  }

  return (
    <Card component="section" aria-labelledby="topics-heading">
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <TableOnDesktop>
          <Table
            size="small"
            aria-labelledby="topics-heading"
            sx={{
              '& thead th': {
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'text.secondary',
                whiteSpace: 'nowrap',
              },
              '& tbody td': { verticalAlign: 'top', py: `${density.gap * 1.5}px` },
              '& tbody tr:hover': { bgcolor: 'action.hover' },
            }}
          >
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
                      renameForm(topic, '')
                    ) : (
                      <Typography component="span" sx={{ fontWeight: 600 }}>
                        {topic.name}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{topic.subjectName}</TableCell>
                  <TableCell
                    data-testid="topic-tagged-count"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {topic.taggedQuestionCount}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {createdOn(topic.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'grid', gap: `${density.gap}px`, justifyItems: 'start' }}>
                      {rowActions(topic)}
                      {mergingId === topic.topicId && mergePanel(topic, '')}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableOnDesktop>

        {/* The same rows below the desktop breakpoint. The rename form and the
          merge panel open inside the card they belong to, reading the one piece
          of state the table reads. */}
        <CardList label={adminCopy.topics.title} testId="topic-cards">
          {topics.map((topic) => (
            <TableCard
              key={topic.topicId}
              title={topic.name}
              titleContent={renamingId === topic.topicId ? renameForm(topic, '-card') : undefined}
              actions={rowActions(topic)}
              testId="topic-card"
              dataAttributes={{ 'data-topic-id': topic.topicId, 'data-name': topic.name }}
            >
              <CardField label={adminCopy.topics.subjectColumn} value={topic.subjectName} />
              <CardField
                label={adminCopy.topics.taggedColumn}
                value={topic.taggedQuestionCount}
                tabular
                testId="topic-tagged-count-card"
              />
              <CardField
                label={adminCopy.topics.createdColumn}
                value={createdOn(topic.createdAt)}
                tabular
              />
              {mergingId === topic.topicId && mergePanel(topic, '-card')}
            </TableCard>
          ))}
        </CardList>
      </CardContent>
    </Card>
  );
}
