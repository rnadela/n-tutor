import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { CorrelationIdMiddleware } from './common/correlation.js';
import { requireIntEnv } from './common/env.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';

export const LOGIN_THROTTLER = 'login';

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
        ],
      }),
    }),
    PrismaModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*splat');
  }
}
