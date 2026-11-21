# openarch (CLI package)

This package publishes the OpenArch command line so it can be run anywhere with
`npx`:

```bash
npx openarch validate model.xml
npx openarch convert model.archimate model.json
npx openarch diff before.json after.json
npx openarch check model.xml rules.json
npx openarch report model.xml report.md
npx openarch iac diff model.json plan.json --fail-on drift
npx openarch doctor
```

The published artifact is a single self-contained ESM bundle (`dist/cli.mjs`,
~650 kB) built from the monorepo source; Node 22+ required. The bundle contains
no secrets, makes no network calls, and writes only the files you name.

Formats in/out: AOEF XML (`.xml`), native JSON (`.json`), Archi `.archimate`,
C4 Structurizr `.dsl`, draw.io `.drawio`, CSV (`.csv`), Mermaid (`.mermaid`).

See the [main repository](https://github.com/henrikogaard/openarch) for the
full product. ArchiMate® is a registered trademark of The Open Group; this
project is not affiliated with, endorsed by, or certified by The Open Group.
