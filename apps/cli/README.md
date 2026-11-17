# @openarch/cli

A small, dependency-free command-line tool for inspecting, validating and converting
OpenArch / ArchiMate® models. It runs on Node.js via [tsx](https://tsx.is/).

## Usage

```sh
npm run cli -w @openarch/cli -- <command> [arguments]
# or, once linked:
openarch <command> [arguments]
```

Run `openarch --help` (or with no arguments) to print usage.

## Commands

### `validate <file>`

Parse a `.xml` file as AOEF or a `.json` file as the native format, run the shared
model validator and print issues grouped by severity. Exits with code `1` when any
error-severity issue is found, otherwise `0`.

```sh
openarch validate model.xml
openarch validate model.json
```

### `list <file>`

Print a plain-text table with the model name and its element, relationship and
view counts.

```sh
openarch list model.json
# Model                  Elements  Relationships  Views
# ---------------------  --------  -------------  -----
# Sample insurance model  8         6              1
```

### `convert <input> <output>`

Convert between formats, chosen from the file extensions:

- `.xml` — ArchiMate Open Exchange Format (AOEF)
- `.json` — OpenArch native model
- `.csv` — elements CSV (output only, via `exportElementsCsv`)
- `.mermaid` / `.mmd` — Mermaid diagram of the first view (output only, via `exportMermaid`)

```sh
openarch convert model.xml model.json
openarch convert model.json model.xml
openarch convert model.xml elements.csv
openarch convert model.xml diagram.mermaid
```

### `diff <a> <b>`

Compare two model files. Elements are matched by id (with name, type and
documentation compared); relationships are matched by id or by their
(type, source, target) tuple. A readable, unified-style summary and change count
are printed.

```sh
openarch diff before.xml after.xml
```

### `doctor`

Print environment information (Node version, platform, loaded model capability)
and a reminder that ArchiMate® is a registered trademark of The Open Group.

```sh
openarch doctor
```

## Exit codes

- `0` — success
- `1` — error (invalid arguments, unreadable/unparseable file, or validation errors)

## Notes

`diffModels` lives locally in `src/diff.ts` and is exported so it can be reused or
tested independently.
