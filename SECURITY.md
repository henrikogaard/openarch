# Security policy

## Supported versions

Only the latest tagged release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead:

1. Use GitHub's **private vulnerability reporting** on this repository, or
2. Email the maintainer (see the repository owner profile).

Include: what the issue is, how to reproduce it, and any PoC. You will get an
acknowledgement within a week and a fix date before disclosure.

## Threat model (what "security" means here)

- **Local-first solo use must not require trust in anyone.** The browser never calls a
  server unless the user switches to server/Git mode.
- **Model text is untrusted** (imports, AI writes). It must never execute when rendered,
  exported, or sent to an LLM: text is XML-escaped in SVG, formula-neutralized in CSV,
  control-character-stripped in PPTX, and stamped with `SAFETY_PREFIX` on every AI surface.
- **The durable path is the enforcement point.** Every server write (web app, MCP, REST,
  import) passes the same structural validation — there is no "trusted" writer.
- Secrets (connector tokens, OAuth) live in memory/session only; SCIM/static token
  comparisons are constant-time; CORS defaults to loopback; auth-less operation is the
  documented "local only" posture.

Products like `npm audit` (now `0 vulnerabilities`), the XSD conformance suite and the
server integration suite run in CI on every change.
