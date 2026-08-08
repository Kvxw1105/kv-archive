# KV Archive v0.16.6 Real Chrome Acceptance

## Upgrade

1. Preserve the current loaded extension folder as a rollback copy.
2. Replace its files with the v0.16.6 extension package contents.
3. Reload KV Archive in `chrome://extensions`.
4. Confirm version `0.16.6`.

A clean reinstall is also acceptable when prior local data is not needed.

## Appearance acceptance

Run on the popup and at least Backup Center, Conversation Basket, Local Library, Project Context and Obsidian Graph.

1. Choose **浅色**. Confirm all pages stay light after navigation and reopening the popup.
2. Choose **深色**. Confirm all pages stay dark and no white flash appears during navigation.
3. Choose **自动**. Change the operating-system theme. Confirm the open page updates without reload.
4. Open two KV Archive pages. Change the theme in one page. Confirm the other page updates or updates after focus/reopen.
5. Confirm forms, cards, tables, dialogs, progress feedback and disabled buttons remain legible in both modes.
6. Use keyboard Tab and arrow keys on the three-way theme control.
7. Test browser zoom at 80%, 100%, 125% and 150%.
8. Enable the OS/browser reduced-motion preference and confirm theme switching does not add distracting motion.

## Regression acceptance

- Run one current-conversation save.
- Run one manual incremental check.
- Open a large Conversation Basket.
- Export one Portable Capture package.
- Generate one Project Context candidate.

Theme switching must not change saved data, task state or export results.
