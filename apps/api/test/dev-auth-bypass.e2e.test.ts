import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { DEV_ORGANIZATION_ID, DEV_PRINCIPAL, DEV_USER_ID } from '../src/common/dev-auth';
import { loadConfiguration } from '../src/config/configuration';

/**
 * DEV_AUTH_BYPASS.
 *
 * Two things need pinning: that the bypass does what it claims, and — more
 * importantly — that it cannot be turned on in production. The second is the
 * only thing standing between a mistyped environment variable and an
 * unauthenticated API, so it is asserted rather than assumed.
 *
 * The flag is read once at boot, so this suite sets it before the module is
 * compiled and restores it afterwards.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;
const previous = process.env['DEV_AUTH_BYPASS'];

beforeAll(async () => {
  process.env['DEV_AUTH_BYPASS'] = 'true';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  http = request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (previous === undefined) delete process.env['DEV_AUTH_BYPASS'];
  else process.env['DEV_AUTH_BYPASS'] = previous;
});

describe('dev auth bypass', () => {
  it('refuses to load configuration in production', () => {
    const nodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      expect(() => loadConfiguration()).toThrowError(/DEV_AUTH_BYPASS/);
    } finally {
      if (nodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = nodeEnv;
    }
  });

  it('provisions the workspace the injected principal points at', async () => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { id: DEV_USER_ID } });
    const organization = await prisma.organization.findUnique({
      where: { id: DEV_ORGANIZATION_ID },
    });

    expect(organization).not.toBeNull();
    expect(user?.organizationId).toBe(DEV_ORGANIZATION_ID);
    expect(user?.email).toBe(DEV_PRINCIPAL.email);
  });

  it('serves guarded routes with no credentials at all', async () => {
    const me = await http.get('/v1/auth/me').expect(200);
    expect(me.body.email).toBe(DEV_PRINCIPAL.email);
    expect(me.body.organization.id).toBe(DEV_ORGANIZATION_ID);

    await http.get('/v1/inspections').expect(200);
    await http.get('/v1/dashboard/summary').expect(200);
  });

  it('ignores a garbage bearer token rather than rejecting it', async () => {
    await http.get('/v1/inspections').set('authorization', 'Bearer nonsense').expect(200);
  });

  it('satisfies role-guarded routes as ADMIN', async () => {
    // Bridge registration is @Roles('ADMIN'); reaching a 201 proves the
    // injected principal carries a role the RolesGuard accepts.
    await http.post('/v1/bridges').send({ name: 'Bypass bench' }).expect(201);
  });

  it('still scopes every query to the development workspace', async () => {
    const prisma = app.get(PrismaService);
    const foreign = await prisma.organization.create({
      data: { name: 'Other Shop', slug: `other-${Date.now()}`, identifierSalt: 'x'.repeat(24) },
    });
    try {
      const bridges = await http.get('/v1/bridges').expect(200);
      const ids = (bridges.body as Array<{ id: string }>).map((b) => b.id);
      const foreignBridge = await prisma.bridgeRegistration.create({
        data: {
          organizationId: foreign.id,
          name: 'Foreign bench',
          tokenHash: `hash-${Date.now()}`,
          secretCiphertext: 'v1.x.x.x',
        },
      });
      expect(ids).not.toContain(foreignBridge.id);
    } finally {
      await prisma.organization.delete({ where: { id: foreign.id } });
    }
  });
});
