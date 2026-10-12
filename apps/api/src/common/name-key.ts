/**
 * Taxonomy name normalisation, in a module of its own and deliberately free of
 * every dependency: the out-of-band seed (`prisma/seed.ts`, compiled on its own
 * by `tsconfig.seed.json`) keys on exactly these two functions, and importing
 * them from `admin/taxonomy.service.ts` would drag `@nestjs/common`,
 * `PrismaService` and `AdminAuditService` into a deploy-critical script that
 * needs two pure string functions. Both the service and the seed import from
 * here, so the key the seed writes and the key the service computes can never
 * diverge.
 */

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
