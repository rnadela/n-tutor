import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { requireEnv } from '../common/env.js';

/**
 * The transaction-scoped client handed to every write path. Cross-module and
 * cross-service write methods take this as their first parameter so a write and
 * its audit row share one transaction (AD-25).
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$transaction' | '$extends' | '$on' | '$use'
>;

/** PrismaClient is constructed with a driver adapter, never bare (AD-7). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Runs `fn` inside one interactive transaction. */
  withTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction((tx) => fn(tx as TransactionClient));
  }
}
