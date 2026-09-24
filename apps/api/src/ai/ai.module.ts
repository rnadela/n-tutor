import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';

/**
 * The `ai` module: the only constructor of a provider client and the sole
 * owner and sole writer of `ai_call` (AD-17, AD-20).
 *
 * One provider, one place. A domain module imports this and hands over a typed
 * request; it never sees an SDK type, a model id, a retry policy or an API key,
 * and it never writes a cost row. The prompt text is the one carve-out and
 * stays in the domain module that owns the question being asked.
 *
 * No controller: nothing about an AI call is a route. No imports: Prisma is
 * global, and this module reads nothing else.
 */
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
