import { describe, expect, it } from 'vitest';
import {
  extractAnalytics,
  mergeAnalytics,
  parseIdeviceInfo,
  parseKeyValueLines,
  parsePlist,
  parsePlistDict,
  parseSmartBattery,
} from '../src/parsers/index.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>DeviceName</key>
	<string>Ana&apos;s iPhone</string>
	<key>ProductType</key>
	<string>iPhone16,1</string>
	<key>TotalDiskCapacity</key>
	<integer>256000000000</integer>
	<key>BatteryLevel</key>
	<real>0.87</real>
	<key>PasswordProtected</key>
	<true/>
	<key>Supervised</key>
	<false/>
	<key>Tags</key>
	<array>
		<string>a</string>
		<string>b</string>
	</array>
	<key>Nested</key>
	<dict>
		<key>Inner</key>
		<integer>7</integer>
	</dict>
	<key>Empty</key>
	<dict/>
	<key>Blob</key>
	<data>QUJD</data>
</dict>
</plist>`;

describe('plist parser', () => {
  it('parses a full document including nested containers and entities', () => {
    const dict = parsePlistDict(XML);
    expect(dict['DeviceName']).toBe("Ana's iPhone");
    expect(dict['ProductType']).toBe('iPhone16,1');
    expect(dict['TotalDiskCapacity']).toBe(256_000_000_000);
    expect(dict['BatteryLevel']).toBe(0.87);
    expect(dict['PasswordProtected']).toBe(true);
    expect(dict['Supervised']).toBe(false);
    expect(dict['Tags']).toEqual(['a', 'b']);
    expect(dict['Nested']).toEqual({ Inner: 7 });
    expect(dict['Empty']).toEqual({});
    expect(dict['Blob']).toBe('QUJD');
  });

  it('returns null for empty input and {} for a non-dict root', () => {
    expect(parsePlist('')).toBeNull();
    expect(parsePlistDict('<plist version="1.0"><array><string>x</string></array></plist>')).toEqual({});
  });

  it('decodes numeric character references', () => {
    const dict = parsePlistDict('<plist><dict><key>k</key><string>caf&#233;</string></dict></plist>');
    expect(dict['k']).toBe('café');
  });
});

describe('ideviceinfo parser', () => {
  it('reads the key/value output format', () => {
    const parsed = parseKeyValueLines(
      ['BuildVersion: 22D72', 'ProductVersion: 18.3.1', 'PasswordProtected: true', 'CycleCount: 42', ''].join('\n'),
    );
    expect(parsed).toEqual({
      BuildVersion: '22D72',
      ProductVersion: '18.3.1',
      PasswordProtected: true,
      CycleCount: 42,
    });
  });

  it('auto-detects XML versus key/value', () => {
    expect(parseIdeviceInfo(XML)['ProductType']).toBe('iPhone16,1');
    expect(parseIdeviceInfo('ProductType: iPhone15,2')['ProductType']).toBe('iPhone15,2');
  });

  it('keeps unsafe integers as strings rather than losing precision', () => {
    const parsed = parseKeyValueLines('Big: 99999999999999999999');
    expect(typeof parsed['Big']).toBe('string');
  });
});

describe('AppleSmartBattery parser', () => {
  it('normalises the registry node and converts deci-Celsius', () => {
    const reading = parseSmartBattery({
      Diagnostics: {
        AppleSmartBattery: {
          DesignCapacity: 3274,
          NominalChargeCapacity: 3241,
          CycleCount: 42,
          Serial: 'F8Y2340A1QRJKLMN',
          Temperature: 2980,
          IsCharging: false,
        },
      },
    });
    expect(reading.designCapacityMah).toBe(3274);
    expect(reading.nominalChargeCapacityMah).toBe(3241);
    expect(reading.cycleCount).toBe(42);
    expect(reading.temperatureCelsius).toBeCloseTo(29.8, 1);
    expect(reading.isCharging).toBe(false);
  });

  it('falls back to AppleRawMaxCapacity when NominalChargeCapacity is absent', () => {
    const reading = parseSmartBattery({ AppleRawMaxCapacity: 2900, DesignCapacity: 3200 });
    expect(reading.nominalChargeCapacityMah).toBeNull();
    expect(reading.appleRawMaxCapacityMah).toBe(2900);
  });
});

describe('analytics extractor', () => {
  it('finds battery keys at any depth and under alias spellings', () => {
    const content = JSON.stringify({
      bug_type: '298',
      payload: {
        'com.apple.power.battery': {
          NCC: 2976,
          DesignCapacity: 3200,
          cycle_count: 412,
        },
      },
    });
    const extract = extractAnalytics('log-aggregated-2026-03-11-100442.ips', content);
    expect(extract.batteryKeys['nominalChargeCapacityMah']).toBe(2976);
    expect(extract.batteryKeys['designCapacityMah']).toBe(3200);
    expect(extract.batteryKeys['cycleCount']).toBe(412);
    expect(extract.fileDate).toBe('2026-03-11');
  });

  it('parses the header + body two-document form', () => {
    const content = `{"app_name":"aggregated"}\n{"payload":{"CycleCount":100}}`;
    expect(extractAnalytics('a.ips', content).batteryKeys['cycleCount']).toBe(100);
  });

  it('collects diagnostic strings even from unparseable payloads', () => {
    const extract = extractAnalytics('x.ips', 'garbage AppleDisplayPipeAuthFailure trailing');
    expect(extract.diagnosticStrings).toContain('AppleDisplayPipeAuthFailure');
  });

  it('never throws on malformed input', () => {
    expect(() => extractAnalytics('x.ips', '{{{not json')).not.toThrow();
    expect(extractAnalytics('x.ips', '').batteryKeys).toEqual({});
  });

  it('merges extracts preferring the newest file', () => {
    const merged = mergeAnalytics([
      { sourceFile: 'old.ips', fileDate: '2026-01-01', batteryKeys: { cycleCount: 10 }, diagnosticStrings: ['A'] },
      { sourceFile: 'new.ips', fileDate: '2026-03-01', batteryKeys: { cycleCount: 99 }, diagnosticStrings: ['B'] },
    ]);
    expect(merged?.batteryKeys['cycleCount']).toBe(99);
    expect(merged?.diagnosticStrings.sort()).toEqual(['A', 'B']);
  });
});
