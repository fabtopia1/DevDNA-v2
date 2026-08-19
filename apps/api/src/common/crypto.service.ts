import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Application-level encryption for secrets the API must be able to read back.
 *
 * Used for bridge HMAC secrets: verifying a signature requires the original
 * key, so hashing is not an option, but storing it in the clear would make a
 * database leak sufficient to forge inspection records for any tenant.
 *
 * AES-256-GCM with a random 96-bit IV per record and the auth tag stored
 * alongside; the key comes from the environment (KMS/Secrets Manager in
 * production) and never from the database.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env['ENCRYPTION_KEY'];
    if (!rawKey) {
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error('ENCRYPTION_KEY is required in production');
      }
      this.logger.warn('ENCRYPTION_KEY not set — deriving a development key. Do not use in production.');
    }
    // A passphrase of any length is normalised to a 32-byte key.
    this.key = createHash('sha256')
      .update(rawKey ?? 'devdna-development-encryption-key')
      .digest();
  }

  /** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(encoded: string): string {
    const [version, iv, tag, ciphertext] = encoded.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) {
      throw new Error('Malformed ciphertext envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  static constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
