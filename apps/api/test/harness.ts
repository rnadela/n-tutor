import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app-setup.js';
import { AdminAuditService } from '../src/admin/admin-audit.service.js';
import { ADMIN_JWT_AUDIENCE, ADMIN_JWT_ISSUER } from '../src/admin/admin-auth.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaxonomyService } from '../src/admin/taxonomy.service.js';

export const OPERATOR_EMAIL = 'test-operator@example.test';
export const OPERATOR_PASSWORD = 'correct-horse-battery-staple';

export interface Harness {
  app: INestApplication;
  moduleRef: TestingModule;
  prisma: PrismaService;
  taxonomy: TaxonomyService;
  audit: AdminAuditService;
  jwt: JwtService;
  operatorId: string;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  const harness: Harness = {
    app,
    moduleRef,
    prisma,
    taxonomy: moduleRef.get(TaxonomyService),
    audit: moduleRef.get(AdminAuditService),
    jwt: moduleRef.get(JwtService),
    operatorId: '',
    close: async () => {
      await app.close();
    },
  };

  const operator = await prisma.adminUser.upsert({
    where: { email: OPERATOR_EMAIL },
    update: { passwordHash: await argon2.hash(OPERATOR_PASSWORD, { type: argon2.argon2id }) },
    create: {
      email: OPERATOR_EMAIL,
      passwordHash: await argon2.hash(OPERATOR_PASSWORD, { type: argon2.argon2id }),
    },
  });
  harness.operatorId = operator.id;
  return harness;
}

/** Wipes taxonomy and audit state between tests; the operator row survives. */
export async function resetTaxonomy(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "subject_grade_level", "subject", "grade_level", "admin_audit" CASCADE',
  );
}

/** A token shaped like a parent-scoped credential: same secret, wrong audience. */
export function parentStyleToken(jwt: JwtService, subjectId = 'parent-1'): Promise<string> {
  return jwt.signAsync(
    { email: 'parent@example.test', scope: 'parent' },
    { subject: subjectId, audience: 'parent', issuer: ADMIN_JWT_ISSUER },
  );
}

export function adminToken(jwt: JwtService, operatorId: string): Promise<string> {
  return jwt.signAsync(
    { email: OPERATOR_EMAIL, scope: ADMIN_JWT_AUDIENCE },
    { subject: operatorId, audience: ADMIN_JWT_AUDIENCE, issuer: ADMIN_JWT_ISSUER },
  );
}

/**
 * A token the admin audience and issuer accept, varied one claim at a time, so
 * each individual check in the guard is observable.
 */
export function tokenWithClaims(
  jwt: JwtService,
  claims: Record<string, unknown>,
  options: { expiresIn?: number } = {},
): Promise<string> {
  return jwt.signAsync(claims, {
    audience: ADMIN_JWT_AUDIENCE,
    issuer: ADMIN_JWT_ISSUER,
    ...(options.expiresIn === undefined ? {} : { expiresIn: options.expiresIn }),
  });
}
