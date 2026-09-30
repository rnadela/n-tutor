import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminAuditService } from './admin-audit.service.js';

export interface TaxonomyItem {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AvailabilityEntry {
  subjectId: string;
  gradeLevelId: string;
  enabled: boolean;
}

export interface TaxonomySnapshot {
  subjects: TaxonomyItem[];
  gradeLevels: TaxonomyItem[];
  availability: AvailabilityEntry[];
}

/**
 * The stored label: Unicode-normalised (NFKC), trimmed, internal whitespace
 * collapsed. "Grade  4" and "Grade 4" are the same Grade Level.
 */
export function normaliseName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** Case-insensitive uniqueness key. The label keeps its original casing. */
export function nameKey(name: string): string {
  return normaliseName(name).toLowerCase();
}

/**
 * Grade Level names embed a number ("Grade 10"), so a plain string sort puts
 * "Grade 10" before "Grade 2". Numeric-aware collation orders them the way a
 * reader expects.
 */
const GRADE_LEVEL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortGradeLevels<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => GRADE_LEVEL_COLLATOR.compare(a.name, b.name));
}

const ITEM_FIELDS = { id: true, name: true, enabled: true } as const;

function requireName(label: string, name: string): string {
  const normalised = normaliseName(name);
  if (normalised.length === 0) throw new BadRequestException(`A ${label} name is required.`);
  return normalised;
}

/** A unique-index violation is a duplicate name, not a server fault. */
async function conflictOnDuplicate<T>(message: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw cause;
  }
}

