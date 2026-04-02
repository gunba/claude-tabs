---
paths:
  - "src/components/ModalOverlay/**"
---

# Modal Overlay

<!-- Codes: MO=Modal Overlay -->

- [MO-01] Shared modal wrapper: fixed overlay, inset 0, z-index 100. modal-content has frosted glass: background color-mix(bg-surface 93%, transparent) + backdrop-filter blur(12px). Blocks all keystrokes except Escape and Ctrl+comma via stopPropagation. Backdrop click calls onClose.
  - Files: src/components/ModalOverlay/ModalOverlay.tsx, src/components/ModalOverlay/ModalOverlay.css
