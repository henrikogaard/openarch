# ADR 0002 — AOEF as the interchange format

- Status: Accepted
- Date: 2026-11-17

## Context

ArchiMate tools interoperate through the Open Group's ArchiMate Open Exchange Format (AOEF), an
XSD-defined XML format. Round-trip fidelity matters: element IDs, relationship IDs, and view
layouts must survive import/export.

## Decision

`packages/core` owns an AOEF parser/serializer. Parsed entities retain their original XML fragment
in a `raw` field; serialization starts from that fragment and overwrites only understood fields.
This preserves unknown AOEF extensions. A native JSON format (without passthrough data) exists for
Git-friendly diffs and local storage.

## Consequences

- Real-world models (e.g. ArchiSurance) round-trip in tests.
- New AOEF attributes require explicit parsing only where the app needs to read them.
- The native JSON format is deliberately not an interchange target — use AOEF for that.
