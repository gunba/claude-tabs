import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./Dropdown.css";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
}

interface MenuRect {
  top: number;
  left: number;
  minWidth: number;
}

const MAX_MENU_HEIGHT = 280;
const ITEM_HEIGHT = 26;
const TYPE_BUFFER_RESET_MS = 600;

export function Dropdown({
  value,
  onChange,
  options,
  disabled,
  className,
  ariaLabel,
  title,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const typeBufferRef = useRef("");
  const typeTimerRef = useRef<number | null>(null);

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selectedLabel = selectedIdx >= 0 ? options[selectedIdx].label : "";

  // [DC-05] Viewport-flip-above: compares spaceBelow vs spaceAbove, flips when needed.
  // Motivation: webkit2gtk on Linux Tauri renders native <option> via GTK, ignoring CSS;
  // this portaled Dropdown replaces all 11 native <select> sites.
  const updateRect = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const desiredHeight = Math.min(MAX_MENU_HEIGHT, options.length * ITEM_HEIGHT + 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    setMenuRect({
      top: flipAbove ? Math.max(4, rect.top - desiredHeight - 4) : rect.bottom + 4,
      left: rect.left,
      minWidth: rect.width,
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) updateRect();
  }, [open, updateRect]);

  // [DC-04] Outside-click via capture-phase pointerdown: fires before bubble-phase handlers.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onReposition = () => updateRect();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateRect]);

  useEffect(() => {
    if (!open || highlight < 0 || !menuRef.current) return;
    const item = menuRef.current.querySelector<HTMLElement>(
      `[data-dropdown-idx="${highlight}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  useEffect(() => {
    return () => {
      if (typeTimerRef.current !== null) window.clearTimeout(typeTimerRef.current);
    };
  }, []);

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const moveHighlight = useCallback(
    (dir: 1 | -1) => {
      if (options.length === 0) return;
      let next = highlight;
      for (let i = 0; i < options.length; i++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next].disabled) break;
      }
      setHighlight(next);
    },
    [highlight, options]
  );

  const commit = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      closeAndRefocus();
    },
    [options, onChange, closeAndRefocus]
  );

  const openMenu = useCallback(() => {
    setOpen(true);
    setHighlight(selectedIdx >= 0 ? selectedIdx : 0);
  }, [selectedIdx]);

  const firstEnabledIdx = useCallback(() => {
    for (let i = 0; i < options.length; i++) {
      if (!options[i].disabled) return i;
    }
    return -1;
  }, [options]);

  const lastEnabledIdx = useCallback(() => {
    for (let i = options.length - 1; i >= 0; i--) {
      if (!options[i].disabled) return i;
    }
    return -1;
  }, [options]);

  const onTriggerKey = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) openMenu();
        else moveHighlight(e.key === "ArrowUp" ? -1 : 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!open) openMenu();
        else if (highlight >= 0) commit(highlight);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        closeAndRefocus();
      }
    },
    [disabled, open, openMenu, moveHighlight, highlight, commit, closeAndRefocus]
  );

  // [DC-02] Keyboard nav: arrows, Home/End (skip-disabled), type-to-search (skip-disabled), Tab closes.
  // [DC-03] Enter/Space guard: skipped in global listener when trigger has focus to prevent double-fire.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Enter/Space on the trigger is handled by onTriggerKey above; skip here
      // so we don't double-fire when the trigger holds focus.
      const triggerHasFocus = triggerRef.current === document.activeElement;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
      } else if (e.key === "Enter" || e.key === " ") {
        if (triggerHasFocus) return;
        e.preventDefault();
        if (highlight >= 0) commit(highlight);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeAndRefocus();
      } else if (e.key === "Tab") {
        setOpen(false);
      } else if (e.key === "Home") {
        e.preventDefault();
        const idx = firstEnabledIdx();
        if (idx >= 0) setHighlight(idx);
      } else if (e.key === "End") {
        e.preventDefault();
        const idx = lastEnabledIdx();
        if (idx >= 0) setHighlight(idx);
      } else if (e.key.length === 1) {
        typeBufferRef.current += e.key.toLowerCase();
        if (typeTimerRef.current !== null) window.clearTimeout(typeTimerRef.current);
        typeTimerRef.current = window.setTimeout(() => {
          typeBufferRef.current = "";
        }, TYPE_BUFFER_RESET_MS);
        const idx = options.findIndex((o) =>
          !o.disabled && o.label.toLowerCase().startsWith(typeBufferRef.current)
        );
        if (idx >= 0) setHighlight(idx);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, moveHighlight, highlight, commit, closeAndRefocus, options, firstEnabledIdx, lastEnabledIdx]);

  // [DC-01] Portaled listbox: trigger=aria-haspopup=listbox button, menu=role=listbox in document.body,
  // options=role=option with aria-selected. className applies to trigger only (1:1 <select> replacement).
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger${className ? ` ${className}` : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="dropdown-trigger-label">{selectedLabel}</span>
        <span className="dropdown-trigger-caret" aria-hidden="true">{"\u25BE"}</span>
      </button>
      {open && menuRect &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: menuRect.top,
              left: menuRect.left,
              minWidth: menuRect.minWidth,
            }}
          >
            {options.map((opt, idx) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                data-dropdown-idx={idx}
                className={
                  "dropdown-item" +
                  (idx === highlight ? " dropdown-item-highlight" : "") +
                  (opt.value === value ? " dropdown-item-selected" : "") +
                  (opt.disabled ? " dropdown-item-disabled" : "")
                }
                disabled={opt.disabled}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(idx);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
