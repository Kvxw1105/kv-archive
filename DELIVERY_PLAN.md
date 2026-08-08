# KV Archive v0.16.2 Delivery Plan

Deliverables:

1. installable browser extension ZIP;
2. standalone Notes PWA ZIP;
3. Agent Bridge ZIP;
4. complete source ZIP;
5. release-candidate ZIP containing all packages and release/acceptance documents;
6. SHA-256 manifest.

Release gate:

- full tests and performance gates pass;
- extension ZIP has `manifest.json` at its root;
- ZIP CRC/path/version checks pass;
- no `.tmp`, `node_modules`, credentials or browser profile data are included;
- delivery wording distinguishes local verification from real-account Chrome acceptance.
