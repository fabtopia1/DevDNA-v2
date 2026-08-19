/**
 * Browser-side client for DevDNA Bridge.
 *
 * The dashboard is served from the cloud but the iPhone is plugged into the
 * technician's own laptop, so this is the one place the browser talks straight
 * to loopback. The pairing token is held in localStorage: it grants access
 * only to a service already bound to 127.0.0.1 on that machine, and keeping it
 * per-browser means pairing does not have to round-trip through our servers.
 */

const TOKEN_KEY = 'devdna.bridge.token';
const URL_KEY = 'devdna.bridge.url';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:7411';

export interface BridgeHealth {
  ok: boolean;
  service: string;
  version: string;
  platform: string;
  mode: 'usb' | 'simulator';
  workstation: string;
  cloudPaired: boolean;
}

export interface BridgeDevice {
  udid: string;
  deviceName: string | null;
  productType: string | null;
  productVersion: string | null;
  paired: boolean;
  pairingMessage: string;
}

export interface CollectionProgress {
  stage: string;
  label: string;
  progress: number;
  ok: boolean;
  detail?: string;
}

export interface AttestationEntry {
  component: string;
  label: string;
}

export class BridgeUnavailableError extends Error {
  constructor() {
    super(
      'DevDNA Bridge is not reachable on this machine. Start it with `devdna-bridge serve`, ' +
        'then reload this page.',
    );
    this.name = 'BridgeUnavailableError';
  }
}

export const getBridgeUrl = (): string =>
  (typeof window !== 'undefined' && window.localStorage.getItem(URL_KEY)) || DEFAULT_BRIDGE_URL;

export const getBridgeToken = (): string | null =>
  typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);

export function saveBridgePairing(token: string, url = DEFAULT_BRIDGE_URL): void {
  window.localStorage.setItem(TOKEN_KEY, token.trim());
  window.localStorage.setItem(URL_KEY, url.trim());
}

export function clearBridgePairing(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(URL_KEY);
}

async function bridgeFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getBridgeToken();
  let response: Response;
  try {
    response = await fetch(`${getBridgeUrl()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-devdna-bridge-token': token } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // A network-level failure here almost always means the agent is not
    // running, which is a different problem from an API error.
    throw new BridgeUnavailableError();
  }

  if (response.status === 401) {
    throw new Error('This browser is not paired with the bridge. Enter the pairing token shown by the agent.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Bridge request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const bridgeHealth = (): Promise<BridgeHealth> => bridgeFetch<BridgeHealth>('/health');

export const listBridgeDevices = (): Promise<{ devices: BridgeDevice[] }> =>
  bridgeFetch<{ devices: BridgeDevice[] }>('/devices');

export interface InspectResponse {
  snapshot: unknown;
  /** The engine's report, as scored locally on the bench. */
  result: {
    engineVersion: string;
    ledgerDigest: string;
    evidence: unknown[];
    device: {
      marketingName: string | null;
      productType: string | null;
      capacityGb: number | null;
      iosVersion: string | null;
      unitProvenance: string;
    };
    modules: Record<string, { verdicts: Array<{ value: string }>; confidence: number; coverage: number }>;
    details: {
      service: {
        components: Array<{
          subject: string;
          verdict: string;
          authenticity: string;
          confidence: number;
        }>;
        replacedCount: number;
        indeterminateCount: number;
      };
      battery: {
        maximumCapacityPercent: number | null;
        cycleCount: number | null;
        wearGrade: string;
        replacementLikelihood: number | null;
        replacementWindowMonths: number;
      };
      hardware: { anomalies: Array<{ check: string }> };
      security: { postureScore: number; integrityCompromised: boolean };
    };
    trust: {
      score: number;
      rawScore: number;
      verdict: string;
      confidence: number;
      coverage: number;
      gatesApplied: Array<{ code: string; cap: number; reason: string }>;
    };
    provenanceViolations: Array<{ code: string }>;
  };
  progress: CollectionProgress[];
  upload: { uploaded: boolean; inspectionId?: string; reason?: string };
}

export const runBridgeInspection = (input: {
  udid: string;
  attestation?: { capturedBy: string; method: 'MANUAL'; entries: AttestationEntry[]; sectionAbsent?: boolean };
  upload: boolean;
}): Promise<InspectResponse> =>
  bridgeFetch<InspectResponse>('/inspect', { method: 'POST', body: JSON.stringify(input) });

/** Live device and progress events. Returns a disposer. */
export function subscribeToBridge(
  onEvent: (event: Record<string, unknown>) => void,
  onError: (error: Error) => void,
): () => void {
  const token = getBridgeToken();
  if (!token) return () => undefined;

  const wsUrl = `${getBridgeUrl().replace(/^http/, 'ws')}/events?token=${encodeURIComponent(token)}`;
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl);
  } catch {
    onError(new BridgeUnavailableError());
    return () => undefined;
  }

  socket.onmessage = (message) => {
    try {
      onEvent(JSON.parse(String(message.data)));
    } catch {
      // Ignore malformed frames rather than tearing down the stream.
    }
  };
  socket.onerror = () => onError(new BridgeUnavailableError());

  return () => socket.close();
}
