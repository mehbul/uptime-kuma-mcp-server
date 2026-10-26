# Compatibility validation — October 26, 2026

## Verified locally

- Windows, Node.js 24.15.0, TypeScript strict build.
- `npm test`: **11 passing automated regression tests**.
- `npm run test:live`: **all 12 tools pass against real Uptime Kuma 2.5.7, over both stdio and authenticated Streamable HTTP**.
- Upstream release commit: `d54e4619e52553416e292549f435cc7e57330c29`.
- Current upstream `master` protocol was also inspected at `be2b4409657a2873b4b08946509dad7a1bf59588`; this is source inspection, not a live compatibility claim.

## Reproduced and corrected

| Problem | Correction | Evidence |
|---|---|---|
| Login commands can be emitted before Kuma installs its handlers | Wait for the initial `info` event | Delayed-handler regression and real-server demo |
| Login-time list pushes are missed | Attach list collectors before connecting and authenticating | Notification timeout reproduced before fix; list regressions and demo pass |
| `statusPageList` is an object, not an array | Normalize its values | Nonempty fixture and real seeded status page |
| Monitor creation omits required fields | Supply accepted status codes, method, timing defaults and collection defaults | Real create initially failed with a NOT NULL constraint; HTTP lifecycle now passes |
| `getMonitorUptime` does not exist | Use `getMonitorChartData` and aggregate up/down counters | Fixture arithmetic/error tests and live demo |
| Per-call password login hits Kuma rate limiting | Reuse returned login JWT in memory, scoped to URL and credentials | Failed combined demo and regression reproduced before fix; both transports now pass |
| Credential-bearing monitor and notification fields reach clients | Allowlist monitor configuration and return only notification summary fields | Seeded credential regression tests |
| Shared MCP server conflicts across HTTP requests | Construct a server per stateless request | Three concurrent SDK clients make repeated discovery calls |
| HTTP listener has no access control | Bind loopback, require bearer token, reject browser origins/unexpected hosts | HTTP regression and authenticated live demo |

Status is a ratio of successful versus failed observations in Kuma chart buckets, not an independently calculated duration-weighted SLA. Empty history yields null. Uptime calculations depend on Kuma's aggregation and retention.

## Limits

- The real creation/edit/delete demo uses an HTTP monitor. Other advertised monitor types and their required fields need separate compatibility testing.
- Notification filtering uses a nonempty protocol fixture; the disposable real server has no configured notification channels.
- Two-factor challenges, alternate Kuma versions, TLS/reverse-proxy deployments and remote hosting have not been live-tested.
- The CI workflow covers Node.js 22 on Windows/Linux and a pinned Linux live-Kuma demo; GitHub's run status is the evidence for those environments.
- Automated tests and this executable demo do not satisfy upstream's requirement for the contributor's personal code review and manual testing. No upstream acceptance or production-readiness claim is made.

See DEMO.md for reproduction and the human walkthrough.
