import { Info, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  currentIndex: number | null;
  totalItems: number;
  isInfoHidden: boolean;
  onToggleInfo: () => void;
  onClose: () => void;
  media: ReactNode;
  mediaHint: ReactNode;
  sidebar?: ReactNode;
  showInfoLabel: string;
  hideInfoLabel: string;
  closeLabel: string;
}

export function MediaOverlayFrame(props: Props) {
  const {
    title,
    currentIndex,
    totalItems,
    isInfoHidden,
    onToggleInfo,
    onClose,
    media,
    mediaHint,
    sidebar,
    showInfoLabel,
    hideInfoLabel,
    closeLabel,
  } = props;
  const infoToggleLabel = isInfoHidden ? showInfoLabel : hideInfoLabel;
  const toggleButtonClass =
    "absolute z-30 inline-flex h-14 w-9 items-center justify-center rounded-l-2xl rounded-r-xl border border-border bg-surface/88 text-[var(--c-text-secondary)] shadow-[var(--shadow-sm)] backdrop-blur-md transition-[background-color,border-color,color,opacity,transform] duration-200 hover:border-[var(--c-border-strong)] hover:bg-surface-raised hover:text-[var(--c-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-border-focus)]";

  return (
    <div
      className="fixed inset-0 z-50 h-dvh bg-overlay p-2 backdrop-blur-[3px] sm:p-3"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full overflow-hidden rounded-2xl border border-border bg-canvas shadow-[var(--shadow-overlay)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Media panel */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 sm:px-5">
            <strong className="text-sm font-semibold text-[var(--c-text)]">{title}</strong>
            <div className="flex items-center gap-2">
              {totalItems > 1 ? (
                <span className="rounded-full bg-[var(--c-surface-inset)] px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums text-[var(--c-text-secondary)]">
                  {(currentIndex ?? 0) + 1} / {totalItems}
                </span>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--c-surface-inset)]/72 text-[var(--c-text-tertiary)] transition-[background-color,color,transform] duration-150 hover:-translate-y-0.5 hover:bg-surface-raised hover:text-[var(--c-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-border-focus)]"
                onClick={onClose}
                aria-label={closeLabel}
                title={closeLabel}
              >
                <X size={16} weight="regular" />
              </button>
            </div>
          </div>

          {/* Media area */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
            <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface-raised px-2 py-2 sm:px-4 sm:py-4">
              {media}
            </div>
          </div>

          {/* Footer hint */}
          <div className="hidden border-t border-border px-5 py-2 font-mono text-[11px] text-[var(--c-text-tertiary)] sm:block">
            {mediaHint}
          </div>
        </div>

        {/* Sidebar */}
        {sidebar ? (
          <div
            className={`absolute bottom-2 right-2 top-[58px] z-30 w-[min(360px,calc(100%-1rem))] overflow-visible transition-[opacity,transform] duration-200 sm:w-[360px] ${
              isInfoHidden
                ? "pointer-events-none translate-x-4 opacity-0"
                : "pointer-events-auto translate-x-0 opacity-100"
            }`}
            aria-hidden={isInfoHidden}
          >
            <button
              type="button"
              className={`${toggleButtonClass} -left-3 top-1/2 -translate-y-1/2 ${
                isInfoHidden ? "pointer-events-none opacity-0" : "opacity-100"
              }`}
              onClick={onToggleInfo}
              aria-label={infoToggleLabel}
              aria-pressed={!isInfoHidden}
              title={infoToggleLabel}
            >
              <Info size={16} weight="regular" />
            </button>
            <aside className="h-full overflow-hidden rounded-xl border border-border bg-surface/94 p-3 shadow-[var(--shadow-lg)] backdrop-blur-md">
              {sidebar}
            </aside>
          </div>
        ) : null}

        {sidebar && isInfoHidden ? (
          <button
            type="button"
            className={`${toggleButtonClass} right-2 top-1/2 -translate-y-1/2`}
            onClick={onToggleInfo}
            aria-label={infoToggleLabel}
            aria-pressed={!isInfoHidden}
            title={infoToggleLabel}
          >
            <Info size={16} weight="regular" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
