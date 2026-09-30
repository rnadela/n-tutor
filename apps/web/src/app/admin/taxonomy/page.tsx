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
  type TaxonomyItem,
  type TaxonomySnapshot,
} from '@/lib/admin-api';
import { density } from '@/theme/tokens';
import { AvailabilityMatrix } from '../_components/AvailabilityMatrix';
import { TaxonomyList } from '../_components/TaxonomyList';

export default function TaxonomyPage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<TaxonomySnapshot | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSnapshot(await adminApi.loadTaxonomy());
  }, []);

  const load = useCallback(() => {
    if (!readToken()) {
      router.replace('/admin/login');
      return;
    }
    setError(null);
    reload().catch((cause: unknown) => {
      if (cause instanceof AdminApiError && cause.status === 401) {
        // A 401 means the stored token is no longer good; clearing it first
        // stops the login page's already-signed-in check from bouncing
        // straight back here (readToken() would still see the stale token).
        clearToken();
        router.replace('/admin/login');
        return;
      }
      setError(adminCopy.errors.generic);
    });
  }, [reload, router]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Runs one write. Resolves `true` only when it succeeded, so callers keep the
   * operator's typed input on failure. The snapshot is reloaded either way, so a
   * control whose checked state is derived from it can never be left
   * disagreeing with the server.
   */
  const run = useCallback(
    async (action: () => Promise<string>): Promise<boolean> => {
      setError(null);
      try {
        const message = await action();
        await reload();
        setAnnouncement(message);
        return true;
      } catch (cause: unknown) {
        if (cause instanceof AdminApiError && cause.status === 401) {
          clearToken();
          router.replace('/admin/login');
          return false;
        }
        setError(cause instanceof AdminApiError ? cause.message : adminCopy.errors.generic);
        await reload().catch((reloadCause: unknown) => {
          if (reloadCause instanceof AdminApiError && reloadCause.status === 401) {
            clearToken();
            router.replace('/admin/login');
          }
        });
        return false;
      }
    },
    [reload, router],
  );

  if (!snapshot) {
    return error ? (
      <Box sx={{ display: 'grid', gap: `${density.gap}px`, justifyItems: 'start' }}>
        <Alert severity="error" role="alert" variant="outlined">
          {error}
        </Alert>
        <Button type="button" variant="contained" onClick={load}>
          {adminCopy.taxonomy.retry}
        </Button>
      </Box>
    ) : (
      <Typography component="p" role="status">
        {adminCopy.taxonomy.loading}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: `${density.sectionMargin}px` }}>
      <Box>
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 700 }}>
          {adminCopy.taxonomy.title}
        </Typography>
        <Typography component="p" sx={{ color: 'text.secondary' }}>
          {adminCopy.taxonomy.intro}
        </Typography>
      </Box>

      {/* Every change is announced here. */}
      <Box aria-live="polite" role="status" sx={{ minHeight: density.gap * 2 }}>
        <Typography component="span">{announcement}</Typography>
      </Box>

      {error && (
        <Alert severity="error" role="alert" variant="outlined">
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: `${density.sectionMargin}px`,
          alignItems: 'start',
        }}
      >
        <TaxonomyList
          heading={adminCopy.taxonomy.subjectsHeading}
          idPrefix="subjects"
          newItemLabel={adminCopy.taxonomy.newSubjectLabel}
          addLabel={adminCopy.taxonomy.addSubject}
          emptyLabel={adminCopy.taxonomy.emptySubjects}
          items={snapshot.subjects}
          onCreate={(name) =>
            run(async () => {
              const created = await adminApi.createSubject(name);
              return adminCopy.announce.subjectCreated(created.name);
            })
          }
          onRename={(item: TaxonomyItem, name) =>
            run(async () => {
              const renamed = await adminApi.renameSubject(item.id, name);
              return adminCopy.announce.subjectRenamed(item.name, renamed.name);
            })
          }
          onSetEnabled={(item: TaxonomyItem, enabled) =>
            run(async () => {
              await adminApi.setSubjectEnabled(item.id, enabled);
              return enabled
                ? adminCopy.announce.subjectEnabled(item.name)
                : adminCopy.announce.subjectDisabled(item.name);
            })
          }
        />

        <TaxonomyList
          heading={adminCopy.taxonomy.gradeLevelsHeading}
          idPrefix="grade-levels"
          newItemLabel={adminCopy.taxonomy.newGradeLevelLabel}
          addLabel={adminCopy.taxonomy.addGradeLevel}
          emptyLabel={adminCopy.taxonomy.emptyGradeLevels}
          items={snapshot.gradeLevels}
          onCreate={(name) =>
            run(async () => {
              const created = await adminApi.createGradeLevel(name);
              return adminCopy.announce.gradeLevelCreated(created.name);
            })
          }
          onRename={(item: TaxonomyItem, name) =>
            run(async () => {
              const renamed = await adminApi.renameGradeLevel(item.id, name);
              return adminCopy.announce.gradeLevelRenamed(item.name, renamed.name);
            })
          }
          onSetEnabled={(item: TaxonomyItem, enabled) =>
            run(async () => {
              await adminApi.setGradeLevelEnabled(item.id, enabled);
              return enabled
                ? adminCopy.announce.gradeLevelEnabled(item.name)
                : adminCopy.announce.gradeLevelDisabled(item.name);
            })
          }
        />
      </Box>

      <AvailabilityMatrix
        subjects={snapshot.subjects}
        gradeLevels={snapshot.gradeLevels}
        availability={snapshot.availability}
        onToggle={(subject, gradeLevel, enabled) =>
          run(async () => {
            await adminApi.setAvailability(subject.id, gradeLevel.id, enabled);
            return enabled
              ? adminCopy.announce.availabilityEnabled(subject.name, gradeLevel.name)
              : adminCopy.announce.availabilityDisabled(subject.name, gradeLevel.name);
          })
        }
      />
    </Box>
  );
}
