# ADR 0001 — Local-first storage with an optional server

- Status: Accepted
- Date: 2026-11-17

## Context

The tool must work without an account, without infrastructure, and offline. Teams also need a
shared repository with collaboration features. These requirements pull in opposite directions.

## Decision

All consumers depend on a single `ModelRepository` interface. `LocalRepository` (IndexedDB +
native JSON files) is the default. `ServerRepository` talks to the self-hosted Fastify API.
`GitRepository` stores models as Git files. The UI never talks to a storage backend directly.

## Consequences

- The static web app is fully functional on its own.
- Collaboration features (locking, comments, baselines) are only available in server mode.
- Adding a backend is additive: implement the interface, no UI rewrite.
- Version conflicts are handled by the server (`If-Match`), not by the repository interface.
