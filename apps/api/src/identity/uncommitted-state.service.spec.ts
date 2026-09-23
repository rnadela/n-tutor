import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StudentProfileService } from './student-profile.service.js';
import { SLOT_WRITE_MAX_ATTEMPTS, UncommittedStateService } from './uncommitted-state.service.js';

const PROFILE_ID = '11111111-2222-3333-4444-555555555555';
const ACCOUNT_ID = '99999999-8888-7777-6666-555555555555';

const ROW = {
  id: 'row-1',
  studentProfileId: PROFILE_ID,
  kind: 'DraftEdit' as const,
  scope: '',
  payload: { a: 1 },
  createdAt: new Date('2026-09-24T10:00:00.000Z'),
  updatedAt: new Date('2026-09-24T10:00:00.000Z'),
  expiresAt: new Date('2026-09-27T10:00:00.000Z'),
};

/**
 * A Prisma stand-in whose sweep fails and whose slot write succeeds.
 *
 * `save()` deliberately swallows a sweep failure — the write is what the parent
 * asked for, the sweep is housekeeping — and that decision is unreachable from
 * the integration suite, where the real database's `deleteMany` does not fail on
 * demand. So it is pinned here, against a stub, rather than left as a `.catch`
 * whose removal breaks nothing.
 */
function prismaWithFailingSweep(): {
  prisma: PrismaService;
  sweepAttempts: () => number;
} {
  let sweeps = 0;
  const delegate = {
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ROW),
    delete: vi.fn(async () => ROW),
    findMany: vi.fn(async () => {
      // The sweep's own select. Failing here is the same fault as failing the
      // delete, and is the one the service must survive.
      sweeps += 1;
      throw new Error('the sweep could not read');
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  };
  const prisma = {
    uncommittedState: delegate,
    withTransaction: <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({ uncommittedState: delegate } as unknown),
  } as unknown as PrismaService;
  return { prisma, sweepAttempts: () => sweeps };
}

function studentsFinding(profileId: string | null): StudentProfileService {
  return {
    findSelectable: vi.fn(async () => (profileId === null ? null : { id: profileId })),
  } as unknown as StudentProfileService;
}

describe('save when the opportunistic sweep fails', () => {
  it('still returns the view the parent’s write produced', async () => {
    const { prisma, sweepAttempts } = prismaWithFailingSweep();
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    const view = await service.save(ACCOUNT_ID, {
      studentProfileId: PROFILE_ID,
      kind: 'DraftEdit',
      scope: '',
      payload: { a: 1 },
    });

    // The sweep was attempted and did fail...
    expect(sweepAttempts()).toBe(1);
    // ...and the parent's work was still saved and handed back.
    expect(view).toMatchObject({
      id: ROW.id,
      studentProfileId: PROFILE_ID,
      payload: { a: 1 },
      createdAt: ROW.createdAt.toISOString(),
      expiresAt: ROW.expiresAt.toISOString(),
    });
  });

  it('lets a sweep called on its own fail loudly, so a scheduler would see it', async () => {
    const { prisma } = prismaWithFailingSweep();
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));
    // Only `save` swallows it. A worker calling the sweep directly must be told.
    await expect(service.sweepExpired(new Date())).rejects.toThrow('the sweep could not read');
  });
});

