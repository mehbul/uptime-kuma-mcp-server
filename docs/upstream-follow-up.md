# Draft follow-up for issue #7795

Do not post this unchanged. Complete the personal code review and manual demo described in DEMO.md, then adapt the wording to your own findings.

---

Thanks for the interest in an Uptime Kuma MCP integration. The standalone implementation is at https://github.com/mehbul/uptime-kuma-mcp-server.

Compatibility testing against Uptime Kuma 2.5.7 uncovered problems in the original version: list events were missed during login, monitor creation omitted required fields, and statistics used an unsupported event. A draft contribution fixes those paths and adds regression tests and a reproducible demo exercising all 12 tools against a disposable instance. HTTP mode now uses a loopback listener, bearer authentication, and independent request handlers.

This remains an independent community integration. Would maintainers prefer an ecosystem/wiki link, an example integration, or a different approach? I am happy to follow the project's feature-request template for the preferred path.

Related proposal: https://github.com/louislam/uptime-kuma/issues/7795

---

Before posting, add your own manual-test findings and the reviewed contribution link. Do not claim that upstream has approved or adopted the server.
