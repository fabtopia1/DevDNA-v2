import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AuthenticatedUser } from './decorators';
import { PrismaService } from './prisma.service';
import { CONFIG_TOKEN, type AppConfig } from '../config/configuration';

/**
 * Development authentication bypass.
 *
 * Enabled with `DEV_AUTH_BYPASS=true`, and only outside production — the config
 * loader refuses to boot if the two are combined.
 *
 * Everything about the bypass lives here rather than being scattered through
 * the guards, so that "what does bypass mode actually change?" has exactly one
 * answer, and so removing it later is deleting one file plus three call sites.
 */

export const DEV_USER_ID = 'dev-user';
export const DEV_ORGANIZATION_ID = 'devdna-demo-2026';

/**
 * The fake principal injected in place of a verified token.
 *
 * `role: ADMIN` is the enum form of the requested `"admin"`. Note it does not
 * satisfy an `@Roles('OWNER')` route — none exist today, but a future
 * owner-only endpoint will 403 under bypass rather than silently pass, which is
 * the right way round.
 */
export const DEV_PRINCIPAL: AuthenticatedUser = {
  userId: DEV_USER_ID,
  organizationId: DEV_ORGANIZATION_ID,
  email: 'test@devdna.local',
  role: 'ADMIN',
};

export const DEV_USER_NAME = 'DevDNA Test User';
export const DEV_ORGANIZATION_NAME = 'DevDNA Development Workspace';

/**
 * Fixed rather than random.
 *
 * Device rows are keyed by a per-tenant salted hash of the UDID. A salt
 * regenerated on every boot would make the same simulated handset appear as a
 * new device after each restart, and the device history views would never
 * populate. Constant-in-development is the correct trade; this value is never
 * used by a real tenant.
 */
const DEV_IDENTIFIER_SALT = 'dev-auth-bypass-fixed-salt-not-for-production';

/**
 * Deliberately not a valid Argon2 encoded hash.
 *
 * `AuthService.login` verifies with `.catch(() => false)`, so a malformed hash
 * fails closed: the dev account cannot be signed into with any password, even
 * if the login route is reachable.
 */
const UNUSABLE_PASSWORD_HASH = '!dev-auth-bypass-account-has-no-password';

@Injectable()
export class DevAuthService implements OnModuleInit {
  private readonly logger = new Logger('DevAuth');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.devAuthBypass) return;
    await this.ensureTenant();
  }

  /**
   * The injected principal has to correspond to rows that exist.
   *
   * Tenancy is structural here: every query filters on `organizationId`, and
   * `Inspection.userId` is a foreign key. A principal pointing at ids with no
   * rows behind them would give an empty dashboard and a foreign-key error the
   * first time a report was generated — which reads as "the app is broken"
   * rather than "the dev tenant was never created".
   */
  async ensureTenant(): Promise<void> {
    await this.prisma.organization.upsert({
      where: { id: DEV_ORGANIZATION_ID },
      update: {},
      create: {
        id: DEV_ORGANIZATION_ID,
        name: DEV_ORGANIZATION_NAME,
        slug: 'devdna-development',
        plan: 'development',
        identifierSalt: DEV_IDENTIFIER_SALT,
      },
    });

    await this.prisma.user.upsert({
      where: { id: DEV_USER_ID },
      update: { disabledAt: null },
      create: {
        id: DEV_USER_ID,
        organizationId: DEV_ORGANIZATION_ID,
        email: DEV_PRINCIPAL.email,
        name: DEV_USER_NAME,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        role: DEV_PRINCIPAL.role,
      },
    });

    const inspections = await this.prisma.inspection.count({
      where: { organizationId: DEV_ORGANIZATION_ID },
    });

    this.logger.warn('════════════════════════════════════════════════════════');
    this.logger.warn('  DEV_AUTH_BYPASS is ON — authentication is DISABLED');
    this.logger.warn(`  every request runs as ${DEV_PRINCIPAL.email} (${DEV_PRINCIPAL.role})`);
    this.logger.warn(`  workspace ${DEV_ORGANIZATION_ID} · ${inspections} inspection(s)`);
    if (inspections === 0) {
      this.logger.warn('  no data in this workspace yet — run: pnpm seed');
    }
    this.logger.warn('════════════════════════════════════════════════════════');
  }
}
