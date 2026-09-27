import 'reflect-metadata';
import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AiModule } from './ai/ai.module.js';
import { CorrelationIdMiddleware } from './common/correlation.js';
import { requireIntEnv } from './common/env.js';
import { ExtractionModule } from './extraction/extraction.module.js';
import { GradingModule } from './grading/grading.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { PARENT_CREDENTIAL_ROUTE } from './identity/parent-credential-route.decorator.js';
import { PracticeTestModule } from './practicetest/practice-test.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SourceTestModule } from './sourcetest/source-test.module.js';

export const LOGIN_THROTTLER = 'login';
export const PARENT_THROTTLER = 'parent';

@Module({
  imports: [
    // IP-based rate limiting on every route; the credential path is tighter
    // still, because argon2 makes a login flood a CPU denial of service
    // (AD-23). Limits are env-tunable so tests can exercise both sides.
    ThrottlerModule.forRootAsync({
      imports: [],
      useFactory: () => ({
        throttlers: [
          {
            name: 'default',
            limit: requireIntEnv('API_RATE_LIMIT', 300),
            ttl: requireIntEnv('API_RATE_TTL_MS', 60_000),
          },
          {
            name: LOGIN_THROTTLER,
            limit: requireIntEnv('AUTH_RATE_LIMIT', 5),
            ttl: requireIntEnv('AUTH_RATE_TTL_MS', 60_000),
          },
          {
            // The parent credential routes get their own budget, so one
            // surface's flood cannot exhaust the other's allowance. It applies
            // only to handlers that mark themselves as spending it.
            name: PARENT_THROTTLER,
            limit: requireIntEnv('PARENT_AUTH_RATE_LIMIT', 5),
            ttl: requireIntEnv('PARENT_AUTH_RATE_TTL_MS', 60_000),
            skipIf: (context) =>
              Reflect.getMetadata(PARENT_CREDENTIAL_ROUTE, context.getHandler()) !== true,
          },
        ],
      }),
    }),
    PrismaModule,
    AdminModule,
    IdentityModule,
    // Sole owner and sole writer of SourceTest and PageImage, and sole owner of
    // image ingest (AD-17).
    SourceTestModule,
    // The only constructor of a provider client and the sole writer of
    // `ai_call` (AD-17, AD-20).
    AiModule,
    // Sole owner and sole writer of every extraction table, and the owner of
    // the extraction prompt (AD-17).
    ExtractionModule,
    // Sole owner and sole writer of every Practice Test table, and the owner of
    // the generation prompt (AD-17).
    PracticeTestModule,
    // Sole owner and sole writer of QuestionGrade (AD-6, AD-17), and the home of
    // handing in: closing an Attempt and recording what its blanks mean are one
    // transaction, so the route lives with the entity.
    GradingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*splat');
  }
}
