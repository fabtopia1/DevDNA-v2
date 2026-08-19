import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { hashIdentifier, SIMULATOR_PROFILES } from '@devdna/core';
import { PrismaService } from '../src/common/prisma.service';
import { AuditService } from '../src/common/audit.service';
import { CryptoService } from '../src/common/crypto.service';
import { InspectionsService } from '../src/modules/inspections/inspections.service';
import { loadConfiguration } from '../src/config/configuration';
import {
  DEV_ORGANIZATION_ID,
  DEV_ORGANIZATION_NAME,
  DEV_PRINCIPAL,
  DEV_USER_ID,
  DEV_USER_NAME,
} from '../src/common/dev-auth';

/**
 * Seeds a working demo tenant.
 *
 * Inspections go through `InspectionsService.ingest`, the same path a real
 * bridge submission takes, rather than hand-inserting rows. Seed data that
 * shortcuts the production write path drifts from it, and then the dashboard
 * looks right on demo data and wrong on real data.
 *
 * The service is constructed directly rather than resolved from the Nest
 * container: the seed runs under a transpiler that does not emit decorator
 * metadata, and wiring three constructor arguments by hand is a smaller price
 * than a second build pipeline for one script.
 */
const DEMO_EMAIL = 'owner@demoshop.test';
const DEMO_PASSWORD = 'DevDNA-demo-2026';

async function main(): Promise<void> {
  const config = loadConfiguration();
  const prisma = new PrismaService();
  await prisma.$connect();
  const inspections = new InspectionsService(
    prisma,
    new AuditService(prisma),
    new CryptoService(),
    config,
  );

  // Under DEV_AUTH_BYPASS the injected principal names a specific organization
  // and user. Seeding into that same workspace is what makes the bypass useful:
  // seeding elsewhere would leave the dev user staring at an empty dashboard
  // and looking for a bug that is not there.
  const devMode = config.devAuthBypass;
  const slug = devMode ? 'devdna-development' : 'demo-repair-co';

  // Both seed workspaces are cleared, not just the one being written.
  //
  // User.email is globally unique rather than unique per organization, so
  // leaving the other seeded workspace in place makes the second `pnpm seed`
  // collide on owner@demoshop.test. Seeding is a reset: you get one seeded
  // workspace, in whichever mode you asked for.
  const SEED_SLUGS = ['demo-repair-co', 'devdna-development'];

  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  try {
    const stale = await prisma.organization.findMany({
      where: { slug: { in: SEED_SLUGS } },
      select: { id: true, slug: true },
    });
    for (const organization of stale) {
      log(`Removing existing seed workspace "${organization.slug}".`);
      await prisma.organization.delete({ where: { id: organization.id } });
    }

    const organization = await prisma.organization.create({
      data: {
        // A fixed id in dev mode so the seeded workspace is the one the
        // bypassed principal points at.
        ...(devMode ? { id: DEV_ORGANIZATION_ID } : {}),
        name: devMode ? DEV_ORGANIZATION_NAME : 'Demo Repair Co',
        slug,
        plan: devMode ? 'development' : 'trial',
        identifierSalt: randomBytes(24).toString('hex'),
      },
    });

    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
    const owner = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: DEMO_EMAIL,
        name: 'Sam Okafor',
        passwordHash,
        role: 'OWNER',
      },
    });
    const technician = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: 'tech@demoshop.test',
        name: 'Priya Raman',
        passwordHash,
        role: 'TECHNICIAN',
      },
    });
    await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: 'viewer@demoshop.test',
        name: 'Jordan Blake',
        passwordHash,
        role: 'VIEWER',
      },
    });

    // Deleting the organization above cascades to its users, so the bypass
    // account is recreated here rather than relying on the API's boot-time
    // upsert having already run.
    if (devMode) {
      await prisma.user.create({
        data: {
          id: DEV_USER_ID,
          organizationId: organization.id,
          email: DEV_PRINCIPAL.email,
          name: DEV_USER_NAME,
          // Not a valid Argon2 hash: this account can never be signed into.
          passwordHash: '!dev-auth-bypass-account-has-no-password',
          role: DEV_PRINCIPAL.role,
        },
      });
    }

    const bridge = await prisma.bridgeRegistration.create({
      data: {
        organizationId: organization.id,
        name: 'Counter workstation 1',
        workstation: 'BENCH-01',
        platform: 'darwin',
        version: '0.1.0',
        tokenHash: hashIdentifier('dbt_demo_seed_token'),
        // Seed data only - a real pairing encrypts a freshly generated secret.
        secretCiphertext: 'v1.seed.seed.seed',
        lastSeenAt: new Date(),
      },
    });

    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        name: 'Northbridge Wholesale',
        email: 'buying@northbridge.test',
        reference: 'NB-4471',
      },
    });

    let created = 0;
    for (const profile of SIMULATOR_PROFILES) {
      const result = await inspections.ingest({
        organizationId: organization.id,
        userId: created % 2 === 0 ? owner.id : technician.id,
        bridgeId: bridge.id,
        customerId: created === 1 ? customer.id : null,
        snapshot: profile.build(),
        workstation: 'BENCH-01',
      });
      log(
        `  ${profile.id.padEnd(24)} ${result.report.trust.verdict.padEnd(22)} ` +
          `score ${String(result.report.trust.score).padStart(3)}  ` +
          `${result.report.evidence.length} evidence records`,
      );
      created += 1;
    }

    const evidenceCount = await prisma.evidenceRecordRow.count();
    const inferenceCount = await prisma.inferenceRow.count();

    process.stdout.write(
      [
        '',
        'Seed complete.',
        `  organization  ${organization.name} (${organization.slug})`,
        `  inspections   ${created}`,
        `  evidence      ${evidenceCount} records, ${inferenceCount} inferences`,
        '',
        ...(devMode
          ? [
              '  DEV_AUTH_BYPASS is on — no sign-in required.',
              `    acting as  ${DEV_PRINCIPAL.email} (${DEV_PRINCIPAL.role})`,
              `    workspace  ${DEV_ORGANIZATION_ID}`,
            ]
          : ['  Sign in with:', `    email     ${DEMO_EMAIL}`, `    password  ${DEMO_PASSWORD}`]),
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
