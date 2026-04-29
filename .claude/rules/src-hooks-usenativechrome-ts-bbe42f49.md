---
paths:
  - "src/hooks/useNativeChrome.ts"
---

# src/hooks/useNativeChrome.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Platform

- [PL-01 L9] Linux custom titlebar: tauri.conf.json sets decorations:false globally. App.tsx renders the custom Header on Linux unless linux_use_native_chrome() selects native chrome; that command returns true for KDE Wayland, where App.tsx restores native decorations via setDecorations(true). default.json grants core window permissions for set-decorations plus the custom Header drag/minimize/toggle-maximize commands.
  - Confirmed by debug build console on Linux/KDE/Wayland: setDecorations(true) failed with missing core:window:allow-set-decorations before the capability was added. The fallback Header uses startDragging(), minimize(), and toggleMaximize(), so those explicit permissions are granted alongside set-decorations.
