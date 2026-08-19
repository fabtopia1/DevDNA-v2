import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request from 'supertest';
import { buildSimulatedSnapshot, signPayload, type RawDeviceSnapshot } from '@devdna/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

/** Sign an ingest request exactly the way the bridge does. */
function signedHeaders(
  token: string,
  secret: string,
  body: string,
  overrides: { nonce?: string; timestamp?: string } = {},
) {
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = overrides.nonce ?? randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = ['POST', '/v1/inspections/ingest', timestamp, nonce, bodyHash].join('\n');
  return {
    'content-type': 'application/json',
    'x-devdna-bridge-token': token,
    'x-devdna-timestamp': timestamp,
    'x-devdna-nonce': nonce,
    'x-devdna-signature': signPayload(secret, canonical),
  };
}

const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@test.example`;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(
    express.json({
      limit: '8mb',
      verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('health', () => {
  it('reports the engine version and database state', async () => {
    const response = await http.get('/health').expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.database).toBe('up');
    expect(response.body.engineVersion).toBeTruthy();
  });
});

describe('full inspection lifecycle', () => {
  let accessToken: string;
  let organizationId: string;
  let bridgeToken: string;
  let bridgeSecret: string;
  let inspectionId: string;
  let reportId: string;
  let publicId: string;

  it('registers an organization and its owner', async () => {
    const response = await http
      .post('/v1/auth/register')
      .send({
        organizationName: 'E2E Repairs',
        name: 'Test Owner',
        email: uniqueEmail('owner'),
        password: 'a-long-enough-password',
      })
      .expect(201);

    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.user.role).toBe('OWNER');
    accessToken = response.body.accessToken;
    organizationId = response.body.organization.id;
  });

  it('rejects a short password', async () => {
    await http
      .post('/v1/auth/register')
      .send({
        organizationName: 'Too Weak',
        name: 'Nope',
        email: uniqueEmail('weak'),
        password: 'short',
      })
      .expect(400);
  });

  it('refuses unauthenticated access to tenant data', async () => {
    await http.get('/v1/inspections').expect(401);
    await http.get('/v1/dashboard/summary').expect(401);
  });

  it('pairs a bridge and returns one-time credentials', async () => {
    const response = await http
      .post('/v1/bridges')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bench 1', workstation: 'E2E-BENCH' })
      .expect(201);

    expect(response.body.token).toMatch(/^dbt_/);
    expect(response.body.secret).toBeTruthy();
    bridgeToken = response.body.token;
    bridgeSecret = response.body.secret;
  });

  it('ingests a signed snapshot and scores it server-side', async () => {
    const snapshot = buildSimulatedSnapshot('serviced-14-pro');
    const body = JSON.stringify({ snapshot, workstation: 'E2E-BENCH' });

    const response = await http
      .post('/v1/inspections/ingest')
      .set(signedHeaders(bridgeToken, bridgeSecret, body))
      .send(body)
      .expect(201);

    expect(response.body.id).toBeTruthy();
    expect(response.body.report.device.marketingName).toBe('iPhone 14 Pro');
    expect(response.body.report.trust.score).toBeGreaterThan(0);
    expect(response.body.report.provenanceViolations).toEqual([]);
    inspectionId = response.body.id;
  });

  it('ignores a trust score claimed by the bridge and re-scores the raw snapshot', async () => {
    const snapshot = buildSimulatedSnapshot('counterfeit-display-13');
    // A compromised bridge claims a perfect device. The server must not care.
    const forged = {
      snapshot,
      result: {
        engineVersion: '9.9.9',
        inspectedAt: new Date().toISOString(),
        trust: {
          score: 100,
          rawScore: 100,
          confidence: 1,
          coverage: 1,
          verdict: 'TRUSTED',
          pillars: [],
          gatesApplied: [],
          algorithmVersion: '9.9.9',
        },
      },
    };
    const body = JSON.stringify(forged);

    const response = await http
      .post('/v1/inspections/ingest')
      .set(signedHeaders(bridgeToken, bridgeSecret, body))
      .send(body)
      .expect(201);

    expect(response.body.report.trust.score).toBeLessThan(60);
    expect(response.body.report.trust.verdict).toBe('UNTRUSTED');

    const stored = await prisma.inspection.findUnique({ where: { id: response.body.id } });
    expect(stored?.trustScore).toBe(response.body.report.trust.score);
    expect(stored?.trustVerdict).toBe('UNTRUSTED');
  });

  it('rejects a tampered signature', async () => {
    const body = JSON.stringify({ snapshot: buildSimulatedSnapshot('pristine-15-pro') });
    const headers = signedHeaders(bridgeToken, 'wrong-secret', body);
    await http.post('/v1/inspections/ingest').set(headers).send(body).expect(401);
  });

  it('rejects a bridge whose stored secret can no longer be decrypted', async () => {
    // Simulates an encryption-key rotation or an imported placeholder row.
    const bridge = await prisma.bridgeRegistration.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const original = bridge!.secretCiphertext;
    await prisma.bridgeRegistration.update({
      where: { id: bridge!.id },
      data: { secretCiphertext: 'v1.not.real.ciphertext' },
    });

    const body = JSON.stringify({ snapshot: buildSimulatedSnapshot('pristine-15-pro') });
    const response = await http
      .post('/v1/inspections/ingest')
      .set(signedHeaders(bridgeToken, bridgeSecret, body))
      .send(body);
    expect(response.status).toBe(401);

    await prisma.bridgeRegistration.update({
      where: { id: bridge!.id },
      data: { secretCiphertext: original },
    });
  });

  it('rejects a replayed nonce', async () => {
    const body = JSON.stringify({ snapshot: buildSimulatedSnapshot('pristine-15-pro') });
    const nonce = randomUUID();
    const headers = signedHeaders(bridgeToken, bridgeSecret, body, { nonce });

    await http.post('/v1/inspections/ingest').set(headers).send(body).expect(201);
    await http.post('/v1/inspections/ingest').set(headers).send(body).expect(401);
  });

  it('rejects a stale timestamp', async () => {
    const body = JSON.stringify({ snapshot: buildSimulatedSnapshot('pristine-15-pro') });
    const stale = (Math.floor(Date.now() / 1000) - 4000).toString();
    const headers = signedHeaders(bridgeToken, bridgeSecret, body, { timestamp: stale });
    await http.post('/v1/inspections/ingest').set(headers).send(body).expect(401);
  });

  it('encrypts identifying evidence at rest but keeps it reproducible', async () => {
    const row = await prisma.evidenceRecordRow.findFirst({
      where: { inspectionId, key: 'SerialNumber' },
    });
    // Stored encrypted, so a database read yields no identifier...
    expect(row?.value).toHaveProperty('__enc');
    expect(JSON.stringify(row?.value)).not.toContain('FK2Q7WXYZ1');

    // ...and masked again on the way out of the API.
    const served = await http
      .get(`/v1/inspections/${inspectionId}/evidence?subject=DEVICE`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    const serial = served.body.evidence.find((r: { key: string }) => r.key === 'SerialNumber');
    expect(serial.value).toMatch(/^\*+/);
    expect(serial.value).toContain('YZ1');
  });

  it('strips raw identifiers from the stored snapshot by default', async () => {
    const stored = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    const snapshot = stored?.snapshot as unknown as RawDeviceSnapshot;
    expect(snapshot.lockdown['UniqueDeviceID']).toBe('[redacted]');
    expect(snapshot.lockdown['SerialNumber']).toBe('[redacted]');
    // The salted hash is what identifies the device instead.
    const device = await prisma.device.findFirst({ where: { id: stored?.deviceId } });
    expect(device?.udidHash).toHaveLength(64);
    expect(device?.udid).toBeNull();
  });

  it('persists evidence as rows, separately from every conclusion', async () => {
    const [evidence, inferences, verdicts, components, audit] = await Promise.all([
      prisma.evidenceRecordRow.findMany({ where: { inspectionId } }),
      prisma.inferenceRow.findMany({ where: { inspectionId } }),
      prisma.moduleVerdictRow.findMany({ where: { inspectionId } }),
      prisma.componentServiceRow.findMany({ where: { inspectionId } }),
      prisma.auditEntryRow.findMany({ where: { inspectionId }, orderBy: { sequence: 'asc' } }),
    ]);

    expect(evidence.length).toBeGreaterThan(20);
    expect(inferences.length).toBeGreaterThan(0);
    expect(verdicts.length).toBeGreaterThan(0);
    expect(components.length).toBeGreaterThan(0);
    expect(audit.length).toBeGreaterThan(10);

    // Every record carries full provenance.
    for (const record of evidence) {
      expect(record.sourceAuthority).toBeTruthy();
      expect(record.method).toBeTruthy();
      expect(record.collector).toBeTruthy();
      expect(record.reliability).toBeGreaterThan(0);
    }

    // Every inference points at evidence that is actually stored.
    const evidenceIds = new Set(evidence.map((e) => e.evidenceId));
    for (const inference of inferences) {
      expect(inference.evidenceIds.length).toBeGreaterThan(0);
      for (const id of inference.evidenceIds) expect(evidenceIds.has(id)).toBe(true);
    }

    // Every determined verdict points at inferences that are actually stored.
    const inferenceIds = new Set(inferences.map((i) => i.inferenceId));
    for (const verdict of verdicts.filter((v) => v.determinacy === 'DETERMINED')) {
      expect(verdict.inferenceIds.length).toBeGreaterThan(0);
      for (const id of verdict.inferenceIds) expect(inferenceIds.has(id)).toBe(true);
    }

    // The audit trail is ordered and gap-free.
    expect(audit.map((e) => e.sequence)).toEqual(audit.map((_, i) => i + 1));
  });

  it('serves evidence on its own route, never folded into the conclusions', async () => {
    const conclusions = await http
      .get(`/v1/inspections/${inspectionId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    // The detail route carries verdicts, not raw observations.
    expect(conclusions.body.evidence).toBeUndefined();
    expect(conclusions.body.components.length).toBeGreaterThan(0);

    const evidence = await http
      .get(`/v1/inspections/${inspectionId}/evidence`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(evidence.body.evidence.length).toBeGreaterThan(20);
    expect(evidence.body.ledgerDigest).toHaveLength(64);

    const filtered = await http
      .get(`/v1/inspections/${inspectionId}/evidence?subject=BATTERY`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(filtered.body.evidence.every((r: { subject: string }) => r.subject === 'BATTERY')).toBe(true);
  });

  it('exposes the ordered audit trail for a stored inspection', async () => {
    const audit = await http
      .get(`/v1/inspections/${inspectionId}/audit`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(audit.body.length).toBeGreaterThan(10);
    expect(audit.body[0].sequence).toBe(1);
    expect(audit.body.map((e: { action: string }) => e.action)).toContain('VERDICT_CONCLUDED');
  });

  it('lists and filters inspections', async () => {
    const list = await http
      .get('/v1/inspections?page=1&pageSize=10')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect(list.body.items[0].device.marketingName).toBeTruthy();

    const untrusted = await http
      .get('/v1/inspections?verdict=UNTRUSTED')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(untrusted.body.items.every((i: { trustVerdict: string }) => i.trustVerdict === 'UNTRUSTED')).toBe(true);

    // Fleet analytics the trade actually asks for, as plain SQL.
    const replacedDisplays = await http
      .get('/v1/inspections?replacedComponent=DISPLAY')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(replacedDisplays.body.total).toBeGreaterThan(0);
  });

  it('returns full inspection detail with evidence', async () => {
    const detail = await http
      .get(`/v1/inspections/${inspectionId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(detail.body.components.length).toBeGreaterThan(0);
    expect(detail.body.verdicts.length).toBeGreaterThan(0);
    expect(detail.body.findings.length).toBeGreaterThan(0);
    expect(detail.body.bridge.workstation).toBe('E2E-BENCH');
    // Every finding declares what it rests on.
    for (const finding of detail.body.findings) {
      expect(['EVIDENCE', 'ABSENCE']).toContain(finding.basis);
      if (finding.basis === 'ABSENCE') {
        expect(finding.evidenceIds).toEqual([]);
        expect(finding.inferenceIds).toEqual([]);
      }
    }
  });

  it('generates a downloadable PDF report', async () => {
    const generated = await http
      .post(`/v1/inspections/${inspectionId}/report`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(generated.body.publicId).toHaveLength(12);
    expect(generated.body.checksum).toHaveLength(64);
    reportId = generated.body.id;
    publicId = generated.body.publicId;

    const download = await http
      .get(`/v1/reports/${reportId}/download`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    const pdf = download.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(generated.body.checksum);
  });

  it('verifies a report publicly without leaking device identifiers', async () => {
    const verified = await http.get(`/v1/verify/${publicId}`).expect(200);

    expect(verified.body.valid).toBe(true);
    expect(verified.body.device.model).toBe('iPhone 14 Pro');
    expect(verified.body.verdict.trustScore).toBeGreaterThan(0);
    // A recipient can ask the issuer to reproduce this verdict from the same
    // evidence, and any edit to that evidence changes the digest.
    expect(verified.body.evidenceLedgerDigest).toHaveLength(64);
    // Components DevDNA could not assess are counted, never silently omitted.
    expect(typeof verified.body.notAssessed).toBe('number');

    // A stranger scanning the QR code must not receive identifying data.
    const payload = JSON.stringify(verified.body);
    expect(payload).not.toMatch(/udid/i);
    expect(payload).not.toMatch(/serial/i);
    expect(payload).not.toMatch(/imei/i);
    expect(payload).not.toMatch(/technician/i);
  });

  it('returns 404 for an unknown verification code', async () => {
    await http.get('/v1/verify/AAAAAAAAAAAA').expect(404);
  });

  it('summarises the dashboard', async () => {
    const summary = await http
      .get('/v1/dashboard/summary?days=30')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.totals.inspections).toBeGreaterThanOrEqual(2);
    expect(summary.body.averages.trustScore).toBeGreaterThan(0);
    expect(summary.body.averages.coverage).toBeGreaterThan(0);
    expect(Array.isArray(summary.body.recent)).toBe(true);
    // Fleet questions the trade actually asks, answered by indexed SQL.
    expect(summary.body.componentOutcomes.length).toBeGreaterThan(0);
    expect(summary.body.moduleCoverage.length).toBeGreaterThan(0);
    expect(Array.isArray(summary.body.failingCollectors)).toBe(true);
  });

  it('re-scores stored evidence into a new inspection, reproducing the verdict', async () => {
    const original = await prisma.inspection.findUnique({ where: { id: inspectionId } });

    const rescored = await http
      .post(`/v1/inspections/${inspectionId}/rescore`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(201);

    // A new record, so the original report keeps saying what it said.
    expect(rescored.body.id).not.toBe(inspectionId);
    expect(rescored.body.report.device.marketingName).toBe('iPhone 14 Pro');

    // Same evidence, same engine, same answer: the reproducibility guarantee.
    const stored = await prisma.inspection.findUnique({ where: { id: rescored.body.id } });
    expect(stored?.trustScore).toBe(original?.trustScore);
    expect(stored?.trustVerdict).toBe(original?.trustVerdict);
    expect(stored?.ledgerDigest).toBe(original?.ledgerDigest);
  });

  it('refuses to re-score evidence that no longer matches its digest', async () => {
    // Simulate an edit made directly in the database. Re-scoring tampered
    // evidence would launder that edit into a fresh, apparently authoritative
    // verdict, which is exactly what the digest exists to prevent.
    const target = await prisma.evidenceRecordRow.findFirst({
      where: { inspectionId, key: 'CycleCount' },
    });
    if (!target) throw new Error('expected a CycleCount record to tamper with');

    await prisma.evidenceRecordRow.update({ where: { id: target.id }, data: { value: 1 } });
    await http
      .post(`/v1/inspections/${inspectionId}/rescore`)
      .set('authorization', `Bearer ${accessToken}`)
      .expect(400);

    await prisma.evidenceRecordRow.update({
      where: { id: target.id },
      data: { value: target.value as never },
    });
  });

  it('isolates tenants', async () => {
    const other = await http
      .post('/v1/auth/register')
      .send({
        organizationName: 'Rival Repairs',
        name: 'Rival Owner',
        email: uniqueEmail('rival'),
        password: 'another-long-password',
      })
      .expect(201);

    expect(other.body.organization.id).not.toBe(organizationId);

    // The rival must not be able to read, report on, or download our work.
    await http
      .get(`/v1/inspections/${inspectionId}`)
      .set('authorization', `Bearer ${other.body.accessToken}`)
      .expect(404);
    await http
      .get(`/v1/reports/${reportId}/download`)
      .set('authorization', `Bearer ${other.body.accessToken}`)
      .expect(404);
    await http
      .post(`/v1/inspections/${inspectionId}/report`)
      .set('authorization', `Bearer ${other.body.accessToken}`)
      .expect(404);

    const list = await http
      .get('/v1/inspections')
      .set('authorization', `Bearer ${other.body.accessToken}`)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  it('enforces role requirements', async () => {
    const viewerEmail = uniqueEmail('viewer');
    await http
      .post('/v1/auth/users')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ name: 'Read Only', email: viewerEmail, password: 'viewer-long-password', role: 'VIEWER' })
      .expect(201);

    const login = await http
      .post('/v1/auth/login')
      .send({ email: viewerEmail, password: 'viewer-long-password' })
      .expect(201);

    // A viewer can read but must not mint reports or pair workstations.
    await http
      .get('/v1/inspections')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    await http
      .post(`/v1/inspections/${inspectionId}/report`)
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
    await http
      .post('/v1/bridges')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Sneaky bench' })
      .expect(403);
  });

  it('writes an audit trail for every material action', async () => {
    const logs = await prisma.auditLog.findMany({ where: { organizationId } });
    const actions = logs.map((log) => log.action);
    expect(actions).toContain('organization.created');
    expect(actions).toContain('bridge.paired');
    expect(actions).toContain('inspection.created');
    expect(actions).toContain('report.generated');
  });

  it('rotates refresh tokens and rejects the used one', async () => {
    const email = uniqueEmail('rotate');
    const registered = await http
      .post('/v1/auth/register')
      .send({ organizationName: 'Rotate Co', name: 'Rot', email, password: 'rotating-password-1' })
      .expect(201);

    const first = registered.body.refreshToken;
    const refreshed = await http.post('/v1/auth/refresh').send({ refreshToken: first }).expect(201);
    expect(refreshed.body.accessToken).toBeTruthy();

    // Replaying a rotated refresh token is the classic theft signal.
    await http.post('/v1/auth/refresh').send({ refreshToken: first }).expect(401);
  });
});
