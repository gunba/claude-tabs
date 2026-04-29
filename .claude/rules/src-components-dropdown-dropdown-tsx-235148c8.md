---
paths:
  - "src/components/Dropdown/Dropdown.tsx"
---

# src/components/Dropdown/Dropdown.tsx

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Dropdown Component

- [DC-05 L60] Viewport-flip-above: on open, updateRect() computes desired menu height (min(280px, options*26px+8)), compares spaceBelow vs spaceAbove, and sets top to rect.top-height-4 when spaceBelow < desiredHeight AND spaceAbove > spaceBelow. Menu repositions on window resize and scroll. Motivation: webkit2gtk on Linux Tauri delegates native <option> rendering to GTK and ignores CSS, making native <select> unusable; the portaled Dropdown replaces all 11 native <select> sites.
- [DC-04 L82] Outside-click close uses capture-phase pointerdown (document.addEventListener('pointerdown', handler, true)) so it fires before any target's bubble-phase handlers. Clicks on the trigger itself and clicks inside the menu are excluded. The listener is added only when the menu is open and removed on close.
- [DC-02 L182] Keyboard navigation: ArrowUp/ArrowDown move highlight, Home jumps to first enabled option, End jumps to last enabled option. Type-to-search accumulates characters (600 ms reset timer) and jumps to the first enabled option whose label starts with the buffer. Disabled options are skipped by arrow navigation and excluded from type-to-search matches. Tab closes the menu without committing. Escape closes and refocuses the trigger.
- [DC-03 L183] Enter/Space while the trigger has focus is handled by the trigger's own onKeyDown (onTriggerKey) and is explicitly skipped in the global keydown listener (triggerHasFocus guard) to prevent double-fire. Enter/Space while focus is inside the menu (e.g., after arrow navigation) commits the highlighted option via the global listener only.
- [DC-01 L229] Dropdown is a portaled listbox: the trigger is an ARIA combobox button (aria-haspopup=listbox, aria-expanded), the menu is a div with role=listbox rendered into document.body via createPortal, and each option is a button with role=option and aria-selected. className passed to Dropdown applies to the trigger only, making it a 1:1 replacement for native <select> styling.
