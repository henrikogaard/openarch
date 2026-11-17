# ADR 0003 — Versioned, data-driven metamodel

- Status: Accepted
- Date: 2026-11-17

## Context

ArchiMate 3.2 is broadly supported; 4.0 is emerging. Hard-coding element types into components
would make a version upgrade a rewrite.

## Decision

`ELEMENT_TYPES`, `RELATIONSHIP_TYPES`, `VIEWPOINTS`, and notation metadata live in a registry in
`packages/core`. The palette, magic connector, validation, exporters, and analysis views all read
from that registry. Plugins can extend it. The active version is recorded on the model.

## Consequences

- Adding 4.0 means adding a registry, not touching the UI.
- The magic connector uses generic kind/layer rules rather than an exhaustive combination matrix.
- Validation warnings for unusual combinations are intentional; the standard allows contextual
  relationships that a generic rule engine cannot fully judge.
