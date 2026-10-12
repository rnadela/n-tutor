'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { PrimaryButton } from '@/components/Button';
import { AppDialog, DestructiveConfirmDialog } from '@/components/Dialog';
import { RowActions } from '@/components/RowActions';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import {
  parentApi,
  type AuthPolicy,
  type StudentDeletionPreview,
  type StudentProfileView,
  type TaxonomyItem,
} from '@/lib/parent-api';
import {
  announcedText,
  applyIfCurrent,
  endsParentView,
  NOTHING_ANNOUNCED,
  refusalText,
  type Announcement,
} from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/**
 * A create is refused before it leaves the browser unless both a name and a
 * grade level are present: a profile requires exactly one grade level, and a
 * name of nothing but whitespace is no name at all.
 *
 * Exported so the rule is testable as a rule, rather than only through a
 * rendered control's `disabled` attribute.
 */
export function canCreateStudent(displayName: string, gradeLevelId: string): boolean {
  return displayName.trim().length > 0 && gradeLevelId.length > 0;
}

/**
 * What a refused create puts on the screen.
 *
 * A rule rather than an expression inside the catch, for the reason
 * `canCreateStudent` is one: the decision is then testable as a decision, not
 * only through a control's rendered state.
 *
 * The API states a rule-refusal as a 409 whose body carries its own sentence —
 * here, the Account Tier and the number of active Student Profiles it allows.
 * That sentence is the only place a parent learns why, so it wins over this
 * screen's generic fallback, which says nothing they can act on. This app
 * states no tier and no figure of its own; it only decides whose words to show.
 */
export function createRefusal(cause: unknown): string {
  return refusalText(cause, parentCopy.students.failed);
}

/**
 * Re-exported rather than defined here: other parent-scoped screens need the
 * same rules, so they live in `@/lib/parent-view` and every screen reads them
 * from one place. The names stay reachable here because that is where this
 * screen's spec has always addressed them.
 *
 * `refusalText` is among them now: the Settings screen gates an account deletion
 * behind the same 409, and one rule with two implementations is a rule that
 * drifts while both suites stay green.
 */
export {
  announcedText,
  applyIfCurrent,
  endsParentView,
  NOTHING_ANNOUNCED,
  refusalText,
  type Announcement,
} from '@/lib/parent-view';

interface Draft {
  displayName: string;
  gradeLevelId: string;
}

const EMPTY_DRAFT: Draft = { displayName: '', gradeLevelId: '' };

/**
 * The Students screen: create, rename, change grade level, archive, restore.
 *
 * **The row's two per-row notes are gone with the notes row they sat in.**
 * Archive's distinction from Delete now lives in two separate menu items with
 * their own icons, in the divider and error colour on Delete, and in the two
 * confirmations — which already say "history is kept. Nothing is deleted." and
 * "cannot be undone". A sentence per row above that is a third statement of the
 * same thing, in the cell this story exists to unclutter.
 */
