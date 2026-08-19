#!/usr/bin/env node
import { componentLabel, inspect, SIMULATOR_PROFILES, type InspectionReport } from '@devdna/core';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { BRIDGE_VERSION, SnapshotCollector } from './services/collector.js';
import { LibimobiledeviceAdapter } from './adapters/libimobiledevice.js';

const HELP = `DevDNA Bridge ${BRIDGE_VERSION}

  devdna-bridge serve              Start the loopback agent for the dashboard
  devdna-bridge devices            List attached iPhones
  devdna-bridge inspect <udid>     Run one inspection and print the result
  devdna-bridge doctor             Check the libimobiledevice toolchain

Options
  --simulator                      Serve deterministic fixtures, no hardware
  --json                           Machine-readable output
  --port <n>                       Loopback port (default 7411)

Environment
  DEVDNA_API_URL, DEVDNA_BRIDGE_TOKEN, DEVDNA_BRIDGE_SECRET   cloud pairing
  DEVDNA_ALLOWED_ORIGINS                                      dashboard origins
`;

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args.find((a) => !a.startsWith('--')) ?? 'serve';
  const flag = (name: string): boolean => args.includes(`--${name}`);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  if (flag('help') || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const env = { ...process.env };
  if (flag('simulator')) env['DEVDNA_SIMULATOR'] = 'true';
  const portOption = option('port');
  if (portOption) env['DEVDNA_BRIDGE_PORT'] = portOption;
  const config = loadConfig(env);
  const json = flag('json');

  switch (command) {
    case 'serve': {
      const server = await createServer(config);
      server.watcher.start();
      await server.app.listen({ port: config.port, host: config.host });
      process.stdout.write(
        [
          `DevDNA Bridge ${BRIDGE_VERSION} listening on http://${config.host}:${config.port}`,
          `  mode        ${config.simulator ? 'simulator (no hardware required)' : 'usb'}`,
          `  workstation ${config.workstationName}`,
          `  dashboard   ${config.allowedOrigins.join(', ')}`,
          '',
          'Pair the dashboard with this workstation using:',
          `  ${server.token}`,
          '',
        ].join('\n'),
      );
      const shutdown = (): void => {
        void server.close().then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return -1; // keep the process alive
    }

    case 'devices': {
      if (config.simulator) {
        const devices = SIMULATOR_PROFILES.map((p) => ({
          udid: p.id,
          label: p.label,
          description: p.description,
        }));
        process.stdout.write(
          json
            ? `${JSON.stringify(devices, null, 2)}\n`
            : `${devices.map((d) => `  ${d.udid.padEnd(26)} ${d.label}`).join('\n')}\n`,
        );
        return 0;
      }
      const adapter = new LibimobiledeviceAdapter(config.toolTimeoutSeconds);
      const devices = await adapter.listDevices();
      if (json) {
        process.stdout.write(`${JSON.stringify(devices, null, 2)}\n`);
      } else if (devices.length === 0) {
        process.stdout.write('No iPhone detected. Connect one by USB and unlock it.\n');
      } else {
        for (const device of devices) process.stdout.write(`  ${device.udid}\n`);
      }
      return 0;
    }

    case 'doctor': {
      const adapter = new LibimobiledeviceAdapter(config.toolTimeoutSeconds);
      const toolchain = await adapter.toolchain();
      if (json) {
        process.stdout.write(`${JSON.stringify(toolchain, null, 2)}\n`);
        return toolchain.available ? 0 : 1;
      }
      for (const [tool, version] of Object.entries(toolchain.versions)) {
        process.stdout.write(`  ok      ${tool} ${version}\n`);
      }
      for (const tool of toolchain.missing) process.stdout.write(`  MISSING ${tool}\n`);
      if (!toolchain.available) {
        process.stdout.write(
          '\nInstall the suite:\n' +
            '  macOS    brew install libimobiledevice ideviceinstaller\n' +
            '  Windows  use the DevDNA Bridge installer, which bundles the tools\n' +
            '  Linux    apt install libimobiledevice-utils ideviceinstaller\n',
        );
      }
      return toolchain.available ? 0 : 1;
    }

    case 'inspect': {
      const udid = args.find((a) => !a.startsWith('--') && a !== 'inspect');
      if (!udid) {
        process.stderr.write('Usage: devdna-bridge inspect <udid>\n');
        return 2;
      }
      const collector = new SnapshotCollector(config);
      const snapshot = await collector.collect(udid, (event) => {
        if (!json) process.stderr.write(`  ${event.ok ? '·' : '!'} ${event.label}\n`);
      });
      const result = inspect(snapshot);
      if (json) {
        process.stdout.write(`${JSON.stringify({ snapshot, result }, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(formatResult(result));
      return 0;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

/**
 * Technician-facing summary.
 *
 * Ordered to match how a bench decision actually gets made: what is this
 * device, is it what it claims to be, has it been worked on, and what is its
 * condition. The trust score comes last because it is a summary of the lines
 * above it, not a substitute for them.
 */
function formatResult(result: InspectionReport): string {
  const { hardware, service, battery, security } = result.details;
  const { trust, device } = result;

  const lines: string[] = [
    '',
    `  ${device.marketingName ?? device.productType ?? 'Unknown model'}` +
      `  ${device.capacityGb ?? '?'}GB` +
      `  iOS ${device.iosVersion ?? '?'}`,
    `  ${device.regionName ?? device.regionCode ?? 'region unknown'}` +
      `  ·  unit: ${device.unitProvenance.toLowerCase().replace(/_/g, ' ')}`,
    '',
    `  Identity   ${verdictOf(result, 'identity').padEnd(22)} ${confidenceOf(result, 'identity')}`,
    `  Hardware   ${verdictOf(result, 'hardware').padEnd(22)} ${confidenceOf(result, 'hardware')}` +
      (hardware.anomalies.length > 0 ? `  (${hardware.anomalies.length} anomal${hardware.anomalies.length === 1 ? 'y' : 'ies'})` : ''),
    `  Security   ${verdictOf(result, 'security').padEnd(22)} posture ${security.postureScore}/100`,
    `  Battery    ${verdictOf(result, 'battery').padEnd(22)} grade ${battery.wearGrade}` +
      `  health ${battery.maximumCapacityPercent ?? '--'}%  cycles ${battery.cycleCount ?? '--'}`,
    '',
  ];

  if (battery.replacementLikelihood !== null) {
    lines.push(
      `  Battery replacement within ${battery.replacementWindowMonths} months: ` +
        `${Math.round(battery.replacementLikelihood * 100)}% likely`,
      '',
    );
  }

  lines.push(`  Service evidence  (${Math.round(service.components.length > 0 ? result.modules.service.coverage * 100 : 0)}% of component weight determined)`);
  const determined = service.components.filter((c) => c.verdict !== 'CANNOT_DETERMINE');
  if (determined.length === 0) {
    lines.push('    no component could be assessed; no claim is made about any part');
  }
  for (const component of determined) {
    const authenticity =
      component.authenticity === 'UNKNOWN' ? '' : `  [${component.authenticity.toLowerCase().replace(/_/g, ' ')}]`;
    lines.push(`    ${componentLabel(component.subject).padEnd(14)} ${component.verdict.padEnd(18)}${authenticity}`);
  }

  lines.push(
    '',
    `  TRUST  ${trust.score}/100   ${trust.verdict}   (confidence ${Math.round(trust.confidence * 100)}%, coverage ${Math.round(trust.coverage * 100)}%)`,
    '',
  );
  for (const gate of trust.gatesApplied) lines.push(`    capped at ${gate.cap}: ${gate.reason}`);
  if (trust.gatesApplied.length > 0) lines.push('');
  for (const finding of result.findings.slice(0, 8)) {
    lines.push(`    [${finding.severity}] ${finding.title}`);
  }
  lines.push('', `  ${result.evidence.length} evidence records · ledger ${result.ledgerDigest.slice(0, 16)}`, '');
  return `${lines.join('\n')}\n`;
}

const verdictOf = (result: InspectionReport, module: keyof InspectionReport['modules']): string =>
  result.modules[module].verdicts[0]?.value ?? 'CANNOT_DETERMINE';

const confidenceOf = (result: InspectionReport, module: keyof InspectionReport['modules']): string =>
  `confidence ${Math.round(result.modules[module].confidence * 100)}%`;

main(process.argv)
  .then((code) => {
    if (code >= 0) process.exit(code);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
