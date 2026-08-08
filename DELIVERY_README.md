# KV Archive v0.16.11 Delivery

Use `KV-Archive-v0.16.11-extension-install.zip` for Chrome installation and `KV-Archive-Notes-PWA-v0.16.11.zip` for the Notes PWA build.

v0.16.11 fixes the observed scheduled-backup UI binding crash and introduces backward-compatible content-addressed conversation mapping-node storage with reusable mapping-reference chunks. Snapshot retention now protects transitive chunk dependencies, and scheduled status exposes per-cycle reused bytes/nodes.

No IndexedDB migration is introduced. Existing v0.16.10 whole-conversation content objects stay readable. Read `INSTALL_v0.16.11.md` before upgrading and run `REAL_V0.16.11_ACCEPTANCE.md` against existing owner data.
