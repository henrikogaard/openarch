# ADR 0004 — Tier-2 multi-user editing: event-sourced ops first, CRDT only behind a validation-first design

- Status: Accepted (owner decision, 2026-11-20)
- Supercedes: the blanket "Do not add real-time CRDT editing" rule in AGENTS.md §13 and the
  roadmap §14 risk line ("Real-time collaboration: not planned"). The *reasoning* that led to
  those lines remains binding context — this ADR replaces the conclusion, not the analysis.

## Context

AGENTS.md §13 forbade CRDT editing because:

1. The model is a **strongly constrained graph** — every write must pass `validateModel`, views
   must stay faithful projections, and AOEF conformance is the gate. CRDTs guarantee
   *convergence*, not *validity*: merging "delete element" with "edit its relationship"
   produces dangling references, and a CRDT has **no reject-path**.
2. Undo history, raw-XML passthrough, and full-snapshot versioning all assume a whole-model
   document, not a transparent CRDT state.
3. For the target teams, simultaneous same-field edits are rare; optimistic locking + the
   three-way review handled real conflicts.

The owner now wants tier-2 servers to offer genuine multi-user collaboration — people
editing the same workspace at the same time — and has lifted the ban.

## Decision

Two statements:

1. **The default tier-2 collaboration engine is an event-sourced operation log (OT-style),
   not a CRDT.** Concurrency is achieved by the means that already exist in the product —
   per-operation *validated* writes applied to a server-authored history — extended with a
   live broadcast so all editors converge continuously instead of colliding on full-model
   saves:
   - `op` — the unit: `{ kind, path, before?, after? }` for elements/relationships/views/
     properties/domains/artefacts; ops are small, idempotent, replayable in order.
   - Every op is validated (`validateModel` against the projected result) before it enters
     the log — a bad op is **rejected at the door, never converged around**. Invariant 6
     survives by construction rather than by luck.
   - **Storage is the log**: tier-2 persistence becomes `events/<workspace>/<seq>.jsonl` +
     periodic snapshots (`snapshots/<workspace>/<n>.json`), compacted on write. The event log
     *is* the audit trail *is* the version history *is* the multi-user merge record — one
     artifact instead of four reconciled ones.
   - Offline/single-writer tiers (1 and 3) are unaffected: they store whole-model JSON files
     exactly as today; only tier-2 (the shared server) speaks events.
2. **A CRDT is permitted only under a validation-first design**, i.e. a future ADR must show,
   before implementation:

   - a **reject-path or repair pass**: ops failing `validateModel` after convergence are
     either prevented pre-merge at the client, or auto-tombstone-pruned post-merge with the
     user told (the machinery exists: `removeElements`' pruning invariants);
   - **snapshot compatibility**: CRDT state snapshots must be exportable to the same native
     JSON and AOEF as everything else, and importable losslessly on tiers 1/3;
   - **undo story**: per-author undo (Yjs `UndoManager` class) or an explicit trade-off note;
   - **why the op-log is insufficient for the use case at hand.** Absent that, the op log is
     the answer, because field-level simultaneous typing inside one ArchiMate workspace is a
     rare event compared to diagramming tools with freeform canvases.

## Consequences

- **On reimposed wording**: AGENTS.md §13 now reads "Do not add a CRDT without a
  validation-first ADR; the tier-2 collaboration engine is the validated op log."
- **Migration**: existing file-persistence server installs convert on boot — the first
  `models.json` becomes snapshot 0 plus one synthetic `op(kind: snapshot_import)`; no
  data-migration step for users, and back-ups remain compatible via the snapshot artifact.
- **The three-way review remains the structural fallback** for any conflict the streaming op
  protocol cannot auto-merge — it is not removed by the event log; the event log simply makes
  full-model collisions rare.
- **Group comments** (roadmap commentary about "not planned") and per-op attribution
  (`by` on every op join the audit chain) unify what was previously a snapshot-only history.
- Risk accepted: op-log engine is more work than a naive CRDT bolt-on, but偿还合法状态:
  validity must never depend on "everyone merges correctly" — it depends on "invalid ops
  never land," which is the product's core promise to AOEF-conformant users.
