import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
}

/**
 * The readiness gate. It reports healthy only once the database answers, so a
 * caller waiting on it is not let through to a dead Postgres.
 */
@Controller('health')
@SkipThrottle({ login: true })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async read(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', database: 'down' };
    }
  }
}
