import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

export class ToolMissingError extends Error {
  constructor(readonly tool: string) {
    super(
      `${tool} is not installed or not on PATH. Install the libimobiledevice suite ` +
        '(macOS: `brew install libimobiledevice`; Windows: the DevDNA Bridge installer bundles it).',
    );
    this.name = 'ToolMissingError';
  }
}

/**
 * Run a libimobiledevice binary.
 *
 * `execFile` with an argument array, never a shell string: UDIDs and file
 * paths reach this layer from device input and from the dashboard, and a shell
 * would turn either into a command-injection surface on the technician's
 * machine.
 */
export function run(
  tool: string,
  args: string[],
  options: { timeoutSeconds?: number; maxBufferBytes?: number } = {},
): Promise<ExecResult> {
  const timeout = (options.timeoutSeconds ?? 25) * 1000;
  return new Promise((resolve, reject) => {
    execFile(
      tool,
      args,
      {
        timeout,
        maxBuffer: options.maxBufferBytes ?? 32 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
          if (err.code === 'ENOENT') {
            reject(new ToolMissingError(tool));
            return;
          }
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? String(error.message),
            code: typeof err.code === 'number' ? err.code : 1,
            timedOut: Boolean(err.killed),
          });
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: 0, timedOut: false });
      },
    );
  });
}

/** Reject anything that is not a plausible UDID before it reaches a tool. */
export function assertValidUdid(udid: string): string {
  const trimmed = udid.trim();
  // Modern format: 8 hex, dash, 16 hex. Legacy format: 40 hex.
  const modern = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/;
  const legacy = /^[0-9A-Fa-f]{40}$/;
  if (!modern.test(trimmed) && !legacy.test(trimmed)) {
    throw new Error(`Refusing to use a malformed UDID: ${udid.slice(0, 64)}`);
  }
  return trimmed;
}
