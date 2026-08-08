# Install KV Archive v0.16.3

## Fresh install

1. Extract `KV-Archive-v0.16.3-extension-install.zip` to a permanent folder.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose “Load unpacked” and select the folder containing `manifest.json`.
5. Confirm the displayed version is `0.16.3`.

## Upgrade while preserving browser-local data

1. Back up the currently loaded extension folder.
2. Close active KV Archive workspace pages.
3. Extract the v0.16.3 ZIP.
4. Replace the files inside the currently loaded extension folder; do not nest the new folder inside it.
5. Click “Reload” on `chrome://extensions`.
6. Confirm version `0.16.3`.

v0.16.3 has no database migration. Loading from a different folder can create a different unpacked-extension ID and a separate IndexedDB namespace.
