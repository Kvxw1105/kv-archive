# Install KV Archive v0.16.2

## Fresh install

1. Extract `KV-Archive-v0.16.2-extension-install.zip` to a permanent folder.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose “Load unpacked” and select the extracted folder containing `manifest.json`.
5. Confirm the displayed version is `0.16.2`.

## Upgrade while preserving browser-local data

Keep the same loaded extension folder and extension ID:

1. Back up the currently loaded extension folder.
2. Extract the v0.16.2 ZIP.
3. Replace the files inside the currently loaded folder; do not nest the new folder inside it.
4. Click “Reload” on `chrome://extensions`.
5. Confirm version `0.16.2` and verify the Basket and Library still exist.

Loading v0.16.2 from a different folder may create a different unpacked-extension ID and therefore a separate IndexedDB namespace.

## Rollback

Restore the backed-up old files into the same folder and click “Reload”. Do not remove the extension first when data preservation matters.
