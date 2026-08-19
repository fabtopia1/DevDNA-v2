import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface AuditEntry {
  organizationId: string;
  actorType: 'USER' | 'BRIDGE' | 'SYSTEM' | 'ANONYMOUS';
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail.
 *
 * Inspections underwrite commercial decisions — a shop pays less for a handset
 * because DevDNA flagged a display. When that is disputed months later, "who
 * ran this, from which workstation, and when" has to be answerable. Writes are
 * best-effort by design: an audit failure must never fail the user's action,
 * but it is logged loudly so the gap is visible.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 400) ?? null,
          metadata: (entry.metadata ?? {}) as never,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${entry.action} on ${entry.entity}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
