# Contributing to OpenArch

OpenArch is an open-source, local-first ArchiMate® 3.2 modelling tool. Contributions are
welcome — this file is the short path from clone to merged PR.

## Ground rules

1. **Read `AGENTS.md` first** — especially the invariants (§6) and the "do not do" list
   (§13). PRs that break an invariant (AOEF conformance, one canonical model, local-first)
   will not be merged.
2. *ArchiMate® is a registered trademark of The Open Group.* Use it descriptively only, and
   never imply certification.
3. Be kind. Review the code, not the person.

## Development setup

Requires Node 22+. `xmllint` (libxml2) enables the AOEF schema-conformance tests.

```bash
git clone <your fork>
cd openarch
npm install
npm run typecheck
npm test
npm run dev            # http://localhost:5173 (local mode)
```

Optional, exercised by CI:

```bash
npm run build
npm run test:e2e                                   # Playwright against the dev server
E2E_SERVER_PORT=8080 npm run test:e2e:server       # server-mode E2E (see below)
npm run cli -- validate examples/archisurance.xml
```

## The definition of done

Every change must satisfy `AGENTS.md` §12 — the short version:

- `npm run typecheck`, `npm test`, and `npm run build` all pass.
- New behaviour has tests (regression tests accompany bug fixes; metamodel changes update
  `packages/core/src/extended.test.ts`).
- AOEF conformance still passes if you touched anything near `packages/core/src/aoef.ts`.
- Docs are updated when behaviour or configuration changed.
- No secrets, tokens, or customer data in the diff.

## Making changes

1. **Branch from `main`** (`feat/<topic>` or `fix/<topic>`); one logical change per PR.
2. **Small and complete.** Prefer several focused PRs over one big one; drive-by cleanup
   belongs in its own PR.
3. **Worktree-friendly:** run `git worktree add .claude/worktrees/<branch> <branch>` if you
   keep several streams alive (`.claude/worktrees/` is git-ignored).
4. **Commit hygiene:** stage explicit paths; the commit contains only the change — no
   generated files, no secrets. Keep the subject ≤ 72 characters, imperative mood.

## Testing philosophy

- Unit tests cover packages; integration tests boot the **real** server and exercise
  auth/RBAC/locking/import/approvals; UI tests render components with jsdom (no canvas
  clicking); Playwright covers the **user-visible** flows, including a dedicated server-mode
  suite (`playwright.server.config.ts`) that caught two real bugs in its first week.
- If your change can be asserted at more than one layer, prefer the lowest layer that
  proves it.

## Submitting

```bash
git push -u origin feat/<topic>
gh pr create --base main
```

In the PR description, include: what changed and why, how it was verified (commands +
results), what you did *not* verify, and residual risk. If you are not the original
author of a contribution idea (e.g. it came from an agent run), say so plainly — the
commit author must be a human who understands the diff.

## Reporting bugs

Open an issue using the **Bug report** template (`.github/ISSUE_TEMPLATE`), including a
minimal model file (AOEF/JSON) that reproduces it and the `openarch doctor` output (add
`--full` if the templates ask for it).

---

*This project is not affiliated with, endorsed by, or certified by The Open Group.*
