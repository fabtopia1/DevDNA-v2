import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { hashIdentifier, SIMULATOR_PROFILES } from '@devdna/core';
import { PrismaService } from '../src/common/prisma.service';
import { AuditService } from '../src/common/audit.service';
import { CryptoService } from '../src/common/crypto.service';
import { InspectionsService } from '../src/modules/inspections/inspections.service';
import { loadConfiguration } from '../src/config/configuration';

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
  const prisma = new PrismaService();
  await prisma.$connect();
  const inspections = new InspectionsService(
    prisma,
    new AuditService(prisma),
    new CryptoService(),
    loadConfiguration(),
  );

  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  try {
    const existing = await prisma.organization.findUnique({ where: { slug: 'demo-repair-co' } });
    if (existing) {
      log('Demo organization already present - removing and reseeding.');
      await prisma.organization.delete({ where: { id: existing.id } });
    }

    const organization = await prisma.organization.create({
      data: {
        name: 'Demo Repair Co',
        slug: 'demo-repair-co',
        plan: 'trial',
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
        '  Sign in with:',
        `    email     ${DEMO_EMAIL}`,
        `    password  ${DEMO_PASSWORD}`,
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
