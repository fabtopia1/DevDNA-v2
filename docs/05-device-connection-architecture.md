# 5. Device connection architecture

## What is legally and technically reachable

DevDNA speaks only the services Apple exposes to any paired host — the same
ones Finder, iTunes and Apple Configurator use. Every read below happens over a
**user-authorised trust pairing**: the customer unlocks the handset and taps
*Trust This Computer*. Nothing here involves a jailbreak, an exploit, a leaked
Apple tool, or an Apple-internal endpoint.

| Service | Tool | What DevDNA reads | Availability |
|---|---|---|---|
| `com.apple.mobile.lockdown` | `ideviceinfo` | Model, product type, iOS, build, UDID, serial, IMEI, region, activation state, passcode state | **Always** (paired) |
| `com.apple.disk_usage` | `ideviceinfo -q` | Total/available capacity | Always |
| `com.apple.mobile.battery` | `ideviceinfo -q` | Current charge %, charging state | Always |
| `com.apple.mobile.cloud_configuration` | `ideviceinfo -q` | Supervision, DEP/MDM enrolment, organisation | Always |
| `com.apple.mobile.mobilegestalt` | `ideviceinfo -q` | Capability keys (True Tone, Face ID support) | Varies by iOS |
| `com.apple.mobile.diagnostics_relay` | `idevicediagnostics ioregistry AppleSmartBattery` | Design capacity, nominal charge capacity, **cycle count**, cell serial | **Restricted on modern iOS** |
| `com.apple.crashreportcopymobile` | `idevicecrashreport` | Aggregated analytics `.ips` files → battery keys, component diagnostic strings | Usually, if analytics are stored |
| `com.apple.mobile.installation_proxy` | `ideviceinstaller` | Installed bundle IDs (jailbreak indicators) | Always |

### The honest part

Two things a shop most wants are the two Apple does **not** hand over cleanly:

- **Battery health and cycle count.** These live in the `AppleSmartBattery`
  IORegistry node. Apple has progressively restricted `diagnostics_relay`
  access on newer iOS releases, so this query fails on many modern devices.
- **Parts & Service History.** There is *no* public service that returns it.
  It is rendered on-device only. See `docs/07-parts-verification-engine.md`
  for how DevDNA handles that rather than pretending otherwise.

DevDNA's answer is a **provider chain with explicit confidence**, not a silent
guess. When the best source refuses, it falls to the next and says so on the
report.

## The Bridge

`apps/bridge` is a Node daemon. Install per bench.

```
devdna-bridge serve                # loopback agent for the dashboard
devdna-bridge devices              # list attached iPhones
devdna-bridge inspect <udid>       # one-shot inspection, human or --json output
devdna-bridge doctor               # check the libimobiledevice toolchain
devdna-bridge serve --simulator    # deterministic fixtures, no hardware
```

### Platform support

| | macOS | Windows | Linux |
|---|---|---|---|
| Transport | `usbmuxd` ships with macOS | Apple Devices / iTunes provides `Apple Mobile Device Service` | `usbmuxd` package |
| Toolchain | `brew install libimobiledevice ideviceinstaller` | Bundled in the DevDNA Bridge installer | `apt install libimobiledevice-utils ideviceinstaller` |
| Notes | Full support | Bundling avoids asking shops to install iTunes | Supported for CI and kiosk builds |

The bridge **polls** `idevice_id -l` at 2s rather than subscribing to libusb
hotplug callbacks. usbmuxd already multiplexes device state, polling it is
nearly free, and — the deciding reason — the two platforms' driver stacks
differ enough that hotplug callbacks are a portability liability.

### Collection is partial-tolerant

`SnapshotCollector.collect()` aborts on exactly one condition: **no trust
pairing**, because nothing meaningful can be read without one. Every other
failure is captured as a typed `CollectionError` and carried into the snapshot:

```ts
{ collector: 'battery.ioregistry',
  code: 'SERVICE_UNAVAILABLE',
  message: 'com.apple.mobile.diagnostics_relay declined the AppleSmartBattery query…' }
```

Those errors surface as findings on the report. A partial capture with honest
gaps is a useful commercial document; a thrown exception is not.

### Command execution safety

Every tool invocation goes through `execFile` with an argument array — never a
shell string — and UDIDs are format-checked before reaching a tool:

```ts
assertValidUdid(udid)  // 8hex-16hex (modern) or 40hex (legacy), else throw
```

Both device output and dashboard input reach this layer. A shell here would be
a command-injection surface on the technician's own machine.

## The loopback boundary

The dashboard is served from the cloud; the bridge listens on `127.0.0.1:7411`.
Two controls make that safe:

1. **CORS allowlist.** Only the configured dashboard origin may call the bridge.
2. **A per-installation pairing token.** Binding to loopback is *not* access
   control — any process or web page on that machine can reach `127.0.0.1`.
   The bridge mints a 32-byte token on first run, stores it `0600` at
   `~/.devdna/bridge-token`, and prints it. The technician pastes it into the
   dashboard once. Every route except `/health` requires it.

The WebSocket handshake carries the token as a query parameter because browsers
cannot set headers on a WebSocket upgrade; the listener is loopback-only, so
the token does not traverse a network.

## Bridge → API authentication

Bridges are authenticated but **not trusted**. Every ingest request carries an
HMAC over a canonical string:

```
METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256(rawBody)
```

- The signature binds the credential to *this* request, so a token read off a
  shop's disk is not by itself enough to forge inspection records.
- A ±300s timestamp window bounds replay.
- A `bridge_nonces` unique constraint eliminates replay inside that window —
  atomically, rather than as a check-then-act race.
- The API stores the token **hashed** (it only ever compares it) and the HMAC
  secret **encrypted** with AES-256-GCM (it must recompute signatures). A
  database leak alone therefore does not yield forgeable bridge credentials.

**Known limitation and upgrade path.** Symmetric HMAC means the API can, in
principle, compute a valid bridge signature. The stronger design is Ed25519:
the bridge generates a keypair at pairing, sends only the public key, and the
server becomes structurally incapable of forging a bridge's submission. The
canonical string above is already signature-scheme agnostic, so this is a
provider swap in `signPayload`/`verifySignature` plus a column change — planned
for the post-MVP hardening phase (`docs/12-mvp-roadmap.md`).

## Snapshot schema

`RawDeviceSnapshot` is the contract between bridge and cloud, versioned by
`schemaVersion`. It is stored verbatim so any inspection can be re-scored:

```ts
{ schemaVersion: 1, capturedAt, bridge: { version, platform, toolchain, mode },
  lockdown: {...}, domains: { 'com.apple.disk_usage': {...} },
  ioregistry: { AppleSmartBattery: {...} }, analytics: {...} | null,
  installedApps: [...], services: [...], attestation: {...} | null, errors: [...] }
```

`bridge.mode` is `'usb'` or `'simulator'`. Note that the simulator does **not**
relabel data sources — a fixture carries the same `DataSource` values a real
capture would, so demo mode exercises exactly the same engine path. Whether a
capture came from real hardware is a property of the snapshot, not of every
field inside it.
