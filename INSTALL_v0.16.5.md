# Install KV Archive v0.16.5

## Clean install

1. Extract `KV-Archive-v0.16.5-extension-install.zip`.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked**.
4. Select the folder whose root directly contains `manifest.json`.
5. Confirm the displayed version is `0.16.5`.

## Upgrade while preserving browser-local data

Keep the same loaded extension directory and extension identity:

1. Close active KV Archive workspace tabs.
2. Back up the currently loaded extension folder.
3. Replace its files with the extracted v0.16.5 files without changing the folder path.
4. Click **Reload** on `chrome://extensions`.
5. Confirm version `0.16.5` and verify the Local Library and Basket remain present.

If you intentionally do not need prior browser-local data, removing the old unpacked extension and loading the new folder is acceptable.
