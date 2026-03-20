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
  backLabel: string;
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
    backLabel,
  } = props;

  return (
    <div
      className="fixed inset-0 z-50 h-dvh bg-overlay p-1.5 backdrop-blur-[2px] sm:p-3"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full overflow-hidden rounded-2xl border border-border bg-canvas sm:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4">
            <strong className="text-sm text-[var(--c-text)]">{title}</strong>
            <div className="flex items-center gap-2">
              {totalItems > 1 ? (
                <span className="rounded-full bg-[rgba(0,0,0,0.05)] px-2 py-1 text-[11px] font-semibold text-[var(--c-text-secondary)]">
                  {(currentIndex ?? 0) + 1} / {totalItems}
                </span>
              ) : null}
              <button
                type="button"
                className="rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-canvas"
                onClick={onToggleInfo}
              >
                {isInfoHidden ? showInfoLabel : hideInfoLabel}
              </button>
              <button
                type="button"
                className="rounded-full bg-cta px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-cta-hover"
                onClick={onClose}
              >
                {backLabel}
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center p-1.5 sm:p-4">
            <div className="flex h-full w-full items-center justify-center rounded-xl border border-border bg-surface-raised px-2 py-2 sm:px-4 sm:py-4">
              {media}
            </div>
          </div>

          <div className="hidden border-t border-border px-4 py-2 text-[11px] text-[var(--c-text-tertiary)] sm:block">
            {mediaHint}
          </div>
        </div>

        {!isInfoHidden && sidebar ? (
          <aside className="absolute inset-x-2 bottom-2 top-[62px] z-30 overflow-hidden rounded-xl border border-border bg-surface/95 p-3 shadow-[0_16px_40px_rgba(36,31,26,0.2)] backdrop-blur-[1.5px] sm:static sm:inset-auto sm:w-[360px] sm:shrink-0 sm:rounded-none sm:border-l sm:border-t-0 sm:bg-surface sm:p-3 sm:shadow-none sm:backdrop-blur-none">
            {sidebar}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
