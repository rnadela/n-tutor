import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { nameKey, normaliseName } from '../src/common/name-key.js';

// `import.meta.dirname` would resolve against tsc's `.seed/` output location,
// not the source tree, so this relies on the workspace's guaranteed cwd
// (`pnpm --filter api run seed` / `turbo run seed` always run from `apps/api`).
loadEnv({ path: path.resolve(process.cwd(), '..', '..', '.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const MIN_SEED_PASSWORD_LENGTH = 8;
export const MAX_SEED_PASSWORD_LENGTH = 256;

/**
 * Fails fast rather than seeding a trivially short credential. `change-me-too`
 * (the `.env.example` value) is a deliberate, documented dev/test default —
 * used by this workspace's own E2E suite — so it is not rejected here; only
 * production deployment is responsible for setting a real operator password.
 */
export function requireSeedPassword(name: string): string {
  const password = required(name);
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_SEED_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at most ${MAX_SEED_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

export interface SeedResult {
  email: string;
  adminUserCount: number;
}

/**
 * Seeds exactly one operator, out of band. Idempotent and create-only: seeding
 * again must never revert a rotated operator password.
 */
export async function seedOperator(
  prisma: Pick<PrismaClient, 'adminUser'>,
  email: string,
  password: string,
): Promise<SeedResult> {
  const normalisedEmail = email.trim().toLowerCase();
  const existing = await prisma.adminUser.findUnique({
    where: { email: normalisedEmail },
    select: { id: true },
  });
  if (!existing) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.adminUser.create({ data: { email: normalisedEmail, passwordHash } });
  }
  const adminUserCount = await prisma.adminUser.count();
  return { email: normalisedEmail, adminUserCount };
}

/**
 * The Philippine K to 12 levels (RA 10533): Kindergarten, Grades 1–6
 * (elementary), 7–10 (junior high) and 11–12 (senior high).
 */
export const PH_GRADE_LEVELS: readonly string[] = [
  'Kindergarten',
  ...Array.from({ length: 12 }, (_, index) => `Grade ${index + 1}`),
];

/**
 * Seeds the standard grade levels. Create-only, keyed on the same
 * case-insensitive `nameKey` the admin taxonomy uses: a level an operator has
 * renamed or withdrawn is never recreated or re-enabled by a later run.
 *
 * The key is `nameKey()` and the stored label `normaliseName()` — the taxonomy
 * service's own normalisation, not a bare `toLowerCase()` — so the pass that
 * *creates* a level and the subject pass that *looks one up* cannot disagree
 * about what "Grade  4" keys to.
 */
export async function seedGradeLevels(
  prisma: Pick<PrismaClient, 'gradeLevel'>,
  names: readonly string[] = PH_GRADE_LEVELS,
): Promise<number> {
  let created = 0;
  for (const name of names) {
    const key = nameKey(name);
    const existing = await prisma.gradeLevel.findUnique({
      where: { nameKey: key },
      select: { id: true },
    });
    if (!existing) {
      await prisma.gradeLevel.create({
        data: { name: normaliseName(name), nameKey: key, enabled: true },
      });
      created += 1;
    }
  }
  return created;
}

/** One default Subject: its label, and the seed's rename-proof identity. */
export interface DefaultSubject {
  /** Stable, never derived from the label — a rename must not move it. */
  readonly seedKey: string;
  readonly name: string;
}

/**
 * The approved default subject set (epics.md Story 2.3, approved 2026-10-12).
 * Created enabled; the seed never rewrites a name or an `enabled` flag
 * afterwards, so an operator's edit to any of these always wins.
 */
export const DEFAULT_SUBJECTS: readonly DefaultSubject[] = [
  { seedKey: 'mathematics', name: 'Mathematics' },
  { seedKey: 'science', name: 'Science' },
  { seedKey: 'english', name: 'English' },
  { seedKey: 'filipino', name: 'Filipino' },
  { seedKey: 'makabansa', name: 'Makabansa' },
  { seedKey: 'gmrc', name: 'GMRC' },
  { seedKey: 'araling-panlipunan', name: 'Araling Panlipunan' },
  { seedKey: 'mapeh', name: 'MAPEH' },
  { seedKey: 'epp', name: 'EPP' },
  { seedKey: 'values-education', name: 'Values Education' },
  { seedKey: 'tle', name: 'TLE' },
  { seedKey: 'social-sciences', name: 'Social Sciences' },
];

/** One row of the approved mapping table: grade levels, and their subjects. */
export interface DefaultSubjectMappingRow {
  readonly gradeLevels: readonly string[];
  readonly subjects: readonly string[];
}

/**
 * The approved default mapping (epics.md Story 2.3, approved 2026-10-12),
 * transcribed row for row from that table so the two stay diffable. Grade
 * levels resolve by `nameKey` against whatever is in the database when the
 * subject pass runs; a name absent by key there is a reported skip.
 */
export const PH_DEFAULT_SUBJECT_MAPPING: readonly DefaultSubjectMappingRow[] = [
  { gradeLevels: ['Kindergarten'], subjects: ['Mathematics', 'English', 'Filipino'] },
  {
    gradeLevels: ['Grade 1', 'Grade 2'],
    subjects: ['Mathematics', 'English', 'Filipino', 'Makabansa', 'GMRC'],
  },
  {
    gradeLevels: ['Grade 3'],
    subjects: ['Mathematics', 'Science', 'English', 'Filipino', 'Makabansa', 'GMRC'],
  },
  {
    gradeLevels: ['Grade 4', 'Grade 5', 'Grade 6'],
    subjects: [
      'Mathematics',
      'Science',
      'English',
      'Filipino',
      'Araling Panlipunan',
      'MAPEH',
      'GMRC',
      'EPP',
    ],
  },
  {
    gradeLevels: ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'],
    subjects: [
      'Mathematics',
      'Science',
      'English',
      'Filipino',
      'Araling Panlipunan',
      'MAPEH',
      'Values Education',
      'TLE',
    ],
  },
  {
    gradeLevels: ['Grade 11', 'Grade 12'],
    subjects: ['Mathematics', 'Science', 'English', 'Filipino', 'Social Sciences'],
  },
];

export interface DefaultSubjectSeedResult {
  subjectsCreated: number;
  /** Operator-made rows of the same name taken over by stamping `seedKey`. */
  subjectsAdopted: number;
  linksCreated: number;
  /** Mapping grade levels absent from the database, in mapping order. */
  skippedGradeLevels: string[];
  /**
   * Default subjects the pass left entirely alone because a *different*
   * `seedKey` already holds the name. Neither the subject nor any of its links
   * exist afterwards, so the run has to say so rather than report one fewer
   * create and leave the operator to work it out. In `DEFAULT_SUBJECTS` order.
   */
  skippedSubjects: string[];
}

/**
 * The seed's own identity map, built once and validated before any database
 * work: a mapping typo or a duplicated `DEFAULT_SUBJECTS` entry must fail the
 * run outright, not quietly collapse into another subject's key or go
 * unnoticed because the grade level it sat under happened to be absent.
 */
function seedKeysByNameKey(mapping: readonly DefaultSubjectMappingRow[]): Map<string, string> {
  const bySeedKey = new Set<string>();
  const byNameKey = new Map<string, string>();
  for (const { seedKey, name } of DEFAULT_SUBJECTS) {
    if (bySeedKey.has(seedKey)) {
      throw new Error(`DEFAULT_SUBJECTS has a duplicate seedKey: ${seedKey}`);
    }
    bySeedKey.add(seedKey);
    const key = nameKey(name);
    if (byNameKey.has(key)) {
      throw new Error(`DEFAULT_SUBJECTS has two subjects with the same nameKey: ${key}`);
    }
    byNameKey.set(key, seedKey);
  }
  for (const row of mapping) {
    for (const subjectName of row.subjects) {
      if (!byNameKey.has(nameKey(subjectName))) {
        throw new Error(
          `Default subject mapping names a subject that is not in DEFAULT_SUBJECTS: ${subjectName}`,
        );
      }
    }
  }
  return byNameKey;
}

/**
 * Seeds the approved default subjects and their Subject–Grade Level
 * availability. Create-only in both passes:
 *
 * - A Subject is identified by `seedKey` first, so a rename (which moves
 *   `nameKey`) never causes a second row. A row that already holds the target
 *   `nameKey` with no `seedKey` is an operator-made duplicate-by-name: it is
 *   adopted by stamping `seedKey` alone — name and `enabled` are left as the
 *   operator left them. A row holding that `nameKey` under a *different*
 *   `seedKey` is treated as already present and skipped entirely (and
 *   reported), so no unique violation can arise.
 * - A join row is identified by `(subjectId, gradeLevelId)`. One that exists
 *   in any state is left exactly as it is — `enabled: false` is what an
 *   operator's unlink looks like (`setAvailability` disables, never deletes).
 *   `SubjectGradeLevel.enabled` defaults to `false`, so a created row sets it
 *   explicitly or the pairing would be linked but offered nowhere.
 * - A mapping grade level that is absent **by key at the time this pass runs**
 *   is a reported skip: its links are not created and nothing is created to
 *   satisfy the mapping. Note that `runSeed` runs `seedGradeLevels` first, and
 *   that pass re-creates a renamed standard level under its original key — so
 *   in the real CLI path this skip is reached for a level that was never
 *   seeded (or was removed), not for one an operator merely renamed.
 *
 * Writes no `AdminAudit` row: the seed has no actor, exactly like the operator
 * and grade-level passes. Reports its counts rather than printing them.
 */
export async function seedDefaultSubjects(
  prisma: Pick<PrismaClient, 'subject' | 'gradeLevel' | 'subjectGradeLevel'>,
  mapping: readonly DefaultSubjectMappingRow[] = PH_DEFAULT_SUBJECT_MAPPING,
): Promise<DefaultSubjectSeedResult> {
  // Before any write: a mapping this transcription cannot represent is a
  // failure, not a silent omission.
  const seedKeyByNameKey = seedKeysByNameKey(mapping);

  let subjectsCreated = 0;
  let subjectsAdopted = 0;
  let linksCreated = 0;
  const skippedSubjects: string[] = [];

  // Only subjects resolved here can be linked; a skipped one (a foreign
  // `seedKey` already holds its name) is deliberately absent, so the seed
  // neither links nor touches a row it does not own.
  const subjectIdBySeedKey = new Map<string, string>();

  for (const { seedKey, name } of DEFAULT_SUBJECTS) {
    const bySeedKey = await prisma.subject.findUnique({
      where: { seedKey },
      select: { id: true },
    });
    if (bySeedKey) {
      // Possibly renamed or disabled by an operator: recognised, left alone.
      subjectIdBySeedKey.set(seedKey, bySeedKey.id);
      continue;
    }
    const key = nameKey(name);
    const byNameKey = await prisma.subject.findUnique({
      where: { nameKey: key },
      select: { id: true, seedKey: true },
    });
    if (byNameKey) {
      if (byNameKey.seedKey === null) {
        await prisma.subject.update({ where: { id: byNameKey.id }, data: { seedKey } });
        subjectIdBySeedKey.set(seedKey, byNameKey.id);
        subjectsAdopted += 1;
      } else {
        skippedSubjects.push(normaliseName(name));
      }
      continue;
    }
    const created = await prisma.subject.create({
      data: { name: normaliseName(name), nameKey: key, seedKey, enabled: true },
      select: { id: true },
    });
    subjectIdBySeedKey.set(seedKey, created.id);
    subjectsCreated += 1;
  }

  const skippedGradeLevels: string[] = [];
  const gradeLevelIdByNameKey = new Map<string, string | null>();

  for (const row of mapping) {
    for (const gradeLevelName of row.gradeLevels) {
      const gradeLevelKey = nameKey(gradeLevelName);
      let gradeLevelId = gradeLevelIdByNameKey.get(gradeLevelKey);
      if (gradeLevelId === undefined) {
        const gradeLevel = await prisma.gradeLevel.findUnique({
          where: { nameKey: gradeLevelKey },
          select: { id: true },
        });
        gradeLevelId = gradeLevel?.id ?? null;
        gradeLevelIdByNameKey.set(gradeLevelKey, gradeLevelId);
        if (gradeLevelId === null) skippedGradeLevels.push(normaliseName(gradeLevelName));
      }
      if (gradeLevelId === null) continue;

      for (const subjectName of row.subjects) {
        // Validated up front, so this cannot be undefined here.
        const seedKey = seedKeyByNameKey.get(nameKey(subjectName))!;
        const subjectId = subjectIdBySeedKey.get(seedKey);
        if (subjectId === undefined) continue;

        const existing = await prisma.subjectGradeLevel.findUnique({
          where: { subjectId_gradeLevelId: { subjectId, gradeLevelId } },
          select: { id: true },
        });
        if (!existing) {
          await prisma.subjectGradeLevel.create({
            data: { subjectId, gradeLevelId, enabled: true },
          });
          linksCreated += 1;
        }
      }
    }
  }

  return {
    subjectsCreated,
    subjectsAdopted,
    linksCreated,
    skippedGradeLevels,
    skippedSubjects,
  };
}

function listOrNone(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : '(none)';
}

/**
 * Every pass the seed performs, in order, as one callable unit that returns the
 * lines the run reports rather than printing them. `main()` is then only env
 * resolution, a client and stdout — which is what lets a test assert on the
 * wiring and on the reported output itself, the surface the story's acceptance
 * criteria are phrased against.
 */
export async function runSeed(
  prisma: Pick<PrismaClient, 'adminUser' | 'subject' | 'gradeLevel' | 'subjectGradeLevel'>,
  email: string,
  password: string,
): Promise<string[]> {
  const operator = await seedOperator(prisma, email, password);
  const gradeLevels = await seedGradeLevels(prisma);
  const subjects = await seedDefaultSubjects(prisma);
  return [
    `Seeded operator ${operator.email}; admin_user rows: ${operator.adminUserCount}`,
    `Seeded grade levels: ${gradeLevels} created`,
    `Seeded default subjects: ${subjects.subjectsCreated} created, ` +
      `${subjects.subjectsAdopted} adopted, ${subjects.linksCreated} links created; ` +
      `skipped subjects: ${listOrNone(subjects.skippedSubjects)}; ` +
      `skipped grade levels: ${listOrNone(subjects.skippedGradeLevels)}`,
  ];
}

async function main(): Promise<void> {
  const email = required('ADMIN_SEED_EMAIL');
  const password = requireSeedPassword('ADMIN_SEED_PASSWORD');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: required('DATABASE_URL') }),
  });

  try {
    for (const line of await runSeed(prisma, email, password)) {
      process.stdout.write(`${line}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only seed when this module *is* the process, never when a test imports its
// exported passes. `test/setup.ts` points `DATABASE_URL` at the test database,
// so an import-time run would write the operator, the grade levels, the default
// subjects and their links into it while the importing spec is truncating the
// same tables — a race no assertion could survive.
//
// Both sides are compared as *realpaths*: Node's ESM loader resolves symlinks
// when it computes `import.meta.filename`, while `process.argv[1]` is left
// exactly as the invoker wrote it. Compared raw, a run reached through any
// symlinked path (a linked workspace, a symlinked checkout) would look like an
// import and the seed would silently do nothing and exit 0 — on a fresh
// environment, the one failure mode this script must never have. `realpathSync`
// throws on a path that does not exist, so each side falls back to its given
// value.
function realpathOrSelf(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** Exported so a test can exercise the comparison without spawning a process. */
export function isEntryPointFor(argv1: string | undefined, selfPath: string): boolean {
  return argv1 !== undefined && realpathOrSelf(argv1) === realpathOrSelf(selfPath);
}

const isEntryPoint = isEntryPointFor(process.argv[1], import.meta.filename);

if (isEntryPoint) {
  main().catch((cause: unknown) => {
    process.stderr.write(
      `Seed failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  });
}
