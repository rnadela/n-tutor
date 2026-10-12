import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBJECTS,
  isEntryPointFor,
  MIN_SEED_PASSWORD_LENGTH,
  PH_DEFAULT_SUBJECT_MAPPING,
  PH_GRADE_LEVELS,
  requireSeedPassword,
  runSeed,
  seedDefaultSubjects,
  seedGradeLevels,
  seedOperator,
} from '../prisma/seed.js';
import { createHarness, resetTaxonomy, type Harness } from './harness.js';

describe('seedOperator', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('never rewrites an existing operator password on re-run', async () => {
    const email = `seed-create-only-${Date.now()}@example.test`;
    const originalPassword = 'first-password-123';
    const rotatedPassword = 'rotated-password-456';

    const first = await seedOperator(h.prisma, email, originalPassword);
    expect(first.adminUserCount).toBeGreaterThan(0);

    const created = await h.prisma.adminUser.findUniqueOrThrow({ where: { email } });
    const originalHash = created.passwordHash;

    // Simulate an operator rotating their password by hand, then the seed
    // running again on the next boot with the old (now stale) env value.
    const rotatedHash = await argon2.hash(rotatedPassword, { type: argon2.argon2id });
    await h.prisma.adminUser.update({ where: { email }, data: { passwordHash: rotatedHash } });

    await seedOperator(h.prisma, email, originalPassword);

    const afterRerun = await h.prisma.adminUser.findUniqueOrThrow({ where: { email } });
    expect(afterRerun.passwordHash).toBe(rotatedHash);
    expect(afterRerun.passwordHash).not.toBe(originalHash);
  });

  it('rejects a missing password', () => {
    expect(() => requireSeedPassword('ADMIN_SEED_PASSWORD_TEST_MISSING')).toThrow(
      'Missing required environment variable',
    );
  });

  it('accepts the documented dev/test default password', () => {
    process.env.ADMIN_SEED_PASSWORD_TEST_DEFAULT = 'change-me-too';
    try {
      expect(requireSeedPassword('ADMIN_SEED_PASSWORD_TEST_DEFAULT')).toBe('change-me-too');
    } finally {
      delete process.env.ADMIN_SEED_PASSWORD_TEST_DEFAULT;
    }
  });

  it('rejects a password shorter than the minimum length', () => {
    process.env.ADMIN_SEED_PASSWORD_TEST_SHORT = 'a'.repeat(MIN_SEED_PASSWORD_LENGTH - 1);
    try {
      expect(() => requireSeedPassword('ADMIN_SEED_PASSWORD_TEST_SHORT')).toThrow(
        'must be at least',
      );
    } finally {
      delete process.env.ADMIN_SEED_PASSWORD_TEST_SHORT;
    }
  });
});

describe('seedGradeLevels', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('lists Kindergarten and Grades 1 to 12', () => {
    expect(PH_GRADE_LEVELS).toHaveLength(13);
    expect(PH_GRADE_LEVELS[0]).toBe('Kindergarten');
    expect(PH_GRADE_LEVELS.at(-1)).toBe('Grade 12');
  });

  it('creates missing levels once and never re-enables a withdrawn one', async () => {
    const tag = Date.now();
    const names = [`Seed Level A ${tag}`, `Seed Level B ${tag}`];

    expect(await seedGradeLevels(h.prisma, names)).toBe(2);

    const key = names[0]!.toLowerCase();
    await h.prisma.gradeLevel.update({ where: { nameKey: key }, data: { enabled: false } });

    expect(await seedGradeLevels(h.prisma, names)).toBe(0);
    const withdrawn = await h.prisma.gradeLevel.findUniqueOrThrow({ where: { nameKey: key } });
    expect(withdrawn.enabled).toBe(false);
  });
});

/** Links the mapping implies, optionally ignoring a subject or a grade level. */
function expectedLinkCount(options: { withoutSubject?: string; withoutGradeLevel?: string } = {}) {
  return PH_DEFAULT_SUBJECT_MAPPING.reduce((total, row) => {
    const gradeLevels = row.gradeLevels.filter((name) => name !== options.withoutGradeLevel);
    const subjects = row.subjects.filter((name) => name !== options.withoutSubject);
    return total + gradeLevels.length * subjects.length;
  }, 0);
}

