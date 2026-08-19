import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashIdentifier } from '@devdna/core';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { AuditService } from '../../common/audit.service';

@Injectable()
export class BridgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Pair a workstation.
   *
   * The token and HMAC secret are returned exactly once. The token is stored
   * hashed (we only ever compare it) and the secret encrypted (we must be able
   * to recompute signatures) — see `CryptoService` for why the two differ.
   */
  async pair(organizationId: string, actorId: string, input: { name: string; workstation?: string }) {
    const token = `dbt_${randomBytes(24).toString('base64url')}`;
    const secret = randomBytes(32).toString('base64url');

    const bridge = await this.prisma.bridgeRegistration.create({
      data: {
        organizationId,
        name: input.name,
        workstation: input.workstation ?? null,
        tokenHash: hashIdentifier(token),
        secretCiphertext: this.crypto.encrypt(secret),
      },
    });

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId,
      action: 'bridge.paired',
      entity: 'BridgeRegistration',
      entityId: bridge.id,
      metadata: { name: input.name },
    });

    return {
      id: bridge.id,
      name: bridge.name,
      // Shown once. There is no endpoint that can return these again.
      token,
      secret,
      setup: {
        env: {
          DEVDNA_API_URL: '<your api base url>',
          DEVDNA_BRIDGE_TOKEN: token,
          DEVDNA_BRIDGE_SECRET: secret,
        },
        command: 'devdna-bridge serve',
      },
    };
  }

  async list(organizationId: string) {
    const bridges = await this.prisma.bridgeRegistration.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        workstation: true,
        platform: true,
        version: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        _count: { select: { inspections: true } },
      },
    });
    return bridges.map((bridge) => ({
      ...bridge,
      inspectionCount: bridge._count.inspections,
      _count: undefined,
      online: bridge.lastSeenAt ? Date.now() - bridge.lastSeenAt.getTime() < 120_000 : false,
    }));
  }

  async revoke(organizationId: string, actorId: string, bridgeId: string) {
    const bridge = await this.prisma.bridgeRegistration.findFirst({
      where: { id: bridgeId, organizationId },
    });
    if (!bridge) throw new NotFoundException('Bridge not found');

    await this.prisma.bridgeRegistration.update({
      where: { id: bridgeId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId,
      action: 'bridge.revoked',
      entity: 'BridgeRegistration',
      entityId: bridgeId,
    });
    return { ok: true };
  }

  /** Housekeeping for the nonce replay table. Called by a scheduled job. */
  async pruneNonces(): Promise<number> {
    const { count } = await this.prisma.bridgeNonce.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }
}
