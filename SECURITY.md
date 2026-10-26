# Security policy

Svalin is read-only: it never holds keys, asks for approvals or signatures, or moves funds. Reports
that could still hurt users are very welcome, for example:

- a way to make the API, the website or `svalin-mcp` show a wrong grade, verdict or price;
- a way around the free-call limit or the paywall, or to be charged for a failed call;
- a way to make `svalin-mcp` pay more than its limits, or pay a payee its guard should block;
- script injection on the website, or text in a response that steers an agent.

## How to report

Please report privately through a
[GitHub security advisory](https://github.com/noobshole/svalin-agent/security/advisories/new),
not a public issue. Include the steps to reproduce it and what you expected. You will get a reply
within a few days, and credit in the fix unless you prefer otherwise.

Please do not run load tests against the public API or use real funds in a test.

## Supported versions

Only the latest version on `main`, which is what the public API and website run, receives fixes.