describe('seedDefaultSubjects', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  // Every test starts from an empty taxonomy with the standard grade levels in
  // place, which is what the mapping resolves against. `vitest.config.ts` sets
  // `fileParallelism: false`, so truncating here cannot race another file.
  beforeEach(async () => {
    await resetTaxonomy(h.prisma);
    await seedGradeLevels(h.prisma);
  });

  it('transcribes the approved mapping over the approved subject set', () => {
    expect(DEFAULT_SUBJECTS).toHaveLength(12);
    const seedKeys = DEFAULT_SUBJECTS.map((subject) => subject.seedKey);
    expect(new Set(seedKeys).size).toBe(seedKeys.length);
    const names = DEFAULT_SUBJECTS.map((subject) => subject.name);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    const mapped = new Set(PH_DEFAULT_SUBJECT_MAPPING.flatMap((row) => row.subjects));
    expect([...mapped].sort()).toEqual([...names].sort());
    // A set over the flattened rows cannot see a repeat *inside* one row, and a
    // repeated grade level across rows would double-count its links.
    const allGradeLevels: string[] = [];
    for (const row of PH_DEFAULT_SUBJECT_MAPPING) {
      expect(new Set(row.subjects).size).toBe(row.subjects.length);
      expect(new Set(row.gradeLevels).size).toBe(row.gradeLevels.length);
      allGradeLevels.push(...row.gradeLevels);
    }
    expect(new Set(allGradeLevels).size).toBe(allGradeLevels.length);
    expect(expectedLinkCount()).toBe(85);
  });

  it('creates every default subject enabled and every mapped link enabled', async () => {
    const result = await seedDefaultSubjects(h.prisma);

    expect(result).toEqual({
      subjectsCreated: 12,
      subjectsAdopted: 0,
      linksCreated: expectedLinkCount(),
      skippedGradeLevels: [],
      skippedSubjects: [],
    });

    const subjects = await h.prisma.subject.findMany();
    expect(subjects).toHaveLength(12);
    expect(subjects.every((subject) => subject.enabled)).toBe(true);
    expect(subjects.every((subject) => subject.seedKey !== null)).toBe(true);

    const links = await h.prisma.subjectGradeLevel.findMany();
    expect(links).toHaveLength(expectedLinkCount());
    // The column defaults to `false`, so this is the assertion that matters.
    expect(links.every((link) => link.enabled)).toBe(true);

    const kindergarten = await h.prisma.gradeLevel.findUniqueOrThrow({
      where: { nameKey: 'kindergarten' },
      include: { subjects: { include: { subject: true } } },
    });
    expect(kindergarten.subjects.map((link) => link.subject.name).sort()).toEqual([
      'English',
      'Filipino',
      'Mathematics',
    ]);
  });

  it('creates nothing twice and rewrites nothing on a re-run', async () => {
    await seedDefaultSubjects(h.prisma);
    const subjectsBefore = await h.prisma.subject.findMany({ orderBy: { seedKey: 'asc' } });
    const linksBefore = await h.prisma.subjectGradeLevel.findMany({ orderBy: { id: 'asc' } });

    const second = await seedDefaultSubjects(h.prisma);

    expect(second).toEqual({
      subjectsCreated: 0,
      subjectsAdopted: 0,
      linksCreated: 0,
      skippedGradeLevels: [],
      skippedSubjects: [],
    });
    expect(await h.prisma.subject.findMany({ orderBy: { seedKey: 'asc' } })).toEqual(
      subjectsBefore,
    );
    expect(await h.prisma.subjectGradeLevel.findMany({ orderBy: { id: 'asc' } })).toEqual(
      linksBefore,
    );
  });

  it('recognises a renamed subject by seedKey and never recreates it', async () => {
    await seedDefaultSubjects(h.prisma);
    const mathematics = await h.prisma.subject.findUniqueOrThrow({
      where: { seedKey: 'mathematics' },
    });
    await h.prisma.subject.update({
      where: { id: mathematics.id },
      data: { name: 'Math', nameKey: 'math' },
    });
    const linksBefore = await h.prisma.subjectGradeLevel.count({
      where: { subjectId: mathematics.id },
    });

    const result = await seedDefaultSubjects(h.prisma);

    expect(result.subjectsCreated).toBe(0);
    expect(result.linksCreated).toBe(0);
    expect(await h.prisma.subject.findUnique({ where: { nameKey: 'mathematics' } })).toBeNull();
    const renamed = await h.prisma.subject.findUniqueOrThrow({ where: { seedKey: 'mathematics' } });
    expect(renamed.name).toBe('Math');
    expect(renamed.enabled).toBe(true);
    expect(await h.prisma.subjectGradeLevel.count({ where: { subjectId: mathematics.id } })).toBe(
      linksBefore,
    );
  });

  it('never re-enables a subject an operator disabled', async () => {
    await seedDefaultSubjects(h.prisma);
    await h.prisma.subject.update({ where: { seedKey: 'science' }, data: { enabled: false } });

    const result = await seedDefaultSubjects(h.prisma);

    expect(result.subjectsCreated).toBe(0);
    const science = await h.prisma.subject.findUniqueOrThrow({ where: { seedKey: 'science' } });
    expect(science.enabled).toBe(false);
    expect(await h.prisma.subject.count({ where: { nameKey: 'science' } })).toBe(1);
  });

  it('never re-enables or duplicates a pairing an operator unlinked', async () => {
    await seedDefaultSubjects(h.prisma);
    // A named pair, not `findFirst` without an order: an arbitrary pairing
    // makes a failure here impossible to reproduce.
    const mathematics = await h.prisma.subject.findUniqueOrThrow({
      where: { seedKey: 'mathematics' },
      select: { id: true },
    });
    const kindergarten = await h.prisma.gradeLevel.findUniqueOrThrow({
      where: { nameKey: 'kindergarten' },
      select: { id: true },
    });
    const link = await h.prisma.subjectGradeLevel.findUniqueOrThrow({
      where: {
        subjectId_gradeLevelId: { subjectId: mathematics.id, gradeLevelId: kindergarten.id },
      },
    });
    await h.prisma.subjectGradeLevel.update({ where: { id: link.id }, data: { enabled: false } });

    const result = await seedDefaultSubjects(h.prisma);

    expect(result.linksCreated).toBe(0);
    expect(
      await h.prisma.subjectGradeLevel.count({
        where: { subjectId: link.subjectId, gradeLevelId: link.gradeLevelId },
      }),
    ).toBe(1);
    const unlinked = await h.prisma.subjectGradeLevel.findUniqueOrThrow({ where: { id: link.id } });
    expect(unlinked.enabled).toBe(false);
  });

  it('skips and reports a mapping grade level that is absent, and seeds the rest', async () => {
    await h.prisma.gradeLevel.delete({ where: { nameKey: 'grade 3' } });

    const result = await seedDefaultSubjects(h.prisma);

    expect(result.skippedGradeLevels).toEqual(['Grade 3']);
    expect(result.subjectsCreated).toBe(12);
    expect(result.linksCreated).toBe(expectedLinkCount({ withoutGradeLevel: 'Grade 3' }));
    // The seed never creates a Grade Level to satisfy the mapping.
    expect(await h.prisma.gradeLevel.findUnique({ where: { nameKey: 'grade 3' } })).toBeNull();
  });

  it('adopts an operator-created subject of the same name by stamping seedKey only', async () => {
    const operatorMade = await h.prisma.subject.create({
      data: { name: 'Science', nameKey: 'science', enabled: false },
    });

    const result = await seedDefaultSubjects(h.prisma);

    expect(result.subjectsCreated).toBe(11);
    expect(result.subjectsAdopted).toBe(1);
    expect(result.skippedSubjects).toEqual([]);
    expect(result.linksCreated).toBe(expectedLinkCount());
    expect(await h.prisma.subject.count({ where: { nameKey: 'science' } })).toBe(1);
    const adopted = await h.prisma.subject.findUniqueOrThrow({ where: { id: operatorMade.id } });
    expect(adopted.seedKey).toBe('science');
    expect(adopted.name).toBe('Science');
    expect(adopted.enabled).toBe(false);
    expect(
      await h.prisma.subjectGradeLevel.count({ where: { subjectId: operatorMade.id } }),
    ).toBeGreaterThan(0);
  });

  it('skips a name already held under a different seedKey without crashing', async () => {
    const foreign = await h.prisma.subject.create({
      data: { name: 'English', nameKey: 'english', seedKey: 'operator-owned-english' },
    });

    const result = await seedDefaultSubjects(h.prisma);

    expect(result.subjectsCreated).toBe(11);
    expect(result.subjectsAdopted).toBe(0);
    // The run has to name what it left out: neither this subject nor any of
    // its links exist afterwards.
    expect(result.skippedSubjects).toEqual(['English']);
    expect(result.linksCreated).toBe(expectedLinkCount({ withoutSubject: 'English' }));
    expect(await h.prisma.subject.count({ where: { nameKey: 'english' } })).toBe(1);
    const untouched = await h.prisma.subject.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.seedKey).toBe('operator-owned-english');
    expect(await h.prisma.subjectGradeLevel.count({ where: { subjectId: foreign.id } })).toBe(0);
  });

  it('seeds only what a caller-supplied mapping names', async () => {
    const mapping = [
      { gradeLevels: ['Kindergarten'], subjects: ['Mathematics', 'English'] },
      { gradeLevels: ['Grade 1'], subjects: ['Filipino'] },
    ];

    const result = await seedDefaultSubjects(h.prisma, mapping);

    // The approved subject *set* is always created in full; the mapping bounds
    // the links, not the taxonomy.
    expect(result.subjectsCreated).toBe(12);
    expect(result.linksCreated).toBe(3);
    expect(result.skippedGradeLevels).toEqual([]);
    const links = await h.prisma.subjectGradeLevel.findMany({
      include: { subject: true, gradeLevel: true },
    });
    expect(links.map((link) => `${link.gradeLevel.name}/${link.subject.name}`).sort()).toEqual([
      'Grade 1/Filipino',
      'Kindergarten/English',
      'Kindergarten/Mathematics',
    ]);
  });

  it('rejects a mapping naming an unknown subject before writing anything', async () => {
    const mapping = [
      // Under a grade level that does not exist, so only up-front validation
      // can catch it — the per-level loop never reaches this row.
      { gradeLevels: ['Grade 99'], subjects: ['Astrophysics'] },
      { gradeLevels: ['Kindergarten'], subjects: ['Mathematics'] },
    ];

    await expect(seedDefaultSubjects(h.prisma, mapping)).rejects.toThrow('Astrophysics');

    expect(await h.prisma.subject.count()).toBe(0);
    expect(await h.prisma.subjectGradeLevel.count()).toBe(0);
  });
});

