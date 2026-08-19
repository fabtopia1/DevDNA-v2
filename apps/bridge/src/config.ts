import { hostname, platform } from 'node:os';

export interface BridgeConfig {
  /** Loopback port the dashboard talks to. */
  port: number;
  host: string;
  /** Browser origins allowed to call the bridge. */
  allowedOrigins: string[];
  /** Cloud API base URL for direct snapshot upload. */
  apiBaseUrl: string | null;
  /** Bridge token issued by the cloud during pairing. */
  bridgeToken: string | null;
  /** HMAC secret issued alongside the token. */
  bridgeSecret: string | null;
  /** Run without hardware, serving deterministic fixtures. */
  simulator: boolean;
  /** Seconds before a single libimobiledevice invocation is killed. */
  toolTimeoutSeconds: number;
  /** Copy analytics files off the device (slower, much better battery data). */
  collectAnalytics: boolean;
  workstationName: string;
}

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    port: num(env['DEVDNA_BRIDGE_PORT'], 7411),
    // Loopback only. The bridge holds a trusted USB pairing with customer
    // devices; it must never be reachable from the shop network.
    host: env['DEVDNA_BRIDGE_HOST'] ?? '127.0.0.1',
    allowedOrigins: (env['DEVDNA_ALLOWED_ORIGINS'] ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    apiBaseUrl: env['DEVDNA_API_URL'] ?? null,
    bridgeToken: env['DEVDNA_BRIDGE_TOKEN'] ?? null,
    bridgeSecret: env['DEVDNA_BRIDGE_SECRET'] ?? null,
    simulator: bool(env['DEVDNA_SIMULATOR'], false),
    toolTimeoutSeconds: num(env['DEVDNA_TOOL_TIMEOUT'], 25),
    collectAnalytics: bool(env['DEVDNA_COLLECT_ANALYTICS'], true),
    workstationName: env['DEVDNA_WORKSTATION'] ?? hostname(),
  };
}

export const currentPlatform = (): 'darwin' | 'win32' | 'linux' => {
  const p = platform();
  if (p === 'darwin' || p === 'win32') return p;
  return 'linux';
};
