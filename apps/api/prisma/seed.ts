import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  SIMULATOR_PROFILES,
  hashIdentifier,
  resolveDevice,
  runInspection,
} from '@devdna/core';

/**
 * Seeds a working demo tenant: one shop, three users, a paired bridge and one
 * inspection per simulator profile. The inspections run through the real
 * engine rather than being hand-written rows, so the dashboard, the filters
 * and the report generator all have realistic data on a fresh install.
 */
const prisma = new PrismaClient();

const DEMO_EMAIL = 'owner@demoshop.test';
const DEMO_PASSWORD = 'DevDNA-demo-2026';

async function main(): Promise<void> {
  const existing = await prisma.organization.findUnique({ where: { slug: 'demo-repair-co' } });
  if (existing) {
    console.log('Demo organization already present - removing and reseeding.');
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const identifierSalt = randomBytes(24).toString('hex');
  const organization = await prisma.organization.create({
    data: { name: 'Demo Repair Co', slug: 'demo-repair-co', plan: 'trial', identifierSalt },
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
    const snapshot = profile.build();
    const result = runInspection(snapshot, { udidSalt: identifierSalt });
    const identity = result.identity;
    const catalog = resolveDevice(identity.productType);

    const device = await prisma.device.upsert({
      where: {
        organizationId_udidHash: { organizationId: organization.id, udidHash: identity.udidHash },
      },
      create: {
        organizationId: organization.id,
        udidHash: identity.udidHash,
        productType: identity.productType,
        marketingName: catalog.marketingName,
        capacityGb: identity.marketingCapacityGb,
        regionCode: identity.regionCode,
        regionName: identity.regionName,
        inspectionCount: 1,
      },
      update: { inspectionCount: { increment: 1 }, lastSeenAt: new Date() },
    });

    await prisma.inspection.create({
      data: {
        organizationId: organization.id,
        deviceId: device.id,
        userId: created % 2 === 0 ? owner.id : technician.id,
        bridgeId: bridge.id,
        customerId: created === 1 ? customer.id : null,
        verificationStatus: result.trust.status,
        trustScore: result.trust.score,
        rawTrustScore: result.trust.rawScore,
        confidence: result.trust.confidence,
        batteryScore: result.battery.score,
        softwareScore: result.software.score,
        partsScore: result.parts.score,
        partsCoverage: result.parts.coverage,
        batteryHealthPercent: result.battery.maximumCapacityPercent?.value ?? null,
        batteryCycleCount: result.battery.cycleCount?.value ?? null,
        iosVersion: identity.iosVersion,
        buildVersion: identity.buildVersion,
        engineVersion: result.engineVersion,
        algorithmVersion: result.trust.algorithmVersion,
        snapshot: snapshot as never,
        result: result as never,
        capturedAt: new Date(snapshot.capturedAt),
        partResults: {
          create: result.parts.results.map((part) => ({
            component: part.component,
            verdict: part.verdict,
            confidence: part.confidence,
            weight: part.weight,
            rationale: part.rationale.slice(0, 1000),
          })),
        },
        findings: {
          create: result.findings.map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            title: finding.title.slice(0, 300),
            detail: finding.detail.slice(0, 2000),
            source: finding.source,
          })),
        },
      },
    });
    created += 1;
  }

  console.log(
    [
      '',
      'Seed complete.',
      `  organization  ${organization.name} (${organization.slug})`,
      `  inspections   ${created}`,
      '',
      '  Sign in with:',
      `    email     ${DEMO_EMAIL}`,
      `    password  ${DEMO_PASSWORD}`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
