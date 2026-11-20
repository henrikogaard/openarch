# Wave 3 — live co-editing, admin UIs, resilience, WebDAV, snapshot diffs, perf, review

**Date:** 2026-11-21 · **Status:** building. Items 1–7 from the post-spec assessment, then
PR reassessment + merge prep.

| # | Item | Plan sketch | Test gate |
|---|---|---|---|
| 1 | **Live co-editing client (C3 client half)** | `useOps` hook: batching editor edits into ops, client-side `applyOp` projection, POST `/ops` with rejection handling (toast + conflict review on divergence), RT `ops` broadcast applied live to the open canvas | E2E: two contexts, add/delete visible cross-client within seconds; unit: batcher merges N edits into ordered ops |
| 2 | **Admin UIs** | Settings screens for People & tokens (mint/revoke, shown-once reveal), Invites (create/list/revoke/copy link), Email setup (provider form + mandatory test-send gate before invite-by-email surface enablement) | jsdom render tests + integration against real endpoints in server E2E |
| 3 | **Session/offline resilience** | 401 handler → re-login prompt (not "Save failed"); RT hub auto-reconnect with backoff + presence restore; honest "offline" badge | unit + server E2E for re-auth flow |
| 4 | **WebDAV adapter** | `WebDavRepository` over fetch with the same `FolderDriftError` contract; CORS note in UI | contract tests (mock fetch): list/get/save round-trip + drift rejection |
| 5 | **Snapshot visual diff** | Collaborate: per-snapshot "visual diff" — render two SVG exports side-by-side with added/removed/outlines + counts | unit on the diff classifier; component render test |
| 6 | **Perf hardening** | AOEF parse in a worker for imports (web), catalogue list virtualization via `content-visibility` windowing | existing perf e2e stays green; new: 10k-row catalogue render budget |
| 7 | **Third review pass** | Subagent review wave over the new surface (ops engine, event store, auth ladder, concurrency seams), fix findings with tests | findings fixed + tests added |

Merge prep after 1–7: rebase/aggregate into logical commits, full local matrix (typecheck,
unit, build, local E2E, server E2E), update PR body with wave-3 scope, confirm CI + review
checks, then hand back for the merge decision.
