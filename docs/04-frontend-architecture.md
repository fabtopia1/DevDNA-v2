# 4. Frontend architecture

Next.js 15 (App Router), React 19, TypeScript, Tailwind v4. Source: `apps/web`.

## Rendering model

Every route is a **server component** rendering per request, with client
components only where genuine interactivity is needed:

| Route | Type | Notes |
|---|---|---|
| `/login` | server + `LoginForm` client | Param read server-side to avoid a CSR bailout |
| `/dashboard` | server | Counters, breakdowns, recent activity |
| `/inspections` | server | Filter chips and pagination via URL state |
| `/inspections/[id]` | server + `ReportButton` client | Full evidence view |
| `/inspect` | server shell + `InspectFlow` client | Talks to the local bridge |
| `/settings` | server + `PairWorkstation` client | Workstation pairing |
| `/verify/[publicId]` | server, unauthenticated | Public report verification |

`export const dynamic = 'force-dynamic'` sits in the root layout. The reason is
security, not preference: the CSP carries a per-request nonce, and Next.js can
only stamp that nonce onto its script tags while rendering dynamically. A
prerendered page ships markup whose own scripts the policy then blocks. Nothing
here is publicly cacheable anyway — the dashboard is authenticated and report
verification must always reflect current data.

## Session handling

Tokens live in **httpOnly cookies** set by our own route handlers, never in
`localStorage`. This UI can mint verification reports under a shop's name; a
single XSS able to read a bearer token would let an attacker issue fraudulent
reports. The browser therefore never holds an access token:

- Server components read the cookie directly via `apiFetch`.
- Client-side mutations go through same-origin route handlers that attach it.
- `middleware.ts` redirects unauthenticated requests to `/login?next=…`, and
  the login page only accepts same-origin relative `next` values so a crafted
  link cannot bounce a freshly signed-in technician elsewhere.

### The proxy is allowlisted

`/api/proxy/[...path]` attaches the session's bearer token, so an open proxy
there would hand any page on the origin the user's full authority. It matches
an explicit `(method, pattern)` allowlist and returns 403 otherwise.

## Content Security Policy

Built per request in `middleware.ts`:

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;
object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

The `connect-src` loopback entries are the one deliberate hole: the page is
served from the cloud, but the iPhone is plugged into the technician's own
laptop. Everything else stays strict.

## Talking to the bridge

`src/lib/bridge-client.ts` is the only place the browser reaches loopback.

- The bridge pairing token is kept in `localStorage`. That is acceptable here
  and not for session tokens, because it grants access only to a service
  already bound to `127.0.0.1` on that same machine, and keeping it
  per-browser means pairing never round-trips through our servers.
- A network-level failure is surfaced as `BridgeUnavailableError` with
  actionable text ("start it with `devdna-bridge serve`") rather than a generic
  error — "the agent is not running" is a different problem from "the API said
  no", and the technician fixes them differently.
- A WebSocket subscription streams device attach/detach and collection
  progress, so nobody has to hit reload while swapping handsets on a bench.

## Design decisions

The UI is built for a bright workshop bench on whatever laptop the shop owns:

- **Verdict is never signalled by colour alone.** Every badge carries its
  wording. The palette is chosen to stay distinguishable under common colour
  vision deficiencies, and scores always appear as numerals, with the bar as a
  secondary cue.
- **Evidence is visible, not buried.** Each component verdict lists the signals
  behind it and which source produced each one. A technician arguing with a
  supplier needs the "why", not just the badge.
- **What was *not* assessed is as prominent as what was.** The parts card names
  unassessable components explicitly, and an inconclusive inspection says so at
  the top of the dashboard. Silence would read as a clean bill of health.
- Tabular numerals (`.tabular`) so score columns align down a list.

## State management

None. There is no client state library and no data-fetching library. Server
components fetch; URL search params hold filter and pagination state, so a
filtered list is a shareable link; the only `useState` in the app is inside
three forms and the inspect flow. Adding a store would be inventing a problem.
