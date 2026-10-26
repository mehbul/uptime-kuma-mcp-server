# Contributing

This is a standalone community integration. Use Node.js 22 or newer, run `npm ci`, and run `npm test` before submitting changes. Changes to Socket.IO calls should also be checked with `npm run test:live` against a disposable supported Kuma checkout.

The automated tests exercise authentication ordering, login-time list events, status aggregation, credential filtering, and concurrent authenticated HTTP requests. CI also runs the live demo against the pinned Uptime Kuma 2.5.7 commit.

## Upstream discussion

The existing proposal is [louislam/uptime-kuma#7795](https://github.com/louislam/uptime-kuma/issues/7795). It was closed by an issue-template bot. Community comments support the integration, but no maintainer acceptance is established.

Before proposing integration into upstream, read its current [CONTRIBUTING.md](https://github.com/louislam/uptime-kuma/blob/master/CONTRIBUTING.md) and [AGENTS.md](https://github.com/louislam/uptime-kuma/blob/master/AGENTS.md). Major features require discussion first. Upstream requires personal understanding, review, and manual testing of generated changes before submission. Automated checks do not replace that requirement.

Keep implementation fixes in this standalone repository while maintainers decide whether they prefer an ecosystem link, an example, or another approach. Do not label this integration official without their agreement.

A follow-up draft is saved in [docs/upstream-follow-up.md](docs/upstream-follow-up.md). Review and adapt it yourself after completing the manual demo.
