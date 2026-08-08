# Install KV Archive v0.16.10

## Recommended upgrade — preserve existing browser data

1. Export any especially important recovery/archive package you want as an extra safety copy.
2. Close open KV Archive workspace pages.
3. Extract `KV-Archive-v0.16.10-extension-install.zip`.
4. Back up the folder currently loaded by Chrome.
5. Copy the extracted v0.16.10 files over that same loaded folder, keeping the folder path unchanged.
6. Open `chrome://extensions` and click **Reload** on KV Archive.
7. Confirm the extension version is `0.16.10`.
8. Open Local Library, Capture, Project State and the incremental/scheduler surfaces and confirm existing data is still present.

Keeping the same unpacked-extension folder normally keeps the same extension ID and IndexedDB storage.

## Notes PWA

Serve/extract `KV-Archive-Notes-PWA-v0.16.10.zip` from the same origin/path strategy used for the previous PWA. Reload once after the new Service Worker installs. The new worker only removes older `kv-archive-notes-*` caches.

## Clean install

Removing the existing unpacked extension can create a new extension-local data area. Do this only when you intentionally want a clean environment and have exported data you need.

## Database compatibility

No IndexedDB migration is required:

- Extension database version: 13;
- Notes PWA database version: 1.
