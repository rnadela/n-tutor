import { describe, expect, it, vi } from 'vitest';
import type { AiService } from '../ai/ai.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SourceTestReader } from '../sourcetest/source-test-reader.js';
import { ExtractionService } from './extraction.service.js';

/**
 * The existence read Epic 8's early deletion gates on, and nothing else in this
 * file.
 *
 * A stubbed delegate rather than Postgres: what is under test is *which*
 * question is asked and how cheaply — a boolean, from one row, by its own
 * unique key — and a database would state neither more precisely.
 */
function harness(extraction: { id: string } | null) {
  const findUnique = vi.fn(async () => extraction);
  const prisma = { extraction: { findUnique } } as unknown as PrismaService;
  const service = new ExtractionService(
    prisma,
    {} as unknown as AiService,
    {} as unknown as SourceTestReader,
  );
  return { service, findUnique };
}

describe('whether a Source Test Extraction has actually been stored', () => {
  it('says yes once there is a row', async () => {
    const h = harness({ id: 'ex-1' });
    expect(await h.service.hasPersistedExtraction('st-1')).toBe(true);
  });

  it('says no while the job is still queued, running or failed', async () => {
    // All three states share one fact — nothing has been stored — and that fact
    // is the whole of the answer. A gate that distinguished them would be
    // guessing at a job status this read never sees.
    const h = harness(null);
    expect(await h.service.hasPersistedExtraction('st-1')).toBe(false);
  });

  it('asks by the Source Test own key and selects the id alone', async () => {
    // Not `readForGeneration`, which loads every question, every choice and
    // every topic to answer a yes/no in front of a waiting parent.
    const h = harness({ id: 'ex-1' });
    await h.service.hasPersistedExtraction('st-1');
    expect(h.findUnique).toHaveBeenCalledTimes(1);
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { sourceTestId: 'st-1' },
      select: { id: true },
    });
  });
});
