import { describe, expect, it } from 'vitest';
import { assertValidUdid } from '../src/adapters/exec.js';
import { loadConfig } from '../src/config.js';
import { SnapshotCollector } from '../src/services/collector.js';
import { createServer } from '../src/server.js';

const simulatorConfig = () =>
  loadConfig({
    DEVDNA_SIMULATOR: 'true',
    DEVDNA_BRIDGE_PORT: '0',
    DEVDNA_ALLOWED_ORIGINS: 'http://localhost:3000',
  } as NodeJS.ProcessEnv);

describe('udid validation', () => {
  it('accepts both modern and legacy formats', () => {
    expect(assertValidUdid('00008130-000A4D2E0EC0001C')).toBe('00008130-000A4D2E0EC0001C');
    expect(assertValidUdid('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')).toHaveLength(40);
  });

  it('rejects anything that could reach a tool as an argument injection', () => {
    for (const bad of ['; rm -rf /', '--help', '00008130', '', '../../etc/passwd', 'a'.repeat(200)]) {
      expect(() => assertValidUdid(bad)).toThrow();
    }
  });
});

describe('simulator collector', () => {
  it('produces a snapshot flagged as simulated with real-looking sources', async () => {
    const collector = new SnapshotCollector(simulatorConfig());
    const stages: string[] = [];
    const snapshot = await collector.collect('pristine-15-pro', (p) => stages.push(p.stage));

    expect(snapshot.bridge.mode).toBe('simulator');
    expect(snapshot.lockdown['ProductType']).toBe('iPhone16,1');
    expect(stages).toContain('pairing');
    expect(stages.at(-1)).toBe('complete');
    // capturedAt is stamped at collection time, not baked into the fixture.
    expect(new Date(snapshot.capturedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('bridge http api', () => {
  it('serves health without a token but refuses everything else', async () => {
    const server = await createServer(simulatorConfig());
    try {
      const health = await server.app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ ok: true, mode: 'simulator' });

      const devices = await server.app.inject({ method: 'GET', url: '/devices' });
      expect(devices.statusCode).toBe(401);

      const wrongToken = await server.app.inject({
        method: 'GET',
        url: '/devices',
        headers: { 'x-devdna-bridge-token': 'nope' },
      });
      expect(wrongToken.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('runs a full inspection over the loopback API', async () => {
    const server = await createServer(simulatorConfig());
    try {
      const response = await server.app.inject({
        method: 'POST',
        url: '/inspect',
        headers: { 'x-devdna-bridge-token': server.token },
        payload: { udid: 'serviced-14-pro', upload: false },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.result.details.identity.marketingName).toBe('iPhone 14 Pro');
      expect(body.result.trust.score).toBeGreaterThan(0);
      expect(body.result.evidence.length).toBeGreaterThan(20);
      // The bridge scores locally so a shop still gets a verdict offline.
      expect(body.result.trust.verdict).toBeTruthy();
      expect(body.result.provenanceViolations).toEqual([]);
      expect(body.progress.at(-1).stage).toBe('complete');
      expect(body.upload.uploaded).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('applies a technician attestation to the inspection', async () => {
    const server = await createServer(simulatorConfig());
    try {
      const response = await server.app.inject({
        method: 'POST',
        url: '/inspect',
        headers: { 'x-devdna-bridge-token': server.token },
        payload: {
          udid: 'pristine-15-pro',
          upload: false,
          attestation: {
            capturedBy: 'tech@shop.example',
            method: 'MANUAL',
            entries: [{ component: 'Display', label: 'Unknown Part' }],
          },
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const display = body.result.details.service.components.find(
        (c: { subject: string }) => c.subject === 'DISPLAY',
      );
      // An "Unknown Part" label means Apple could not verify what was fitted,
      // and that the component was serviced at all.
      expect(display.verdict).toBe('REPLACED_LIKELY');
      expect(display.authenticity).toBe('NOT_VERIFIED');
      expect(body.result.trust.verdict).toBe('UNTRUSTED');
    } finally {
      await server.close();
    }
  });

  it('rejects a malformed inspection request', async () => {
    const server = await createServer(simulatorConfig());
    try {
      const response = await server.app.inject({
        method: 'POST',
        url: '/inspect',
        headers: { 'x-devdna-bridge-token': server.token },
        payload: { udid: '', upload: false },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
});
