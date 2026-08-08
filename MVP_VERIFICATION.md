# ContextVault MVP v0.2.0 Verification

## User-reported defect

The v0.1 extension triggered four separate downloads and surfaced raw/canonical JSON as primary outputs. This made a normal one-conversation export feel like a developer debugging workflow.

## Corrected behavior

Each export action now produces exactly one file:

- Readable HTML: one `.html` file, default and recommended.
- Markdown: one `.md` file.
- Complete backup: one `.zip` file containing readable and technical artifacts.

The readable HTML includes a conversation layout, light/dark support, code blocks and local text search. Technical JSON is not shown in the default file.

## Automated verification

- TypeScript strict typecheck: PASS
- Automated tests: 13 / 13 PASS
- Core build: PASS
- Extension build: PASS
- Extension JavaScript syntax checks: PASS
- Manifest JSON parse: PASS
- Generated ZIP tested by system unzip: PASS

Regression coverage includes:

- active branch restoration
- non-active branch preservation
- unknown content preservation
- orphan reporting
- readable HTML output
- one artifact per export mode
- CRC32 correctness
- valid ZIP central directory
- CLI success and failure paths

## Environment limitation

A real logged-in ChatGPT export with the rebuilt v0.2 extension has not been executed inside this container. That final browser path must be tested in a local Chrome or Edge session.