/**
 * Sole writer of Subject, GradeLevel and SubjectGradeLevel (AD-17, AD-25).
 *
 * Taxonomy items are disabled, never deleted. Selectability is the conjunction
 * of three independently stored flags, resolved on read — nothing is cascaded
 * and nothing is denormalised, so a rename or a disable never touches a
 * consumer's stored reference.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // --- Reads -------------------------------------------------------------

  async listTaxonomy(): Promise<TaxonomySnapshot> {
    const [subjects, gradeLevels, availability] = await Promise.all([
      this.prisma.subject.findMany({ select: ITEM_FIELDS, orderBy: { name: 'asc' } }),
      this.prisma.gradeLevel.findMany({ select: ITEM_FIELDS, orderBy: { name: 'asc' } }),
      this.prisma.subjectGradeLevel.findMany({
        select: { subjectId: true, gradeLevelId: true, enabled: true },
      }),
    ]);
    return { subjects, gradeLevels: sortGradeLevels(gradeLevels), availability };
  }

  /**
   * The Subjects offered for a Grade Level: Subject enabled AND Grade Level
   * enabled AND the join row enabled, computed in one query.
   */
  async listSelectableSubjects(gradeLevelId: string): Promise<TaxonomyItem[]> {
    const gradeLevel = await this.prisma.gradeLevel.findUnique({
      where: { id: gradeLevelId },
      select: ITEM_FIELDS,
    });
    if (!gradeLevel) throw new NotFoundException('Grade Level not found.');
    if (!gradeLevel.enabled) return [];

    return this.prisma.subject.findMany({
      where: {
        enabled: true,
        gradeLevels: { some: { gradeLevelId, enabled: true } },
      },
      select: ITEM_FIELDS,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The Grade Levels that may be chosen right now: enabled only, by name.
   *
   * Read-only, so no audit row — this is the shared taxonomy read `identity`
   * makes when a parent picks a Grade Level for a Student Profile. It is
   * deliberately *not* the same call as `resolveGradeLevel`, which succeeds for
   * a disabled row so a stored reference keeps resolving.
   */
  async listSelectableGradeLevels(): Promise<TaxonomyItem[]> {
    const gradeLevels = await this.prisma.gradeLevel.findMany({
      where: { enabled: true },
      select: ITEM_FIELDS,
      orderBy: { name: 'asc' },
    });
    return sortGradeLevels(gradeLevels);
  }

  /** Succeeds for a disabled row — a stored id always resolves. */
  async resolveSubject(id: string): Promise<TaxonomyItem> {
    const subject = await this.prisma.subject.findUnique({ where: { id }, select: ITEM_FIELDS });
    if (!subject) throw new NotFoundException('Subject not found.');
    return subject;
  }

  /** Succeeds for a disabled row — a stored id always resolves. */
  async resolveGradeLevel(id: string): Promise<TaxonomyItem> {
    const gradeLevel = await this.prisma.gradeLevel.findUnique({
      where: { id },
      select: ITEM_FIELDS,
    });
    if (!gradeLevel) throw new NotFoundException('Grade Level not found.');
    return gradeLevel;
  }

  // --- Subject writes ----------------------------------------------------

  async createSubject(actorId: string, rawName: string): Promise<TaxonomyItem> {
    const name = requireName('Subject', rawName);
    const key = nameKey(name);
    return conflictOnDuplicate(`Subject "${name}" already exists.`, () =>
      this.prisma.withTransaction(async (tx) => {
        const clash = await tx.subject.findUnique({
          where: { nameKey: key },
          select: { id: true },
        });
        if (clash) throw new ConflictException(`Subject "${name}" already exists.`);

        const created = await tx.subject.create({
          data: { name, nameKey: key, enabled: true },
          select: ITEM_FIELDS,
        });
        await this.audit.record(tx, actorId, 'subject.create', 'Subject', created.id, {
          name: created.name,
        });
        return created;
      }),
    );
  }

  async renameSubject(actorId: string, id: string, rawName: string): Promise<TaxonomyItem> {
    const name = requireName('Subject', rawName);
    const key = nameKey(name);
    return conflictOnDuplicate(`Subject "${name}" already exists.`, () =>
      this.prisma.withTransaction(async (tx) => {
        const before = await tx.subject.findUnique({ where: { id }, select: ITEM_FIELDS });
        if (!before) throw new NotFoundException('Subject not found.');

        const clash = await tx.subject.findUnique({
          where: { nameKey: key },
          select: { id: true },
        });
        if (clash && clash.id !== id) {
          throw new ConflictException(`Subject "${name}" already exists.`);
        }

        // The id never changes; consumers resolve the label by reference.
        const after = await tx.subject.update({
          where: { id },
          data: { name, nameKey: key },
          select: ITEM_FIELDS,
        });
        await this.audit.record(tx, actorId, 'subject.rename', 'Subject', id, {
          from: before.name,
          to: after.name,
        });
        return after;
      }),
    );
  }

  async setSubjectEnabled(actorId: string, id: string, enabled: boolean): Promise<TaxonomyItem> {
    return this.prisma.withTransaction(async (tx) => {
      const before = await tx.subject.findUnique({ where: { id }, select: ITEM_FIELDS });
      if (!before) throw new NotFoundException('Subject not found.');

      const after = await tx.subject.update({
        where: { id },
        data: { enabled },
        select: ITEM_FIELDS,
      });
      await this.audit.record(
        tx,
        actorId,
        enabled ? 'subject.enable' : 'subject.disable',
        'Subject',
        id,
        { from: before.enabled, to: after.enabled },
      );
      return after;
    });
  }

  // --- Grade Level writes ------------------------------------------------

  async createGradeLevel(actorId: string, rawName: string): Promise<TaxonomyItem> {
    const name = requireName('Grade Level', rawName);
    const key = nameKey(name);
    return conflictOnDuplicate(`Grade Level "${name}" already exists.`, () =>
      this.prisma.withTransaction(async (tx) => {
        const clash = await tx.gradeLevel.findUnique({
          where: { nameKey: key },
          select: { id: true },
        });
        if (clash) throw new ConflictException(`Grade Level "${name}" already exists.`);

        const created = await tx.gradeLevel.create({
          data: { name, nameKey: key, enabled: true },
          select: ITEM_FIELDS,
        });
        await this.audit.record(tx, actorId, 'gradeLevel.create', 'GradeLevel', created.id, {
          name: created.name,
        });
        return created;
      }),
    );
  }

  async renameGradeLevel(actorId: string, id: string, rawName: string): Promise<TaxonomyItem> {
    const name = requireName('Grade Level', rawName);
    const key = nameKey(name);
    return conflictOnDuplicate(`Grade Level "${name}" already exists.`, () =>
      this.prisma.withTransaction(async (tx) => {
        const before = await tx.gradeLevel.findUnique({ where: { id }, select: ITEM_FIELDS });
        if (!before) throw new NotFoundException('Grade Level not found.');

        const clash = await tx.gradeLevel.findUnique({
          where: { nameKey: key },
          select: { id: true },
        });
        if (clash && clash.id !== id) {
          throw new ConflictException(`Grade Level "${name}" already exists.`);
        }

        const after = await tx.gradeLevel.update({
          where: { id },
          data: { name, nameKey: key },
          select: ITEM_FIELDS,
        });
        await this.audit.record(tx, actorId, 'gradeLevel.rename', 'GradeLevel', id, {
          from: before.name,
          to: after.name,
        });
        return after;
      }),
    );
  }

  async setGradeLevelEnabled(actorId: string, id: string, enabled: boolean): Promise<TaxonomyItem> {
    return this.prisma.withTransaction(async (tx) => {
      const before = await tx.gradeLevel.findUnique({ where: { id }, select: ITEM_FIELDS });
      if (!before) throw new NotFoundException('Grade Level not found.');

      const after = await tx.gradeLevel.update({
        where: { id },
        data: { enabled },
        select: ITEM_FIELDS,
      });
      await this.audit.record(
        tx,
        actorId,
        enabled ? 'gradeLevel.enable' : 'gradeLevel.disable',
        'GradeLevel',
        id,
        { from: before.enabled, to: after.enabled },
      );
      return after;
    });
  }

  // --- Availability ------------------------------------------------------

  /**
   * The third independent flag. Enabling upserts the join row; disabling a join
   * row that does not exist is a 404.
   */
  async setAvailability(
    actorId: string,
    subjectId: string,
    gradeLevelId: string,
    enabled: boolean,
  ): Promise<AvailabilityEntry> {
    return conflictOnDuplicate('That pairing was changed concurrently. Try again.', () =>
      this.prisma.withTransaction(async (tx) => {
        const subject = await tx.subject.findUnique({
          where: { id: subjectId },
          select: { id: true },
        });
        if (!subject) throw new NotFoundException('Subject not found.');

        const gradeLevel = await tx.gradeLevel.findUnique({
          where: { id: gradeLevelId },
          select: { id: true },
        });
        if (!gradeLevel) throw new NotFoundException('Grade Level not found.');

        const existing = await tx.subjectGradeLevel.findUnique({
          where: { subjectId_gradeLevelId: { subjectId, gradeLevelId } },
          select: { enabled: true },
        });
        if (!existing && !enabled) throw new NotFoundException('Availability not found.');

        const row = await tx.subjectGradeLevel.upsert({
          where: { subjectId_gradeLevelId: { subjectId, gradeLevelId } },
          update: { enabled },
          create: { subjectId, gradeLevelId, enabled },
        });

        await this.audit.record(
          tx,
          actorId,
          enabled ? 'availability.enable' : 'availability.disable',
          'SubjectGradeLevel',
          row.id,
          { subjectId, gradeLevelId, from: existing?.enabled ?? null, to: enabled },
        );

        return { subjectId: row.subjectId, gradeLevelId: row.gradeLevelId, enabled: row.enabled };
      }),
    );
  }
}