describe('runSeed', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetTaxonomy(h.prisma);
  });

  // The wiring itself, not the passes: dropping `seedDefaultSubjects` from the
  // run would leave every other test in this file green, and the acceptance
  // criteria are phrased against the seed's own reported output.
  it('runs every pass and reports what each one did', async () => {
    const email = `run-seed-${Date.now()}@example.test`;

    const lines = await runSeed(h.prisma, email, 'run-seed-password-123');

    expect(lines[0]).toContain(`Seeded operator ${email}`);
    expect(lines[1]).toBe(`Seeded grade levels: ${PH_GRADE_LEVELS.length} created`);
    expect(lines[2]).toBe(
      `Seeded default subjects: 12 created, 0 adopted, ${expectedLinkCount()} links created; ` +
        `skipped subjects: (none); skipped grade levels: (none)`,
    );

    expect(await h.prisma.gradeLevel.count()).toBe(PH_GRADE_LEVELS.length);
    const subjects = await h.prisma.subject.findMany();
    expect(subjects).toHaveLength(12);
    expect(subjects.every((subject) => subject.enabled)).toBe(true);
    const links = await h.prisma.subjectGradeLevel.findMany();
    expect(links).toHaveLength(expectedLinkCount());
    expect(links.every((link) => link.enabled)).toBe(true);
  });
});

