# Install KV Archive v0.16.9

## Preserve existing browser data

1. Close all open KV Archive pages.
2. Extract `KV-Archive-v0.16.9-extension-install.zip`.
3. Back up the folder currently loaded by Chrome.
4. Copy the extracted v0.16.9 files over that same loaded folder, keeping the folder path unchanged.
5. Open `chrome://extensions` and click **Reload** on KV Archive.
6. Confirm version `0.16.9`.

Keeping the same unpacked-extension folder normally keeps the same extension ID and IndexedDB storage.

## Clean install

Remove the prior extension, extract the ZIP and choose **Load unpacked** on the folder whose root directly contains `manifest.json`.

A clean install uses a new browser-local data area. Export important data before removal.

No IndexedDB migration is required for v0.16.9; the database version remains 13.
