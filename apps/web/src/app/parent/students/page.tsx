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
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DestructiveConfirmDialog } from '@/components/Dialog';
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
 * The ids the row's two notes carry, and the ids its two controls point their
 * `aria-describedby` at. One function so the two sides cannot drift: a
 * `describedby` naming an id nothing renders is silently no description at all.
 */
export const archiveNoteId = (profileId: string) => `student-archive-note-${profileId}`;
export const deleteNoteId = (profileId: string) => `student-delete-note-${profileId}`;

/**
 * The sentences that say which of the row's two destructive-looking controls
 * keeps the child's history.
 *
 * Rendered as text rather than hidden in a `title`: a tooltip does not exist on
 * touch at all, and both controls carry an `aria-label` that would override a
 * `title` for a screen reader — so the one thing telling Archive and Delete
 * apart would be unreachable to exactly the people most likely to confuse them.
 * The story requires the surface to say which is which, so the surface says it.
 *
 * Its own component so that requirement is assertable without standing up the
 * whole screen, its router and its elevation.
 */
export function StudentRowNotes({ profileId, archived }: { profileId: string; archived: boolean }) {
  return (
    <Box sx={{ display: 'grid', gap: `${density.gap / 2}px`, mt: 1 }}>
      {/* Only while archiving is the action on offer: a restored-from-archive
          row's control is Restore, and its own note describes that. */}
      {!archived && (
        <Typography
          id={archiveNoteId(profileId)}
          component="p"
          sx={{ fontSize: 13, color: 'text.secondary' }}
        >
          {parentCopy.students.archiveNote}
        </Typography>
      )}
      <Typography
        id={deleteNoteId(profileId)}
        component="p"
        sx={{ fontSize: 13, color: 'text.secondary' }}
      >
        {parentCopy.students.deleteNote}
      </Typography>
    </Box>
  );
}

/** The Students screen: create, rename, change grade level, archive, restore. */
export default function StudentsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [gradeLevels, setGradeLevels] = useState<TaxonomyItem[]>([]);
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(NOTHING_ANNOUNCED);
  /** Every announcement is a change, repeats included. */
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => ({ text, seq: previous.seq + 1 })),
    [],
  );

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
        setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
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
    showRefusal: (text: string) => void = setError,
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
      setError(refusalText(cause, parentCopy.students.deleteFailed));
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
      setError(cause instanceof Error ? cause.message : parentCopy.students.failed);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card component="section" sx={{ maxWidth: 840, mx: 'auto' }}>
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {parentCopy.students.title}
        </Typography>
        <Typography>{parentCopy.students.intro}</Typography>

        {/* Every change is announced with the same words the screen shows. */}
        <Box role="status" aria-live="polite" sx={{ minHeight: 0 }}>
          {announcedText(announcement)}
        </Box>

        {error !== null && (
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <Alert severity="info" role="status" variant="outlined">
            {parentCopy.students.loading}
          </Alert>
        ) : (
          <>
            {profiles.length === 0 ? (
              <Typography component="p" sx={{ color: 'text.secondary' }}>
                {parentCopy.students.empty}
              </Typography>
            ) : (
              <Table size="small" aria-label={parentCopy.students.title}>
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
                          profile.displayName
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
                          {/* The stored grade level's current name, always —
                              including when it is no longer offered. */}
                          <Typography component="span">{profile.gradeLevelName}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {profile.archived
                          ? parentCopy.students.archivedStatus
                          : parentCopy.students.active}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: `${density.gap}px`, flexWrap: 'wrap' }}>
                          <Button
                            type="button"
                            onClick={() => {
                              setRenamingId(profile.id);
                              setRenameDraft(profile.displayName);
                            }}
                            aria-label={`${parentCopy.students.rename} ${profile.displayName}`}
                            sx={{ minHeight: density.tapTarget }}
                          >
                            {parentCopy.students.rename}
                          </Button>
                          {profile.archived ? (
                            <Button
                              type="button"
                              disabled={isPending(profile.id)}
                              title={parentCopy.students.restoreNote}
                              aria-label={`${parentCopy.students.restore} ${profile.displayName}`}
                              sx={{ minHeight: density.tapTarget }}
                              onClick={() =>
                                write(profile.id, async () => {
                                  await parentApi.restoreStudent(token!, profile.id);
                                  return parentCopy.students.restored(profile.displayName);
                                })
                              }
                            >
                              {parentCopy.students.restore}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              disabled={isPending(profile.id)}
                              aria-label={`${parentCopy.students.archive} ${profile.displayName}`}
                              aria-describedby={archiveNoteId(profile.id)}
                              sx={{ minHeight: density.tapTarget }}
                              onClick={() => {
                                // Archiving is not deleting, and the
                                // confirmation says exactly what it keeps.
                                if (
                                  !window.confirm(
                                    parentCopy.students.archiveConfirm(profile.displayName),
                                  )
                                ) {
                                  return;
                                }
                                void write(profile.id, async () => {
                                  await parentApi.archiveStudent(token!, profile.id);
                                  return parentCopy.students.archived(profile.displayName);
                                });
                              }}
                            >
                              {parentCopy.students.archive}
                            </Button>
                          )}
                          {/* Beside archiving, and visibly a different action:
                              its own label, its own note saying what it does
                              *not* keep, and a password-gated confirmation
                              rather than a browser prompt. */}
                          <Button
                            type="button"
                            color="error"
                            disabled={
                              isPending(profile.id) ||
                              previewingId !== null ||
                              confirmingDelete !== null
                            }
                            aria-label={`${parentCopy.students.delete} ${profile.displayName}`}
                            aria-describedby={deleteNoteId(profile.id)}
                            sx={{ minHeight: density.tapTarget }}
                            onClick={() => {
                              void onDeleteRequested(profile);
                            }}
                          >
                            {parentCopy.students.delete}
                          </Button>
                        </Box>
                        <StudentRowNotes profileId={profile.id} archived={profile.archived} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Box
              component="form"
              aria-labelledby="student-add-heading"
              sx={{ display: 'grid', gap: `${density.gap}px` }}
              onSubmit={(event) => {
                event.preventDefault();
                void onCreate();
              }}
            >
              <Typography
                id="student-add-heading"
                component="h2"
                sx={{ fontSize: 18, fontWeight: 700 }}
              >
                {parentCopy.students.addTitle}
              </Typography>
              <TextField
                id="student-name"
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
            </Box>
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

        {/* Client-side, so the provider holding the token stays mounted. */}
        <Link component={NextLink} href="/parent">
          {parentCopy.students.back}
        </Link>
      </CardContent>
    </Card>
  );
}