describe('isEntryPointFor', () => {
  // The real `pnpm --filter api run seed` invocation is `node .seed/prisma/seed.js`,
  // with `process.argv[1]` pointing at the same file `import.meta.filename` resolves
  // to — the common case this asserts directly.
  it('is true when argv[1] is the same file', () => {
    expect(isEntryPointFor(import.meta.filename, import.meta.filename)).toBe(true);
  });

  // The exact risk the guard exists for: a linked workspace or symlinked checkout
  // puts `process.argv[1]` on one path and `import.meta.filename` (which Node's ESM
  // loader resolves through symlinks) on another — both must still realpath-match.
  it('is true across a symlink to the same file', () => {
    const symlinkPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'seed-entry-point-')),
      'seed.js',
    );
    fs.symlinkSync(import.meta.filename, symlinkPath);

    expect(isEntryPointFor(symlinkPath, import.meta.filename)).toBe(true);

    fs.rmSync(path.dirname(symlinkPath), { recursive: true, force: true });
  });

  // `test/setup.ts` imports the seed's exported passes under vitest's loader, which
  // never sets `process.argv[1]` to this file — the case the guard must keep inert.
  it('is false when argv[1] is undefined', () => {
    expect(isEntryPointFor(undefined, import.meta.filename)).toBe(false);
  });

  it('is false for a different file', () => {
    expect(isEntryPointFor(import.meta.filename, path.join(os.tmpdir(), 'not-the-seed.js'))).toBe(
      false,
    );
  });
});
