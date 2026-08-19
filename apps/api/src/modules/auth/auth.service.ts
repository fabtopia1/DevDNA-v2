import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { hashIdentifier } from '@devdna/core';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import type { InviteUserDto, LoginDto, RegisterDto } from './dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Argon2id parameters. Deliberately above the library defaults: the entire
 * value of this product rests on inspection records being attributable, and a
 * stolen password database is the cheapest route to forging them.
 */
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto, context: { ip?: string; userAgent?: string } = {}) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const slug = await this.uniqueSlug(dto.organizationName);
    const passwordHash = await argon2.hash(dto.password, ARGON_OPTIONS);

    const { organization, user } = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          slug,
          // Per-tenant salt: the same handset must not hash identically across
          // two shops, or one could confirm the other handled a given device.
          identifierSalt: randomBytes(24).toString('hex'),
        },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: dto.email.toLowerCase(),
          name: dto.name,
          passwordHash,
          role: 'OWNER',
        },
      });
      return { organization, user };
    });

    await this.audit.record({
      organizationId: organization.id,
      actorType: 'USER',
      actorId: user.id,
      action: 'organization.created',
      entity: 'Organization',
      entityId: organization.id,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const tokens = await this.issueTokens(user.id, organization.id, user.email, user.role, context);
    return { organization: { id: organization.id, name: organization.name, slug }, user: publicUser(user), ...tokens };
  }

  async login(dto: LoginDto, context: { ip?: string; userAgent?: string } = {}) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });

    // Verify against a dummy hash when the user is unknown so response timing
    // does not disclose whether an email is registered.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await argon2.verify(hash, dto.password).catch(() => false);

    if (!user || !valid || user.disabledAt) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      organizationId: user.organizationId,
      actorType: 'USER',
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const tokens = await this.issueTokens(user.id, user.organizationId, user.email, user.role, context);
    return { user: publicUser(user), ...tokens };
  }

  async refresh(refreshToken: string, context: { ip?: string; userAgent?: string } = {}) {
    let payload: { sub: string; org: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.jwt.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Invalid refresh token');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashIdentifier(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.disabledAt) throw new UnauthorizedException('Account is disabled');

    // Rotate on every use: a refresh token replayed after rotation is a strong
    // signal of theft, and the revoked row makes that detectable.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user.id, user.organizationId, user.email, user.role, context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken
      .updateMany({
        where: { tokenHash: hashIdentifier(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async invite(organizationId: string, actorId: string, dto: InviteUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        organizationId,
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash: await argon2.hash(dto.password, ARGON_OPTIONS),
        role: (dto.role ?? 'TECHNICIAN') as UserRole,
      },
    });

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId,
      action: 'user.invited',
      entity: 'User',
      entityId: user.id,
      metadata: { role: user.role },
    });

    return publicUser(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: { select: { id: true, name: true, slug: true, plan: true, logoUrl: true } } },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return { ...publicUser(user), organization: user.organization };
  }

  private async issueTokens(
    userId: string,
    organizationId: string,
    email: string,
    role: UserRole,
    context: { ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, org: organizationId, email, role, typ: 'access' },
      { secret: this.config.jwt.accessSecret, expiresIn: this.config.jwt.accessTtlSeconds },
    );
    const refreshToken = await this.jwt.signAsync(
      // `jti` is not decoration: without it two tokens minted for the same user
      // within one second serialise identically, collide on tokenHash, and the
      // second refresh fails.
      { sub: userId, org: organizationId, typ: 'refresh', jti: randomBytes(16).toString('hex') },
      { secret: this.config.jwt.refreshSecret, expiresIn: this.config.jwt.refreshTtlSeconds },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        // Only the hash is stored, so a database read cannot mint sessions.
        tokenHash: hashIdentifier(refreshToken),
        expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlSeconds * 1000),
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 400) ?? null,
      },
    });

    return { accessToken, refreshToken, expiresIn: this.config.jwt.accessTtlSeconds };
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'shop';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt}`;
      const clash = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }
}

/** Argon2id hash of a random value, used to equalise failed-login timing. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$H3pNJ1w0kM3ThFYQMkOZQx0YkOhbXHkVOZm5Kk1nZ2E';

const publicUser = (user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  lastLoginAt?: Date | null;
}) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  organizationId: user.organizationId,
  lastLoginAt: user.lastLoginAt ?? null,
});
