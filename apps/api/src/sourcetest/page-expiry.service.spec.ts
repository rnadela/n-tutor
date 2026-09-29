import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PageIngestService } from './page-ingest.service.js';
import { PageExpiryService } from './page-expiry.service.js';
import { PAGE_EXPIRY_SWEEP_BATCH_SIZE, PAGE_IMAGE_RETENTION_MS } from './source-test-policy.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

interface Recorded {
  findArgs: unknown;
  updateArgs: unknown;
}

/**
 * The delegate and the unlinker, stubbed to exactly what the sweep uses.
 *
 * A fake rather than Postgres because what is under test here is the *order* of
 * two effects and what happens when the first one fails — neither of which a
 * database is needed to state, and both of which a database would make slower
 * to state. The integration spec asserts the same matrix against real rows and
 * real files.
 */
function harness(options: {
  due: string[];
  removable?: (pageId: string) => boolean;
  markedCount?: number;
}) {
  const removable = options.removable ?? (() => true);
  const recorded: Recorded = { findArgs: null, updateArgs: null };
  const order: string[] = [];

  const findMany = vi.fn(async (args: unknown) => {
    recorded.findArgs = args;
    order.push('find');
    return options.due.map((id) => ({ id }));
  });
  const updateMany = vi.fn(async (args: unknown) => {
    recorded.updateArgs = args;
    order.push('update');
    return {
      count:
        options.markedCount ?? (args as { where: { id: { in: string[] } } }).where.id.in.length,
    };
  });
  const remove = vi.fn(async (pageId: string) => {
    order.push(`remove:${pageId}`);
    return removable(pageId);
  });

  const prisma = { pageImage: { findMany, updateMany } } as unknown as PrismaService;
  const ingest = { remove } as unknown as PageIngestService;
  return {
    service: new PageExpiryService(prisma, ingest),
    findMany,
    updateMany,
    remove,
    recorded,
    order,
  };
}

