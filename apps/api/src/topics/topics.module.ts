import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { TopicService } from './topic.service.js';

/**
 * The `topics` module: sole owner and sole writer of `Topic` (AD-11, AD-17).
 *
 * One import and one provider. `AiModule` for the two things this module may not
 * do itself — embed a label and make a structured-output call — and nothing else:
 * `Subject` is read through the global Prisma module read-only, and `admin`,
 * which owns Subject, is deliberately not imported, because a canonical set has no
 * business reaching into the taxonomy's write path.
 *
 * **No controller.** Nothing about canonicalization is a route in this story: the
 * provisional queue, the confirm, the merge and the rename are Story 7.6, and an
 * endpoint added ahead of them would be a surface with no one to serve.
 *
 * `TopicService` is exported because Story 7.2's Mastery computation is the caller
 * this exists for. Nothing imports it yet, and it is registered anyway rather than
 * left until there is a caller: a module that is not in this list is a module
 * whose boot never fails, and the failure that matters — a missing provider, a
 * cycle, a bad config — should happen at boot rather than on the first label.
 */
@Module({
  imports: [AiModule],
  providers: [TopicService],
  exports: [TopicService],
})
export class TopicsModule {}
