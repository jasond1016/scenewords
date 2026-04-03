import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  currentIndex: number | null;
  totalItems: number;
  onClose: () => void;
  media: ReactNode;
  mediaHint: ReactNode;
  sidebar?: ReactNode;
  onExpandMedia?: () => void;
  closeLabel: string;
}

export function MediaOverlayFrame(props: Props) {
  const {
    title,
    currentIndex,
    totalItems,
    onClose,
    media,
    mediaHint,
    sidebar,
    onExpandMedia,
    closeLabel,
  } = props;

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
        <div className="grid h-full w-full min-w-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative flex min-w-0 flex-1 flex-col border-b border-border md:border-b-0 md:border-r">
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

            <div
              className={`relative flex min-h-0 flex-1 items-center justify-center bg-transparent p-2 transition-opacity duration-200 sm:p-4 ${
                onExpandMedia ? "cursor-zoom-in hover:opacity-[0.985]" : ""
              }`}
              onClick={(event) => {
                if (!onExpandMedia) {
                  return;
                }
                const target = event.target;
                if (
                  target instanceof Element &&
                  target.closest("button,a,input,summary,details,video")
                ) {
                  return;
                }
                onExpandMedia();
              }}
              onKeyDown={(event) => {
                if (!onExpandMedia) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onExpandMedia();
                }
              }}
              role={onExpandMedia ? "button" : undefined}
              tabIndex={onExpandMedia ? 0 : undefined}
            >
              <div className="flex h-full w-full items-center justify-center rounded-[24px] border border-border bg-surface-raised/80 px-2 py-2 shadow-[var(--shadow-md)] sm:px-4 sm:py-4">
              {media}
              </div>
            </div>

            <div className="border-t border-border px-5 py-2 font-mono text-[11px] text-[var(--c-text-tertiary)]">
              {mediaHint}
            </div>
          </div>
          {sidebar ? (
            <aside className="min-h-0 overflow-hidden bg-surface/72 md:border-l-0">
              <div className="h-full overflow-y-auto px-4 py-4 md:px-5" data-overlay-scroll="allow">
                {sidebar}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