describe('what one retention sweep selects', () => {
  it('takes only Ready rows whose Source Test was submitted before the cutoff', () => {
    const h = harness({ due: [] });
    return h.service.sweepExpired(NOW).then(() => {
      expect(h.recorded.findArgs).toMatchObject({
        where: {
          state: 'Ready',
          sourceTest: { submittedAt: { lte: new Date(NOW.getTime() - PAGE_IMAGE_RETENTION_MS) } },
        },
      });
    });
  });

  it('never selects a row that is already Deleted, so nothing is unlinked twice', async () => {
    // The state filter is the whole of it: a swept row has no bytes left to
    // remove and a second `remove()` on it would be a warning about a file the
    // sweep itself deleted.
    const h = harness({ due: [] });
    await h.service.sweepExpired(NOW);
    expect((h.recorded.findArgs as { where: { state: string } }).where.state).toBe('Ready');
  });

  it('never selects a never-submitted draft: a null is not <= any cutoff', async () => {
    const h = harness({ due: [] });
    await h.service.sweepExpired(NOW);
    const where = h.recorded.findArgs as { where: { sourceTest: { submittedAt: unknown } } };
    // Stated as a comparison rather than as an explicit `not: null`, because a
    // comparison is what excludes the draft — and a reader changing this to an
    // `OR` that admits nulls would be handing the draft a 90-day life.
    expect(where.where.sourceTest.submittedAt).toEqual({
      lte: new Date(NOW.getTime() - PAGE_IMAGE_RETENTION_MS),
    });
  });

  it('caps the pass at the batch size rather than at the size of the backlog', async () => {
    const h = harness({ due: [] });
    await h.service.sweepExpired(NOW);
    expect((h.recorded.findArgs as { take: number }).take).toBe(PAGE_EXPIRY_SWEEP_BATCH_SIZE);
  });

  it('does not issue an update at all when nothing is due', async () => {
    const h = harness({ due: [] });
    expect(await h.service.sweepExpired(NOW)).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
});

describe('bytes first, then the row', () => {
  it('unlinks every due page before it marks any row', async () => {
    const h = harness({ due: ['a', 'b'] });
    await h.service.sweepExpired(NOW);
    // The order is the whole crash-safety argument: a crash after the unlinks
    // and before the update leaves a `Ready` row whose file is gone, which the
    // next pass re-selects and converges. The other order leaves bytes that no
    // row points at and no clock will ever reach again.
    expect(h.order).toEqual(['find', 'remove:a', 'remove:b', 'update']);
  });

  it('marks the rows Deleted with the date and drops the path', async () => {
    const h = harness({ due: ['a'] });
    expect(await h.service.sweepExpired(NOW)).toBe(1);
    expect(h.recorded.updateArgs).toEqual({
      where: { id: { in: ['a'] }, state: 'Ready' },
      data: { state: 'Deleted', bytesDeletedAt: NOW, storagePath: null },
    });
  });

  it('treats bytes that were already missing as removed', async () => {
    // `remove()` answers true for ENOENT, and this is what that answer buys:
    // the row converges instead of being retried for ever over a file that is
    // never coming back.
    const h = harness({ due: ['a'], removable: () => true });
    expect(await h.service.sweepExpired(NOW)).toBe(1);
  });
});

describe('a page whose bytes would not go away', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the shortfall once per pass, so a page stuck for a week is visible', async () => {
    // `remove()` warns per page and the returned count reports only what was
    // marked, so without this line a page whose unlink keeps failing is
    // re-selected every pass, stays `Ready` for ever, and the retention promise
    // is quietly broken with nothing saying so.
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    const h = harness({ due: ['kept', 'gone'], removable: (id) => id === 'gone' });

    await h.service.sweepExpired(NOW);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 of 2');
    // Counts, never a path (AD-15, AD-20).
    expect(warnings[0]).not.toContain('/');
  });

  it('says nothing about a shortfall when there is none', async () => {
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    const h = harness({ due: ['a', 'b'] });

    await h.service.sweepExpired(NOW);
    expect(warnings).toEqual([]);
  });

  it('leaves that row Ready and marks only the ones that came away', async () => {
    const h = harness({ due: ['kept', 'gone'], removable: (id) => id === 'gone' });
    expect(await h.service.sweepExpired(NOW)).toBe(1);
    expect(h.recorded.updateArgs).toMatchObject({ where: { id: { in: ['gone'] } } });
  });

  it('marks nothing and throws nothing when no page could be unlinked', async () => {
    // Never throwing is the rule: the pass is housekeeping on a schedule, and a
    // throw here would be a failed job retried against a disk that is still
    // full. The row stays `Ready` and the next pass tries again.
    const h = harness({ due: ['a', 'b'], removable: () => false });
    expect(await h.service.sweepExpired(NOW)).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('reports what the update actually marked, not what it hoped to', async () => {
    // A row another pass swept between the select and the update is matched by
    // neither `state: 'Ready'` nor the count, so the figure the sweep returns is
    // the number of pages this pass is responsible for.
    const h = harness({ due: ['a', 'b'], markedCount: 1 });
    expect(await h.service.sweepExpired(NOW)).toBe(1);
  });
});

describe('what the sweep is not allowed to touch', () => {
  it('reads and writes the page_image delegate and nothing else', async () => {
    // The Source Test, its Extraction, and every Practice Test, Attempt,
    // Explanation and Mastery value built on it survive an expiry untouched.
    // The strongest form of that assertion available without a database is that
    // no other delegate exists on the client this service was handed: any reach
    // for one is a TypeError, not a silently passing test.
    const h = harness({ due: ['a'] });
    await h.service.sweepExpired(NOW);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('the parent-requested early deletion', () => {
  it('selects that Source Test own Ready pages, with no cutoff and no cap', async () => {
    // No clock in the `where` at all: the parent asking *is* the trigger, and a
    // cutoff here would silently refuse the deletion for the first ninety days
    // — exactly the window FR-33 exists to shorten.
    const h = harness({ due: [] });
    await h.service.expireNow('st-1', NOW);
    expect(h.recorded.findArgs).toEqual({
      where: { sourceTestId: 'st-1', state: 'Ready' },
      select: { id: true },
    });
  });

  it('never widens past its own Source Test', async () => {
    // The one scoping mistake that would empty another child's upload: the
    // `sourceTestId` is the whole of the selection and is asserted as such.
    const h = harness({ due: ['a'] });
    await h.service.expireNow('st-1', NOW);
    const where = (h.recorded.findArgs as { where: Record<string, unknown> }).where;
    expect(where.sourceTestId).toBe('st-1');
    expect(Object.keys(where).sort()).toEqual(['sourceTestId', 'state']);
  });

  it('unlinks every page before it marks any row, exactly as the sweep does', async () => {
    const h = harness({ due: ['a', 'b'] });
    expect(await h.service.expireNow('st-1', NOW)).toBe(2);
    expect(h.order).toEqual(['find', 'remove:a', 'remove:b', 'update']);
  });

  it('marks the rows Deleted with the date, drops the path, and keeps the Ready guard', async () => {
    // Asserted whole rather than loosely: `state: 'Ready'` in the update's own
    // `where` is what stops a row another pass swept between the select and here
    // from being re-dated, and a partial match would not notice its loss.
    const h = harness({ due: ['a'] });
    await h.service.expireNow('st-1', NOW);
    expect(h.recorded.updateArgs).toEqual({
      where: { id: { in: ['a'] }, state: 'Ready' },
      data: { state: 'Deleted', bytesDeletedAt: NOW, storagePath: null },
    });
  });

  it('is a no-op on a Source Test whose pages are already Deleted', async () => {
    // `state: 'Ready'` in the select is what makes the route idempotent: a
    // second confirm removes nothing, re-dates nothing and still succeeds.
    const h = harness({ due: [] });
    expect(await h.service.expireNow('st-1', NOW)).toBe(0);
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('leaves a page whose unlink failed Ready for the sweep, and marks the rest', async () => {
    const h = harness({ due: ['kept', 'gone'], removable: (id) => id === 'gone' });
    expect(await h.service.expireNow('st-1', NOW)).toBe(1);
    expect(h.recorded.updateArgs).toMatchObject({ where: { id: { in: ['gone'] } } });
  });

  it('throws nothing when not one page could be unlinked', async () => {
    const h = harness({ due: ['a'], removable: () => false });
    expect(await h.service.expireNow('st-1', NOW)).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('reads and writes the page_image delegate and nothing else', async () => {
    const h = harness({ due: ['a'] });
    await h.service.expireNow('st-1', NOW);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('which trigger a log line came from', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureLogs(): { logs: string[]; warnings: string[] } {
    const logs: string[] = [];
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    return { logs, warnings };
  }

  it('names the schedule when the schedule asked', async () => {
    const captured = captureLogs();
    await harness({ due: ['a'] }).service.sweepExpired(NOW);
    expect(captured.logs[0]).toContain('Retention sweep');
  });

  it('names the parent request when a parent asked', async () => {
    // Without this the two emit the identical sentence, and an operator reading
    // a disk that refused a page cannot tell a nightly job from a parent waiting
    // in front of a screen.
    const captured = captureLogs();
    await harness({ due: ['a'] }).service.expireNow('st-1', NOW);
    expect(captured.logs[0]).toContain('Parent-requested deletion');
    expect(captured.logs[0]).not.toContain('Retention sweep');
  });

  it('names the trigger on the shortfall warning too, and still carries no path', async () => {
    const captured = captureLogs();
    await harness({ due: ['kept', 'gone'], removable: (id) => id === 'gone' }).service.expireNow(
      'st-1',
      NOW,
    );
    expect(captured.warnings).toHaveLength(1);
    expect(captured.warnings[0]).toContain('Parent-requested deletion');
    expect(captured.warnings[0]).toContain('1 of 2');
    expect(captured.warnings[0]).not.toContain('/');
  });
});
