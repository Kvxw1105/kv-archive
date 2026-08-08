# Public Repository Preflight — Prepared Seed

Date: 2026-08-09

## Preparation performed

- generated build outputs removed from the Git seed (`dist/`, `apps/*/dist/`, `.tmp/`);
- `.gitignore` expanded for generated output, env files, private keys and coverage;
- unrelated synthetic examples renamed to neutral `AtlasDemo` / `示例` values before first public Git history;
- original early ContextVault PRD preserved under `docs/history/`, while root `PRD.md` is current;
- third-party notice/license files retained;
- no project-level open-source license added.

## Static scan result

The prepared seed was scanned for common OpenAI/Google/GitHub token forms, private-key headers, credential-like files and user-home paths. No actual secret or credential file was found.

The seed was also searched for unrelated owner-specific project/IP sample labels; none remain in committed fixtures or examples.

Synthetic tests intentionally contain fake `sandbox:/mnt/data/...` strings to verify archive parsing. They are fixture data and not machine-local secrets.

## Verification after sanitization

- `npm ci`: PASS
- TypeScript: PASS
- deterministic regression: 294/294 PASS
- seven performance gates: PASS

See `GITHUB_HANDOFF_VERIFICATION.md`.

## Publication blockers / decisions

- Project-level license remains an owner decision; public repository creation may proceed without selecting one.
- Real owner-profile/browser artifacts must remain outside the repository.
- Bootstrap Agent must repeat the staged-file and secret/private-data preflight immediately before the first push.