export default function StudentsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [gradeLevels, setGradeLevels] = useState<TaxonomyItem[]>([]);
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  /** A write the server refused. Retrying the page load would not change it. */
  const [error, setError] = useState<string | null>(null);
  /** The page's own read failed; reloading it is the remedy, so it offers one. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(NOTHING_ANNOUNCED);
  /** Every announcement is a change, repeats included. */
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => ({ text, seq: previous.seq + 1 })),
    [],
  );
  /**
   * A refusal replaces the last success sentence rather than sitting under it:
   * "Ava was added." above "the Free tier allows 1 profile" reads as both
   * having happened to the same request.
   */
  const refuse = useCallback((text: string) => {
    setAnnouncement(NOTHING_ANNOUNCED);
    setError(text);
  }, []);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // One write at a time per row, so a double-tap cannot issue two requests
  // whose responses land out of order.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * The child a confirmation is open for, with the counts it names.
   *
   * The counts are read **before** the dialog opens rather than while it is up:
   * FR-33 requires the sentence the parent confirms against to name what will be
   * destroyed, and a dialog that opened first and filled in its own numbers
   * afterwards would be a dialog that is briefly confirmable against nothing.
   */
  const [confirmingDelete, setConfirmingDelete] = useState<{
    profile: StudentProfileView;
    counts: StudentDeletionPreview;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The row whose preview is in flight, so a second tap issues no second read. */
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  /**
   * Why the last confirm was refused, shown inside the dialog rather than on the
   * page: the page's own alert sits under the modal backdrop.
   */
  const [deleteRefusal, setDeleteRefusal] = useState<string | null>(null);
  /** The child an archive confirmation is open for. */
  const [confirmingArchive, setConfirmingArchive] = useState<StudentProfileView | null>(null);

  const token = elevation?.token ?? null;
  const requestId = useRef(0);

  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  const load = useCallback(() => {
    const issued = (requestId.current += 1);
    current.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    setLoadError(null);
    Promise.all([parentApi.students(token), parentApi.gradeLevels(token), parentApi.policy()]).then(
      applyIfCurrent(
        current.current,
        issued,
        ([students, levels, authPolicy]: [StudentProfileView[], TaxonomyItem[], AuthPolicy]) => {
          setProfiles(students);
          setGradeLevels(levels);
          setPolicy(authPolicy);
          setLoading(false);
        },
      ),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setLoadError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
      }),
    );
  }, [token, router, leave]);

  useEffect(() => {
    load();
  }, [load]);

  /** Re-reads the list after a write, so nothing on screen is guessed at. */
  const refresh = useCallback(async () => {
    if (token === null) return;
    const issued = (requestId.current += 1);
    current.current.value = issued;
    const students = await parentApi.students(token);
    applyIfCurrent(current.current, issued, setProfiles)(students);
  }, [token]);

  /**
   * One write, with the row locked, the announcement made and errors shown.
   *
   * `showRefusal` decides **where** a refusal lands. By default it is the page's
   * own alert; a caller whose control lives inside a modal passes its own setter,
   * because the page alert sits under the backdrop and is invisible from there.
   */
  async function write(
    id: string,
    run: () => Promise<string>,
    showRefusal: (text: string) => void = refuse,
  ): Promise<boolean> {
    if (token === null || pendingIds.has(id)) return false;
    setPendingIds((ids) => new Set(ids).add(id));
    setError(null);
    try {
      const said = await run();
      await refresh();
      announce(said);
      return true;
    } catch (cause) {
      if (endsParentView(cause)) {
        leave();
        return false;
      }
      // A 409 carries the API's own policy sentence as `reason`, which is what
      // the parent has to read to act: "that is not the account password" is
      // actionable and "that change could not be saved" is not.
      showRefusal(refusalText(cause, parentCopy.students.failed));
      return false;
    } finally {
      setPendingIds((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  }

  const isPending = (id: string) => pendingIds.has(id);

  /**
   * Reads what would go, then opens the confirmation naming it.
   *
   * The preview is guarded and staleness-checked like every other read on this
   * screen: two taps would otherwise issue two reads, and the later response
   * would overwrite the counts the open dialog is already showing — a parent
   * confirming against numbers that changed under them. `confirmingDelete` is
   * checked too, not only `previewingId`: once a preview settles and the dialog
   * is open for one profile, a tap on a *different* row's Delete control would
   * otherwise start a second preview and, on success, swap the open dialog's
   * subject and counts out from under the parent reading them.
   */
  async function onDeleteRequested(profile: StudentProfileView): Promise<void> {
    if (token === null || isPending(profile.id) || previewingId !== null) return;
    if (confirmingDelete !== null) return;
    setError(null);
    setDeleteRefusal(null);
    setPreviewingId(profile.id);
    const issued = (requestId.current += 1);
    current.current.value = issued;
    try {
      const counts = await parentApi.studentDeletionPreview(token, profile.id);
      applyIfCurrent(current.current, issued, (fresh: StudentDeletionPreview) =>
        setConfirmingDelete({ profile, counts: fresh }),
      )(counts);
    } catch (cause) {
      if (endsParentView(cause)) {
        leave();
        return;
      }
      refuse(refusalText(cause, parentCopy.students.deleteFailed));
    } finally {
      setPreviewingId(null);
    }
  }

  /**
   * The delete itself. A refusal leaves the dialog open with the reason **in**
   * it: the parent mistyped a password, and closing the thing they were typing
   * into would make them start again — while showing the reason on the page
   * behind would put it under the backdrop, where they cannot read it.
   */
  async function onDeleteConfirmed(password: string): Promise<void> {
    const pending = confirmingDelete;
    if (pending === null || token === null) return;
    setDeleting(true);
    // A stale refusal must never sit beside a fresh attempt.
    setDeleteRefusal(null);
    try {
      const done = await write(
        pending.profile.id,
        async () => {
          await parentApi.deleteStudent(token, pending.profile.id, password);
          return parentCopy.students.deleted(pending.profile.displayName);
        },
        setDeleteRefusal,
      );
      if (done) setConfirmingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  /** Closing the confirmation drops the refusal with it. */
  function onDeleteCancelled(): void {
    setConfirmingDelete(null);
    setDeleteRefusal(null);
  }

  /** Archives once confirmed; the dialog closes whether the write lands or not. */
  async function onArchiveConfirmed(): Promise<void> {
    const profile = confirmingArchive;
    if (profile === null || token === null) return;
    setConfirmingArchive(null);
    await write(profile.id, async () => {
      await parentApi.archiveStudent(token, profile.id);
      return parentCopy.students.archived(profile.displayName);
    });
  }

  async function onCreate(): Promise<void> {
    if (token === null || creating || !canCreateStudent(draft.displayName, draft.gradeLevelId)) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await parentApi.createStudent(token, {
        displayName: draft.displayName.trim(),
        gradeLevelId: draft.gradeLevelId,
      });
      await refresh();
      // Cleared only on success; a refused name must survive the error.
      setDraft(EMPTY_DRAFT);
      announce(parentCopy.students.added(created.displayName));
    } catch (cause) {
      if (endsParentView(cause)) {
        leave();
        return;
      }
      refuse(createRefusal(cause));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Box
      component="section"
      sx={{ maxWidth: 840, mx: 'auto', display: 'grid', gap: `${density.gap * 2}px` }}
    >
      <Box component="header" sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {parentCopy.students.title}
        </Typography>
        <Typography sx={{ color: 'text.secondary' }}>{parentCopy.students.intro}</Typography>
      </Box>

      {/* Every change is announced with the same words the screen shows. */}
      <Box role="status" aria-live="polite" sx={{ minHeight: 0 }}>
        {announcedText(announcement)}
      </Box>

      {loadError !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
        >
          {loadError}
        </Alert>
      )}
      {error !== null && (
        <Alert severity="error" role="alert" variant="outlined">
          {error}
        </Alert>
      )}

      {loading ? (
        <Alert severity="info" role="status" variant="outlined">
          {parentCopy.students.loading}
        </Alert>
      ) : (
        <>
          <Card>
            {profiles.length === 0 ? (
              <Box
                sx={{
                  display: 'grid',
                  justifyItems: 'center',
                  gap: `${density.gap}px`,
                  py: `${density.sectionMargin * 2}px`,
                  px: `${density.cardPadding}px`,
                  color: 'text.secondary',
                  textAlign: 'center',
                }}
              >
                <Users size={28} aria-hidden="true" />
                <Typography component="p">{parentCopy.students.empty}</Typography>
              </Box>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table
                  size="small"
                  aria-label={parentCopy.students.title}
                  sx={{
                    '& thead th': {
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                      whiteSpace: 'nowrap',
                      py: `${density.gap * 1.5}px`,
                    },
                    '& tbody td': { verticalAlign: 'top', py: `${density.cardPadding}px` },
                    '& tbody tr:last-of-type td': { borderBottom: 0 },
                    '& tbody tr:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell component="th" scope="col">
                        {parentCopy.students.nameColumn}
                      </TableCell>
                      <TableCell component="th" scope="col">
                        {parentCopy.students.gradeLevelColumn}
                      </TableCell>
                      <TableCell component="th" scope="col">
                        {parentCopy.students.statusColumn}
                      </TableCell>
                      <TableCell component="th" scope="col">
                        {parentCopy.students.actionsColumn}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {profiles.map((profile) => (
                      <TableRow
                        key={profile.id}
                        data-testid="student-row"
                        data-profile-id={profile.id}
                        data-name={profile.displayName}
                      >
                        <TableCell>
                          {renamingId === profile.id ? (
                            <Box
                              component="form"
                              sx={{ display: 'flex', gap: `${density.gap}px` }}
                              onSubmit={async (event) => {
                                event.preventDefault();
                                const name = renameDraft.trim();
                                if (!name) return;
                                const saved = await write(profile.id, async () => {
                                  const after = await parentApi.updateStudent(token!, profile.id, {
                                    displayName: name,
                                  });
                                  return parentCopy.students.renamed(after.displayName);
                                });
                                if (saved) setRenamingId(null);
                              }}
                            >
                              <TextField
                                id={`student-rename-${profile.id}`}
                                label={parentCopy.students.renameLabel}
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                required
                                size="small"
                                slotProps={{
                                  htmlInput: policy
                                    ? { maxLength: policy.studentNameMaxLength }
                                    : undefined,
                                }}
                                helperText={
                                  policy
                                    ? parentCopy.students.nameMaximum(policy.studentNameMaxLength)
                                    : undefined
                                }
                              />
                              <Button
                                type="submit"
                                variant="contained"
                                disabled={isPending(profile.id)}
                                sx={{ minHeight: density.tapTarget }}
                              >
                                {parentCopy.students.saveName}
                              </Button>
                              <Button
                                type="button"
                                onClick={() => setRenamingId(null)}
                                sx={{ minHeight: density.tapTarget }}
                              >
                                {parentCopy.students.cancel}
                              </Button>
                            </Box>
                          ) : (
                            <Typography component="span" sx={{ fontWeight: 600 }}>
                              {profile.displayName}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
                            <TextField
                              id={`student-grade-level-${profile.id}`}
                              select
                              size="small"
                              // Names the child, so a row's select is telling
                              // apart from every other row's by its name alone.
                              label={parentCopy.students.changeGradeLevelFor(profile.displayName)}
                              value={
                                gradeLevels.some((level) => level.id === profile.gradeLevelId)
                                  ? profile.gradeLevelId
                                  : ''
                              }
                              disabled={isPending(profile.id)}
                              onChange={(event) => {
                                const gradeLevelId = event.target.value;
                                if (!gradeLevelId || gradeLevelId === profile.gradeLevelId) return;
                                void write(profile.id, async () => {
                                  const after = await parentApi.updateStudent(token!, profile.id, {
                                    gradeLevelId,
                                  });
                                  return parentCopy.students.gradeLevelChanged(
                                    after.displayName,
                                    after.gradeLevelName,
                                  );
                                });
                              }}
                              helperText={
                                profile.gradeLevelEnabled
                                  ? parentCopy.students.gradeLevelNote
                                  : parentCopy.students.gradeLevelWithdrawn
                              }
                            >
                              {gradeLevels.map((level) => (
                                <MenuItem key={level.id} value={level.id}>
                                  {level.name}
                                </MenuItem>
                              ))}
                            </TextField>
                            {/* The stored grade level's name, only when the select
                              cannot show it because it is no longer offered. */}
                            {!gradeLevels.some((level) => level.id === profile.gradeLevelId) && (
                              <Typography component="span">{profile.gradeLevelName}</Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={profile.archived ? 'default' : 'success'}
                            label={
                              profile.archived
                                ? parentCopy.students.archivedStatus
                                : parentCopy.students.active
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {/* Three actions, so all three sit behind the ⋮,
                            with Delete last after a divider and in the error
                            colour — visibly a different action from Archive,
                            which is what the two removed notes used to say
                            (UX-DR43). Every handler, confirmation, pending
                            state and announcement is the one it already had. */}
                          <RowActions
                            menuLabel={parentCopy.students.rowActionsLabel(profile.displayName)}
                            actions={[
                              {
                                key: 'rename',
                                label: parentCopy.students.rename,
                                ariaLabel: `${parentCopy.students.rename} ${profile.displayName}`,
                                icon: <Pencil size={16} aria-hidden="true" />,
                                selfEvident: true,
                                onClick: () => {
                                  setRenamingId(profile.id);
                                  setRenameDraft(profile.displayName);
                                },
                              },
                              profile.archived
                                ? {
                                    key: 'restore',
                                    label: parentCopy.students.restore,
                                    ariaLabel: `${parentCopy.students.restore} ${profile.displayName}`,
                                    icon: <ArchiveRestore size={16} aria-hidden="true" />,
                                    disabled: isPending(profile.id),
                                    onClick: () => {
                                      void write(profile.id, async () => {
                                        await parentApi.restoreStudent(token!, profile.id);
                                        return parentCopy.students.restored(profile.displayName);
                                      });
                                    },
                                  }
                                : {
                                    key: 'archive',
                                    label: parentCopy.students.archive,
                                    ariaLabel: `${parentCopy.students.archive} ${profile.displayName}`,
                                    icon: <Archive size={16} aria-hidden="true" />,
                                    disabled: isPending(profile.id),
                                    // Archiving is not deleting, and the
                                    // confirmation says exactly what it keeps.
                                    onClick: () => setConfirmingArchive(profile),
                                  },
                              {
                                key: 'delete',
                                label: parentCopy.students.delete,
                                ariaLabel: `${parentCopy.students.delete} ${profile.displayName}`,
                                icon: <Trash2 size={16} aria-hidden="true" />,
                                destructive: true,
                                disabled:
                                  isPending(profile.id) ||
                                  previewingId !== null ||
                                  confirmingDelete !== null,
                                onClick: () => {
                                  void onDeleteRequested(profile);
                                },
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Card>

          <Card>
            <CardContent
              component="form"
              aria-labelledby="student-add-heading"
              sx={{
                display: 'grid',
                gap: `${density.gap * 1.5}px`,
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1fr) auto' },
                alignItems: 'start',
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void onCreate();
              }}
            >
              <Typography
                id="student-add-heading"
                component="h2"
                variant="cardTitle"
                sx={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: `${density.gap}px`,
                }}
              >
                <UserPlus size={20} aria-hidden="true" />
                {parentCopy.students.addTitle}
              </Typography>
              <TextField
                id="student-name"
                fullWidth
                label={parentCopy.students.nameLabel}
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, displayName: event.target.value }))
                }
                size="small"
                required
                slotProps={{
                  htmlInput: policy ? { maxLength: policy.studentNameMaxLength } : undefined,
                }}
                helperText={
                  policy ? parentCopy.students.nameMaximum(policy.studentNameMaxLength) : undefined
                }
              />
              <TextField
                id="student-grade-level"
                select
                fullWidth
                required
                label={parentCopy.students.gradeLevelLabel}
                value={draft.gradeLevelId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, gradeLevelId: event.target.value }))
                }
                size="small"
                helperText={
                  gradeLevels.length === 0
                    ? parentCopy.students.noGradeLevels
                    : parentCopy.students.gradeLevelRequired
                }
              >
                {gradeLevels.map((level) => (
                  <MenuItem key={level.id} value={level.id}>
                    {level.name}
                  </MenuItem>
                ))}
              </TextField>
              {/* Both are required, so the control stays disabled until both
                  are set — the rule, not a message after the fact. */}
              <Button
                type="submit"
                variant="contained"
                disabled={creating || !canCreateStudent(draft.displayName, draft.gradeLevelId)}
                sx={{ minHeight: density.tapTarget }}
              >
                {creating ? parentCopy.students.adding : parentCopy.students.add}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* The account password, never the Parent PIN, and a body that names
            every count and kind rather than "everything saved under it". */}
      {confirmingDelete !== null && (
        <DestructiveConfirmDialog
          open
          subject={confirmingDelete.profile.displayName}
          body={parentCopy.students.deleteBody(
            confirmingDelete.profile.displayName,
            confirmingDelete.counts,
          )}
          refusal={deleteRefusal}
          busy={deleting}
          onCancel={onDeleteCancelled}
          onConfirm={(password) => {
            void onDeleteConfirmed(password);
          }}
        />
      )}

      {/* Not destructive, so no password and no red control: it says what is
            kept, and the parent confirms. */}
      {confirmingArchive !== null && (
        <AppDialog
          open
          title={parentCopy.students.archiveConfirmTitle(confirmingArchive.displayName)}
          describedBy="student-archive-confirm-body"
          onClose={() => setConfirmingArchive(null)}
          actions={
            <>
              <Button type="button" onClick={() => setConfirmingArchive(null)}>
                {parentCopy.students.archiveCancel}
              </Button>
              <PrimaryButton
                onClick={() => {
                  void onArchiveConfirmed();
                }}
              >
                {parentCopy.students.archive}
              </PrimaryButton>
            </>
          }
        >
          <Typography id="student-archive-confirm-body">
            {parentCopy.students.archiveConfirmBody(confirmingArchive.displayName)}
          </Typography>
        </AppDialog>
      )}

      {/* Client-side, so the provider holding the token stays mounted. */}
      <Link
        component={NextLink}
        href="/parent"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifySelf: 'start' }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {parentCopy.students.back}
      </Link>
    </Box>
  );
}
