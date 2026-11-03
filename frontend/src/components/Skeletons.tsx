import { Package, ImageSquare } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";

/* ── Skeleton Loaders ───────────────────────────────── */

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card space-y-3 ${className}`}>
      <div className="skeleton h-4 w-2/3" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-4/5" />
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-3">
          <div className="skeleton aspect-video w-full rounded-xl" />
          <div className="skeleton h-3 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonForm() {
  return (
    <div className="card space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <div className="skeleton h-3 w-16" />
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-3 w-12" />
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
      </div>
      <hr className="divider" />
      <div className="space-y-2">
        <div className="skeleton h-3 w-12" />
        <div className="skeleton h-28 w-full rounded-xl" />
      </div>
      <div className="flex gap-2">
        <div className="skeleton h-9 w-20 rounded-full" />
        <div className="skeleton h-9 w-20 rounded-full" />
        <div className="skeleton h-9 w-20 rounded-full" />
      </div>
    </div>
  );
}

/* ── Empty States ───────────────────────────────────── */

export function EmptyStateGeneric({
  icon: Icon = Package,
  title,
  description,
  children,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-4 py-16 text-center" role="status">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--c-surface-inset)] shadow-[var(--shadow-xs)]">
        <Icon size={28} weight="regular" aria-hidden="true" className="text-[var(--c-text-tertiary)]" />
      </div>
      <p className="m-0 text-sm font-semibold text-[var(--c-text)]">{title}</p>
      {description ? (
        <p className="m-0 max-w-xs text-center text-xs leading-relaxed text-[var(--c-text-secondary)]">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function EmptyStateWorks({ filtered, onAction }: { filtered: boolean; onAction: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyStateGeneric
      icon={ImageSquare}
      title={t(filtered ? "works.assetEmpty" : "works.emptyTitle")}
    >
      <button type="button" className="btn-secondary" onClick={onAction}>
        {t(filtered ? "works.clearFilters" : "nav.create")}
      </button>
    </EmptyStateGeneric>
  );
}
