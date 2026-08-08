# Public Repository Policy

## Publication intent

The repository may be public so development, maintenance, issues, CI and Agent collaboration become easier. Public visibility alone does not grant an open-source license.

## License status

As of the v0.16.11 GitHub handoff baseline, the project has **no chosen project-level license** and `package.json` remains `private: true` to prevent accidental npm publication.

Do not automatically add MIT, Apache-2.0, GPL or another project license during repository bootstrap. The owner should make that decision separately. Existing third-party MIT notices and license copies must remain intact.

## Never publish

- real private conversations, screenshots or exported archives;
- browser cookies, access tokens, OAuth tokens or signed temporary URLs;
- private keys, `.env` secrets or personal credentials;
- local database dumps copied from the owner's browser profile;
- user-specific diagnostic bundles unless explicitly redacted;
- unrelated private project/IP names in synthetic fixtures when a neutral example serves the same purpose.

## First-public-history rule

Because no prior Git history exists, sanitize before the first commit. After public push, avoid history rewriting except for a genuine secret exposure incident.

The prepared seed replaces unrelated synthetic names with neutral `AtlasDemo` / `示例` examples. This is a public-repo hygiene change only.

## Preflight

Before first push:

1. inspect ignored/generated files;
2. scan common secret/key patterns;
3. search for machine-local paths and real exported content;
4. run the full deterministic test suite;
5. preserve `THIRD_PARTY_NOTICES.md` and `licenses/`;
6. review staged files with `git diff --cached --stat` and `git diff --cached --check`.
