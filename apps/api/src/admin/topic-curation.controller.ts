import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminAuthGuard, type AdminRequest } from './admin-auth.guard.js';
import { MergeTopicDto, RenameTopicDto } from './dto/topic-curation.dto.js';
import {
  TopicCurationService,
  type CanonicalTopicEntry,
  type ProvisionalTopicEntry,
  type TopicMergeResult,
} from './topic-curation.service.js';

/**
 * The Topic curation routes: the provisional queue, one Subject's canonical set, and
 * the three actions an operator may take on a Topic.
 *
 * The same guard, throttle exemption and pipe set every other Admin route uses.
 * `AdminAuthGuard` runs before the handler, so an unauthenticated request is refused
 * before a single Topic is read — which is the point of it being a guard rather than
 * a check inside each method.
 *
 * `GET subjects/:subjectId` is declared **above** the `:id` routes: a literal segment
 * and a parameter segment both match `subjects`, and Nest resolves in declaration
 * order.
 *
 * Nothing here decides anything. Every refusal and every write is
 * `TopicCurationService`'s, and this file's whole job is the wire: the guard, the
 * uuid pipes, the validated bodies and the actor.
 */
@Controller('admin/topics')
@UseGuards(AdminAuthGuard)
@SkipThrottle({ login: true })
export class TopicCurationController {
  constructor(private readonly curation: TopicCurationService) {}

  @Get('provisional')
  listProvisional(): Promise<ProvisionalTopicEntry[]> {
    return this.curation.listProvisional();
  }

  @Get('subjects/:subjectId')
  listForSubject(
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<CanonicalTopicEntry[]> {
    return this.curation.listForSubject(subjectId);
  }

  @Post(':id/confirm')
  confirm(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CanonicalTopicEntry> {
    return this.curation.confirm(actor(req), id);
  }

  @Patch(':id/name')
  rename(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTopicDto,
  ): Promise<CanonicalTopicEntry> {
    return this.curation.rename(actor(req), id, dto.name);
  }

  @Post(':id/merge')
  merge(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeTopicDto,
  ): Promise<TopicMergeResult> {
    return this.curation.merge(actor(req), id, dto.targetTopicId);
  }
}

function actor(req: AdminRequest): string {
  return req.admin!.adminUserId;
}
