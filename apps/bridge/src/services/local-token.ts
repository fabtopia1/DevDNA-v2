import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.devdna');
const TOKEN_FILE = join(CONFIG_DIR, 'bridge-token');

/**
 * A per-installation access token for the loopback API.
 *
 * Binding to 127.0.0.1 keeps the bridge off the shop network, but any process
 * or web page on the same machine can still reach loopback. The dashboard is
 * paired once with this token, and every bridge request must carry it, so a
 * random page the technician opens cannot enumerate customer devices.
 */
export async function loadOrCreateLocalToken(): Promise<string> {
  try {
    const existing = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // First run — fall through and mint one.
  }
  const token = randomBytes(32).toString('base64url');
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  // 0600: readable only by the technician's own account.
  await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  return token;
}

export function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
