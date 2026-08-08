# Real v0.16.0 Notes PWA Acceptance

Do not mark v0.16.0 externally accepted until the following is completed on physical devices.

## Android Chrome

1. Serve the PWA over HTTPS or localhost-equivalent secure origin.
2. Install it to the home screen and open in standalone mode.
3. Create at least 20 notes across three Projects and four content kinds.
4. Edit one note twice, restore revision 1, and verify the current revision advances.
5. Archive/unarchive and trash/restore records.
6. Search Chinese and English text, tags and Project names.
7. Export a recovery package, clear site data, reinstall and import through dry run/apply.
8. Enable airplane mode and verify launch, timeline, capture and search remain usable.
9. Close/reopen the app and reboot the phone; verify persistence.
10. Record browser version, device, storage result and any keyboard/safe-area defects.

## iPhone Safari

Repeat the same flow using Add to Home Screen. Specifically verify:

- standalone navigation and status-bar/safe-area layout;
- keyboard does not cover the editor or primary action;
- file download and file-picker import work;
- service-worker offline launch works after Safari/app termination;
- storage remains after several days and low-storage pressure where practical.

## Failure rules

- Data loss, silent revision overwrite, import without dry run, or unrecoverable storage eviction is release-blocking.
- Browser-only success cannot be generalized to both Android and iOS.
- A successful install does not prove synchronization or native-app support.

## Acceptance record

Record device/OS/browser, screenshots, counts before/after import, recovery receipt ID, offline result and unresolved issues. Only then change status from `LOCALLY_VERIFIED` to `REAL_DEVICE_ACCEPTED` for that platform.
