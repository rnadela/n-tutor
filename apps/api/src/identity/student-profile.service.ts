import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TaxonomyService, type TaxonomyItem } from '../admin/taxonomy.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  NAME_SHAPE,
  NOTHING_TO_CHANGE,
  isAcceptableDisplayName,
  normaliseDisplayName,
} from './student-profile-policy.js';

/** A Student Profile as every read path returns it. */
export interface StudentProfileView {
  id: string;
  displayName: string;
  gradeLevelId: string;
  /** The Grade Level's **current** name, resolved on read. Never stored here. */
  gradeLevelName: string;
  /** Whether the stored Grade Level is still selectable for a new profile. */
  gradeLevelEnabled: boolean;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
}

const PROFILE_FIELDS = {
  id: true,
  displayName: true,
  gradeLevelId: true,
  archivedAt: true,
  createdAt: true,
} as const;

interface ProfileRow {
  id: string;
  displayName: string;
  gradeLevelId: string;
  archivedAt: Date | null;
  createdAt: Date;
}

export const GRADE_LEVEL_NOT_SELECTABLE = 'That Grade Level is not available to choose.';
export const PROFILE_NOT_FOUND = 'Student Profile not found.';

/**
 * Sole writer of StudentProfile (AD-17).
 *
 * Two rules hold every method together:
 *
 * - The Grade Level is never copied. A profile stores an id; every read
 *   resolves the label through `admin`'s TaxonomyService, so an Admin rename or
 *   disable changes what the profile reads without writing the profile row.
 * - Every read and every write is scoped by `parentAccountId` in the same
 *   query — the writes through `updateMany`, so the account is part of the
 *   statement that mutates rather than a check made just before it. An id
 *   belonging to another account therefore matches nothing and changes nothing:
 *   a 404, never a 403, which would confirm the profile exists somewhere.
 *
 * Nothing here enforces an Account-Tier cap: that is Epic 9 (FR-31).
 */
