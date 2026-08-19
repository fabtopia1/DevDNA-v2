import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  AppleServiceHistoryLabel,
  runInspection,
  type RawDeviceSnapshot,
  type ServiceHistoryAttestation,
} from '@devdna/core';
import { LibimobiledeviceAdapter } from './adapters/libimobiledevice.js';
import { BRIDGE_VERSION, SnapshotCollector, type CollectionProgress } from './services/collector.js';
import { DeviceWatcher } from './services/device-watcher.js';
import { SnapshotUploader } from './services/uploader.js';
import { loadOrCreateLocalToken, tokenMatches } from './services/local-token.js';
import { currentPlatform, type BridgeConfig } from './config.js';

const attestationSchema = z.object({
  capturedBy: z.string().min(1).max(120),
  method: z.enum(['MANUAL', 'OCR']),
  sectionAbsent: z.boolean().optional(),
  entries: z
    .array(
      z.object({
        component: z.string().min(1).max(60),
        label: z.nativeEnum(AppleServiceHistoryLabel),
      }),
    )
    .max(24)
    .default([]),
});

const inspectSchema = z.object({
  udid: z.string().min(1).max(64),
  attestation: attestationSchema.optional(),
  /** Push the finished inspection to the cloud API. */
  upload: z.boolean().default(true),
});

export interface BridgeServer {
  app: FastifyInstance;
  watcher: DeviceWatcher;
  token: string;
  close: () => Promise<void>;
}

export async function createServer(config: BridgeConfig): Promise<BridgeServer> {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const token = await loadOrCreateLocalToken();
  const watcher = new DeviceWatcher(config);
  const collector = new SnapshotCollector(config);
  const uploader = new SnapshotUploader(config);
  const adapter = new LibimobiledeviceAdapter(config.toolTimeoutSeconds);

  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-devdna-bridge-token'],
    credentials: false,
  });

  // Every route except /health requires the local pairing token.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS' || request.url.startsWith('/health')) return;
    if (!tokenMatches(token, request.headers['x-devdna-bridge-token'] as string | undefined)) {
      await reply.code(401).send({ error: 'Bridge pairing token missing or invalid.' });
    }
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'devdna-bridge',
    version: BRIDGE_VERSION,
    platform: currentPlatform(),
    mode: config.simulator ? 'simulator' : 'usb',
    workstation: config.workstationName,
    cloudPaired: uploader.configured,
  }));

  app.get('/toolchain', async () => {
    if (config.simulator) {
      return { available: true, versions: { simulator: BRIDGE_VERSION }, missing: [] };
    }
    return adapter.toolchain();
  });

  app.get('/devices', async () => ({ devices: watcher.list() }));

  app.post('/inspect', async (request, reply) => {
    const parsed = inspectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', detail: parsed.error.flatten() });
    }
    const { udid, attestation, upload } = parsed.data;

    const progress: CollectionProgress[] = [];
    let snapshot: RawDeviceSnapshot;
    try {
      snapshot = await collector.collect(udid, (event) => {
        progress.push(event);
        broadcast({ type: 'progress', udid, ...event });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notPaired = error instanceof Error && error.name === 'NotPairedError';
      broadcast({ type: 'error', udid, message });
      return reply.code(notPaired ? 409 : 500).send({ error: message, code: notPaired ? 'NOT_PAIRED' : 'COLLECTION_FAILED' });
    }

    if (attestation) {
      snapshot = {
        ...snapshot,
        attestation: {
          ...attestation,
          capturedAt: new Date().toISOString(),
        } as ServiceHistoryAttestation,
      };
    }

    // Scored locally as well as in the cloud: the shop still sees a verdict
    // when its internet connection is down, and the API re-scores server-side
    // so a tampered bridge cannot dictate the stored result.
    const result = runInspection(snapshot);
    broadcast({ type: 'complete', udid, trustScore: result.trust.score, status: result.trust.status });

    const uploadOutcome = upload
      ? await uploader
          .upload({ snapshot, result, workstation: config.workstationName })
          .catch((error: unknown) => ({
            uploaded: false,
            reason: error instanceof Error ? error.message : String(error),
          }))
      : { uploaded: false, reason: 'Upload not requested.' };

    return { snapshot, result, progress, upload: uploadOutcome };
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  const broadcast = (message: Record<string, unknown>): void => {
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };

  app.server.on('upgrade', (request, socket, head) => {
    // The browser cannot set headers on a WebSocket handshake, so the pairing
    // token travels as a query parameter on an already loopback-only listener.
    const url = new URL(request.url ?? '/', `http://${config.host}:${config.port}`);
    if (url.pathname !== '/events' || !tokenMatches(token, url.searchParams.get('token') ?? undefined)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'hello', version: BRIDGE_VERSION, devices: watcher.list() }));
    });
  });

  watcher.on('connect', (device) => broadcast({ type: 'device-connected', device }));
  watcher.on('disconnect', (device) => broadcast({ type: 'device-disconnected', device }));
  watcher.on('error', (error: unknown) =>
    broadcast({ type: 'watcher-error', message: error instanceof Error ? error.message : String(error) }),
  );

  return {
    app,
    watcher,
    token,
    close: async () => {
      watcher.stop();
      for (const client of clients) client.close();
      wss.close();
      await app.close();
    },
  };
}
