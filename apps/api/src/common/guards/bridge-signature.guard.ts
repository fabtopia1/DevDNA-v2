import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { verifySignature, hashIdentifier } from '@devdna/core';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto.service';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';

export interface BridgePrincipal {
  bridgeId: string;
  organizationId: string;
}

/**
 * Authenticates a DevDNA Bridge.
 *
 * Bridges run on shop-owned laptops we do not control, so a bearer token alone
 * is too weak: anyone who reads it off disk could forge inspection records for
 * that tenant. Every request must therefore carry an HMAC over
 *
 *   METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256(rawBody)
 *
 * which binds the credential to this exact request. A timestamp window bounds
 * replay, and a per-bridge nonce table eliminates it inside that window.
 */
@Injectable()
export class BridgeSignatureGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-devdna-bridge-token'] as string | undefined;
    const timestamp = request.headers['x-devdna-timestamp'] as string | undefined;
    const nonce = request.headers['x-devdna-nonce'] as string | undefined;
    const signature = request.headers['x-devdna-signature'] as string | undefined;

    if (!token || !timestamp || !nonce || !signature) {
      throw new UnauthorizedException('Bridge request is missing authentication headers');
    }

    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10));
    if (!Number.isFinite(skew) || skew > this.config.bridgeRequestSkewSeconds) {
      throw new UnauthorizedException('Bridge request timestamp is outside the accepted window');
    }

    const bridge = await this.prisma.bridgeRegistration.findUnique({
      where: { tokenHash: hashIdentifier(token) },
    });
    if (!bridge || bridge.revokedAt) {
      throw new UnauthorizedException('Unknown or revoked bridge');
    }

    // `rawBody` is captured by the JSON body parser; the signature must cover
    // the exact bytes received, not a re-serialisation of the parsed object.
    const rawBody: string = request.rawBody ?? JSON.stringify(request.body ?? {});
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const canonical = [
      request.method,
      request.originalUrl?.split('?')[0] ?? request.url,
      timestamp,
      nonce,
      bodyHash,
    ].join('\n');

    // A stored secret can fail to decrypt after an encryption-key rotation, or
    // if the row was seeded/imported with a placeholder. That is an
    // authentication failure for this bridge, not a server fault — returning
    // 500 would both leak an internal error and give a caller a way to
    // distinguish credential states.
    let secret: string;
    try {
      secret = this.crypto.decrypt(bridge.secretCiphertext);
    } catch {
      throw new UnauthorizedException('Bridge credentials must be re-issued');
    }

    if (!verifySignature(secret, canonical, signature)) {
      throw new UnauthorizedException('Bridge request signature is invalid');
    }

    // Nonce reuse inside the window is a replay. The unique constraint makes
    // this atomic under concurrency rather than a check-then-act race.
    try {
      await this.prisma.bridgeNonce.create({
        data: {
          bridgeId: bridge.id,
          nonce,
          expiresAt: new Date(Date.now() + this.config.bridgeRequestSkewSeconds * 2000),
        },
      });
    } catch {
      throw new UnauthorizedException('Bridge request nonce has already been used');
    }

    await this.prisma.bridgeRegistration.update({
      where: { id: bridge.id },
      data: { lastSeenAt: new Date() },
    });

    request.bridge = {
      bridgeId: bridge.id,
      organizationId: bridge.organizationId,
    } satisfies BridgePrincipal;
    return true;
  }
}