@Injectable()
export class StudentProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  // --- Reads -------------------------------------------------------------

  /** Every profile on the account, archived ones included, by name. */
  async list(parentAccountId: string): Promise<StudentProfileView[]> {
    const rows = await this.prisma.studentProfile.findMany({
      where: { parentAccountId },
      select: PROFILE_FIELDS,
      orderBy: [{ displayName: 'asc' }, { createdAt: 'asc' }],
    });
    return this.withGradeLevels(rows);
  }

  /**
   * The profiles Student Mode may bind to: active ones only.
   *
   * Its own endpoint rather than a query flag, because archiving's whole
   * observable effect is that this list shrinks, and Story 1.4's binding prompt
   * consumes exactly this.
   */
  async listSelectable(parentAccountId: string): Promise<StudentProfileView[]> {
    const rows = await this.prisma.studentProfile.findMany({
      where: { parentAccountId, archivedAt: null },
      select: PROFILE_FIELDS,
      orderBy: [{ displayName: 'asc' }, { createdAt: 'asc' }],
    });
    return this.withGradeLevels(rows);
  }

  /**
   * One profile that Student Mode may bind to, or `null`.
   *
   * Active and owned in the same query, exactly as every other read here is
   * scoped: a profile that is archived, unknown, or another account's is
   * indistinguishable from the caller's side — a 404, never a 403, which would
   * confirm the row exists somewhere.
   */
  async findSelectable(parentAccountId: string, id: string): Promise<StudentProfileView | null> {
    const row = await this.prisma.studentProfile.findFirst({
      where: { id, parentAccountId, archivedAt: null },
      select: PROFILE_FIELDS,
    });
    if (!row) return null;
    return this.withGradeLevel(row);
  }

  /** The Grade Levels a parent may choose from right now. */
  listGradeLevels(): Promise<TaxonomyItem[]> {
    return this.taxonomy.listSelectableGradeLevels();
  }

  // --- Writes ------------------------------------------------------------

  /**
   * Creates a profile and reports whether it is the account's **only active**
   * one, which is what makes it the profile the device binds to (Story 1.4).
   *
   * The count runs in the same transaction as the write, so the caller never
   * makes a second query that a concurrent create could slip between. It counts
   * active profiles only: an account whose sole child was archived and replaced
   * is an account whose replacement is again the first thing to bind to.
   */
  async create(
    parentAccountId: string,
    input: { displayName: string; gradeLevelId: string },
  ): Promise<{ profile: StudentProfileView; isFirst: boolean }> {
    const displayName = this.requireName(input.displayName);
    const gradeLevel = await this.requireSelectableGradeLevel(input.gradeLevelId);

    const [row, activeCount] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.studentProfile.create({
        data: { parentAccountId, displayName, gradeLevelId: gradeLevel.id },
        select: PROFILE_FIELDS,
      });
      const count = await tx.studentProfile.count({
        where: { parentAccountId, archivedAt: null },
      });
      return [created, count] as const;
    });

    return { profile: viewOf(row, gradeLevel), isFirst: activeCount === 1 };
  }

  /**
   * A rename, a Grade-Level change, or both — one row in one table, and nothing
   * else. A patch naming neither is a client bug, not a no-op write.
   */
  async update(
    parentAccountId: string,
    id: string,
    input: { displayName?: string; gradeLevelId?: string },
  ): Promise<StudentProfileView> {
    if (input.displayName === undefined && input.gradeLevelId === undefined) {
      throw new BadRequestException(NOTHING_TO_CHANGE);
    }
    // Ownership is established before anything is validated, so a probe with a
    // malformed body against another account's id still answers 404.
    await this.requireOwned(parentAccountId, id);

    const data: { displayName?: string; gradeLevelId?: string } = {};
    if (input.displayName !== undefined) data.displayName = this.requireName(input.displayName);
    if (input.gradeLevelId !== undefined) {
      // A change may only land on a Grade Level that is selectable now; one
      // already stored keeps resolving regardless.
      data.gradeLevelId = (await this.requireSelectableGradeLevel(input.gradeLevelId)).id;
    }

    // The account is part of the statement that writes, not only of the read
    // above: a row that stops being this account's in between changes nothing,
    // and answers 404 rather than surfacing Prisma's missing-row fault as a 500.
    const written = await this.prisma.studentProfile.updateMany({
      where: { id, parentAccountId },
      data,
    });
    if (written.count !== 1) throw new NotFoundException(PROFILE_NOT_FOUND);

    return this.withGradeLevel(await this.requireOwned(parentAccountId, id));
  }

  /**
   * Archiving writes one nullable instant and nothing else: no copy, no
   * cascade, no delete. Idempotent — archiving an archived profile leaves the
   * original instant in place, so "when" stays true.
   */
  async archive(parentAccountId: string, id: string): Promise<void> {
    const row = await this.requireOwned(parentAccountId, id);
    if (row.archivedAt !== null) return;
    // Account-scoped and state-guarded in one statement: a concurrent archive
    // matches nothing here, so the instant that won stays the instant.
    await this.prisma.studentProfile.updateMany({
      where: { id, parentAccountId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
  }

  /** The inverse, so a mistyped tap is recoverable without a delete. */
  async restore(parentAccountId: string, id: string): Promise<void> {
    const row = await this.requireOwned(parentAccountId, id);
    if (row.archivedAt === null) return;
    await this.prisma.studentProfile.updateMany({
      where: { id, parentAccountId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
  }

  // --- Internals ---------------------------------------------------------

  private requireName(raw: string): string {
    if (!isAcceptableDisplayName(raw)) throw new BadRequestException(NAME_SHAPE);
    return normaliseDisplayName(raw);
  }

  /**
   * An unknown Grade Level is a 404 and a disabled one is a 400: the first says
   * the reference does not exist, the second that it exists but may not be
   * chosen. `resolveGradeLevel` raises the 404 itself.
   */
  private async requireSelectableGradeLevel(id: string): Promise<TaxonomyItem> {
    const gradeLevel = await this.taxonomy.resolveGradeLevel(id);
    if (!gradeLevel.enabled) throw new BadRequestException(GRADE_LEVEL_NOT_SELECTABLE);
    return gradeLevel;
  }

  /** The account scope is part of the lookup, never a check made afterwards. */
  private async requireOwned(parentAccountId: string, id: string): Promise<ProfileRow> {
    const row = await this.prisma.studentProfile.findFirst({
      where: { id, parentAccountId },
      select: PROFILE_FIELDS,
    });
    if (!row) throw new NotFoundException(PROFILE_NOT_FOUND);
    return row;
  }

  private async withGradeLevel(row: ProfileRow): Promise<StudentProfileView> {
    return viewOf(row, await this.taxonomy.resolveGradeLevel(row.gradeLevelId));
  }

  /** One taxonomy read per distinct Grade Level, not one per profile. */
  private async withGradeLevels(rows: ProfileRow[]): Promise<StudentProfileView[]> {
    const ids = [...new Set(rows.map((row) => row.gradeLevelId))];
    const resolved = new Map<string, TaxonomyItem>(
      await Promise.all(
        ids.map(async (id) => [id, await this.taxonomy.resolveGradeLevel(id)] as const),
      ),
    );
    return rows.map((row) => viewOf(row, resolved.get(row.gradeLevelId)!));
  }
}

function viewOf(row: ProfileRow, gradeLevel: TaxonomyItem): StudentProfileView {
  return {
    id: row.id,
    displayName: row.displayName,
    gradeLevelId: gradeLevel.id,
    gradeLevelName: gradeLevel.name,
    gradeLevelEnabled: gradeLevel.enabled,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
