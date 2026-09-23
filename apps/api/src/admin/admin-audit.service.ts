import { Injectable } from '@nestjs/common';
import type { TransactionClient } from '../prisma/prisma.service.js';

/** Redacted metadata only — never child content (AD-20, AD-25). */
export type AuditDetail = Record<string, string | number | boolean | null>;

/** Used as the actor on an audit row written before any operator is identified. */
export const ANONYMOUS_ACTOR = 'anonymous';

export type AuditAction =
  | 'subject.create'
  | 'subject.rename'
  | 'subject.enable'
  | 'subject.disable'
  | 'gradeLevel.create'
  | 'gradeLevel.rename'
  | 'gradeLevel.enable'
  | 'gradeLevel.disable'
  | 'availability.enable'
  | 'availability.disable'
  | 'auth.signIn.failed';

@Injectable()
export class AdminAuditService {
  /**
   * Writes one audit row using the caller's transaction client, so the audit
   * row and the write it describes commit or roll back together.
   */
  async record(
    tx: TransactionClient,
    actorId: string,
    action: AuditAction,
    targetType: string,
    targetId: string,
    detail: AuditDetail = {},
  ): Promise<void> {
    await tx.adminAudit.create({
      data: { actorId, action, targetType, targetId, detail },
    });
  }
}
