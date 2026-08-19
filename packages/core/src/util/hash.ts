import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * UDIDs and serial numbers are device-identifying personal data under GDPR.
 * DevDNA persists salted hashes by default and keeps the plaintext only where
 * an operator has explicitly opted in (see `docs/10-security-architecture.md`).
 */
export function hashIdentifier(value: string, salt = ''): string {
  return createHash('sha256').update(`${salt}:${value.trim().toLowerCase()}`).digest('hex');
}

/** Canonical request signature used between the Bridge and the API. */
export function signPayload(secret: string, canonicalString: string): string {
  return createHmac('sha256', secret).update(canonicalString).digest('hex');
}

/** Constant-time signature comparison. */
export function verifySignature(secret: string, canonicalString: string, provided: string): boolean {
  const expected = signPayload(secret, canonicalString);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided ?? '', 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
