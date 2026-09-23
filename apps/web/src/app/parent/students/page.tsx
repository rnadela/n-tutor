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
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import {
  ParentApiError,
  parentApi,
  type AuthPolicy,
  type StudentProfileView,
  type TaxonomyItem,
} from '@/lib/parent-api';
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
 * Whether a failure means the parent has to cross the PIN again, as opposed to
 * something transient they should be able to retry from where they stand.
 *
 * Only the elevation guard's own refusal ends Parent View. A 500, a 429, or a
 * 400 — including one from the unauthenticated policy read that loads alongside
 * the profiles — is a fault to show with a Retry, not a reason to throw away a
 * token that is still perfectly good.
 */
export function endsParentView(cause: unknown): boolean {
  return cause instanceof ParentApiError && (cause.notElevated || cause.status === 401);
}

/**
 * The staleness guard every screen in Parent View uses: a response is applied
 * only while it is still the most recent request. Without it a superseded
 * in-flight read — outlived by Retry, or by the parent leaving — could resolve
 * after the fact and overwrite fresher state.
 */
export function applyIfCurrent<T>(
  current: { readonly value: number },
  issued: number,
  apply: (value: T) => void,
): (value: T) => void {
  return (value: T) => {
    if (current.value !== issued) return;
    apply(value);
  };
}

/** What the live region holds: the sentence, and which announcement it is. */
export interface Announcement {
  text: string;
  /** Bumped per announcement, so a repeat is still a change. */
  seq: number;
}

export const NOTHING_ANNOUNCED: Announcement = { text: '', seq: 0 };

/**
 * The live region's content.
 *
 * A screen reader announces a polite region when its text *changes*, so
 * archiving, restoring and archiving again — three actions, two distinct
 * sentences — would announce only twice. Alternating an invisible zero-width
 * space makes every announcement a change, while leaving the sentence a sighted
 * reader sees, and a test asserts on, exactly as written.
 */
export function announcedText(announcement: Announcement): string {
  if (announcement.text === '') return '';
  return announcement.seq % 2 === 0 ? announcement.text : `${announcement.text}\u200B`;
}

interface Draft {
  displayName: string;
  gradeLevelId: string;
}

const EMPTY_DRAFT: Draft = { displayName: '', gradeLevelId: '' };

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

  /** One write, with the row locked, the announcement made and errors shown. */
  async function write(id: string, run: () => Promise<string>): Promise<boolean> {
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
      setError(cause instanceof Error ? cause.message : parentCopy.students.failed);
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
                              title={parentCopy.students.archiveNote}
                              aria-label={`${parentCopy.students.archive} ${profile.displayName}`}
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
                        </Box>
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

        {/* Client-side, so the provider holding the token stays mounted. */}
        <Link component={NextLink} href="/parent">
          {parentCopy.students.back}
        </Link>
      </CardContent>
    </Card>
  );
}
