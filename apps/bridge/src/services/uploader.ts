import { createHash, randomUUID } from 'node:crypto';
import { signPayload, type InspectionReport, type RawDeviceSnapshot } from '@devdna/core';
import type { BridgeConfig } from '../config.js';

export interface UploadPayload {
  snapshot: RawDeviceSnapshot;
  result: InspectionReport;
  workstation: string;
}

export interface UploadOutcome {
  uploaded: boolean;
  inspectionId?: string;
  reason?: string;
}

/**
 * Ships a completed inspection to the cloud API.
 *
 * Requests are HMAC-signed rather than bearer-only. The bridge runs on shop
 * hardware we do not control, so a stolen token alone must not be enough to
 * forge inspection records: the signature binds the token to this exact body,
 * path and timestamp, and the nonce lets the API reject replays.
 *
 * Canonical string (newline-joined, order is part of the contract):
 *   METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256(body)
 */
export class SnapshotUploader {
  constructor(private readonly config: BridgeConfig) {}

  get configured(): boolean {
    return Boolean(this.config.apiBaseUrl && this.config.bridgeToken && this.config.bridgeSecret);
  }

  async upload(payload: UploadPayload): Promise<UploadOutcome> {
    if (!this.configured) {
      return { uploaded: false, reason: 'Bridge is not paired with a DevDNA account.' };
    }

    const path = '/v1/inspections/ingest';
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const canonical = ['POST', path, timestamp, nonce, bodyHash].join('\n');
    const signature = signPayload(this.config.bridgeSecret as string, canonical);

    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-devdna-bridge-token': this.config.bridgeToken as string,
        'x-devdna-timestamp': timestamp,
        'x-devdna-nonce': nonce,
        'x-devdna-signature': signature,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        uploaded: false,
        reason: `API rejected the inspection (${response.status}): ${text.slice(0, 300)}`,
      };
    }

    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return { uploaded: true, ...(json.id ? { inspectionId: json.id } : {}) };
  }
}
