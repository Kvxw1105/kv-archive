# Install KV Archive v0.16.4

## Preserve the current browser-local archive

1. Open `chrome://extensions` and keep KV Archive installed.
2. Back up the folder currently loaded by Chrome.
3. Extract `KV-Archive-v0.16.4-extension-install.zip`.
4. Copy the extracted files into the same loaded extension folder, replacing old files while keeping the folder path unchanged.
5. Click `重新加载` on the KV Archive extension card.
6. Confirm version `0.16.4`.

## Fresh install

1. Extract the extension ZIP.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose `加载已解压的扩展程序`.
4. Select the folder whose root directly contains `manifest.json`.

The v0.16.4 change requires no IndexedDB migration. Fresh installation starts with no baseline snapshot, so run `立即增量运行一次` before starting the ten-minute acceptance.