describe('save when another save wins the slot', () => {
  /**
   * The losing half of the create/create race, driven deterministically.
   *
   * The integration suite fires two real saves at once, but whether they
   * actually collide is up to the database's timing — so the branch that turns
   * the collision into a retry is pinned here, where the violation is certain.
   */
  function prismaLosingTheFirstCreate(): { prisma: PrismaService; upserts: () => number } {
    let upserts = 0;
    const delegate = {
      findUnique: vi.fn(async () => null),
      delete: vi.fn(async () => ROW),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => {
        upserts += 1;
        if (upserts === 1) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        return ROW;
      }),
    };
    const prisma = {
      uncommittedState: delegate,
      withTransaction: <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({ uncommittedState: delegate } as unknown),
    } as unknown as PrismaService;
    return { prisma, upserts: () => upserts };
  }

  it('retries the write instead of turning the collision into a 500', async () => {
    const { prisma, upserts } = prismaLosingTheFirstCreate();
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    const view = await service.save(ACCOUNT_ID, {
      studentProfileId: PROFILE_ID,
      kind: 'DraftEdit',
      scope: '',
      payload: { a: 1 },
    });

    expect(upserts()).toBe(2);
    expect(view.id).toBe(ROW.id);
  });

  it('still surfaces a fault that is not a slot collision', async () => {
    const delegate = {
      findUnique: vi.fn(async () => null),
      delete: vi.fn(async () => ROW),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => {
        throw new Error('the database is on fire');
      }),
    };
    const prisma = {
      uncommittedState: delegate,
      withTransaction: <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({ uncommittedState: delegate } as unknown),
    } as unknown as PrismaService;
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    // The retry is for one specific, expected collision — it must not swallow
    // everything else a write can fail with.
    await expect(
      service.save(ACCOUNT_ID, {
        studentProfileId: PROFILE_ID,
        kind: 'DraftEdit',
        scope: '',
        payload: { a: 1 },
      }),
    ).rejects.toThrow('the database is on fire');
    expect(delegate.upsert).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of collisions rather than retrying forever', async () => {
    // Every attempt loses the race: a three-or-more-way collision that never
    // resolves within the bound must still fail loudly instead of looping.
    const delegate = {
      findUnique: vi.fn(async () => null),
      delete: vi.fn(async () => ROW),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }),
    };
    const prisma = {
      uncommittedState: delegate,
      withTransaction: <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({ uncommittedState: delegate } as unknown),
    } as unknown as PrismaService;
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    await expect(
      service.save(ACCOUNT_ID, {
        studentProfileId: PROFILE_ID,
        kind: 'DraftEdit',
        scope: '',
        payload: { a: 1 },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
    expect(delegate.upsert).toHaveBeenCalledTimes(SLOT_WRITE_MAX_ATTEMPTS);
  });
});

describe('save when the profile is removed between the check and the write', () => {
  it('answers 404 rather than surfacing the foreign-key violation', async () => {
    const delegate = {
      findUnique: vi.fn(async () => null),
      delete: vi.fn(async () => ROW),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => {
        throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
          code: 'P2003',
          clientVersion: 'test',
        });
      }),
    };
    const prisma = {
      uncommittedState: delegate,
      withTransaction: <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({ uncommittedState: delegate } as unknown),
    } as unknown as PrismaService;
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    await expect(
      service.save(ACCOUNT_ID, {
        studentProfileId: PROFILE_ID,
        kind: 'DraftEdit',
        scope: '',
        payload: { a: 1 },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Not retried: a removed profile is not a slot collision.
    expect(delegate.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('the sweep', () => {
  it('deletes only the batch it selected, never an unqualified sweep', async () => {
    const ids = Array.from({ length: 5 }, (_, index) => ({ id: `dead-${index}` }));
    const findMany = vi.fn(async (_args: unknown) => ids);
    const deleteMany = vi.fn(async (_args: unknown) => ({ count: ids.length }));
    const prisma = {
      uncommittedState: { findMany, deleteMany },
    } as unknown as PrismaService;
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    const now = new Date();
    expect(await service.sweepExpired(now, 5)).toBe(5);

    // The select is capped...
    expect(findMany.mock.calls[0]![0]).toMatchObject({ take: 5 });
    // ...and the delete names those ids, so a parent's save never pays for more
    // than one batch of the whole system's backlog.
    expect(deleteMany.mock.calls[0]![0]).toMatchObject({
      where: { id: { in: ids.map((row) => row.id) } },
    });
  });

  it('does not issue a delete at all when nothing is expired', async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const prisma = {
      uncommittedState: { findMany: vi.fn(async () => []), deleteMany },
    } as unknown as PrismaService;
    const service = new UncommittedStateService(prisma, studentsFinding(PROFILE_ID));

    expect(await service.sweepExpired(new Date())).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
