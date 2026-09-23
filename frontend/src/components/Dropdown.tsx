import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

export function Dropdown({
  label,
  highlighted = false,
  align = "right",
  children,
}: {
  label: ReactNode;
  highlighted?: boolean;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`dropdown-trigger ${open ? "dropdown-trigger-open" : ""} ${highlighted ? "dropdown-trigger-set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        <CaretDown size={11} weight="regular" />
      </button>
      {open ? (
        <div className={`menu-popover ${align === "left" ? "menu-popover-left" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownOption({
  label,
  meta,
  selected,
  onSelect,
}: {
  label: ReactNode;
  meta?: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={`menu-item ${selected ? "menu-item-active" : ""}`}
      onClick={onSelect}
    >
      <span className="menu-item-label">{label}</span>
      {selected ? (
        <Check size={12} weight="bold" className="shrink-0" />
      ) : meta != null ? (
        <span className="menu-item-meta tabular-nums">{meta}</span>
      ) : null}
    </button>
  );
}
