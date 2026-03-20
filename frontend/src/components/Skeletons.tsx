import { Package, ImageSquare, VideoCamera } from "@phosphor-icons/react";

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
          <div className="skeleton aspect-video w-full rounded-lg" />
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
          <div className="skeleton h-9 w-full rounded-lg" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-3 w-12" />
          <div className="skeleton h-9 w-full rounded-lg" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-9 w-full rounded-lg" />
        </div>
      </div>
      <hr className="divider" />
      <div className="space-y-2">
        <div className="skeleton h-3 w-12" />
        <div className="skeleton h-24 w-full rounded-lg" />
      </div>
      <div className="flex gap-2">
        <div className="skeleton h-8 w-16 rounded-md" />
        <div className="skeleton h-8 w-16 rounded-md" />
        <div className="skeleton h-8 w-16 rounded-md" />
      </div>
    </div>
  );
}

/* ── Empty States ───────────────────────────────────── */

export function EmptyStateGeneric({
  icon: Icon = Package,
  title,
  description,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(0,0,0,0.04)]">
        <Icon size={26} weight="regular" className="text-[var(--c-text-tertiary)]" />
      </div>
      <p className="m-0 text-sm font-medium text-[var(--c-text)]">{title}</p>
      {description ? (
        <p className="m-0 max-w-xs text-center text-xs leading-relaxed text-[var(--c-text-secondary)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyStateWorks({ locale }: { locale: string }) {
  const isZh = locale === "zh-CN";
  return (
    <EmptyStateGeneric
      icon={ImageSquare}
      title={isZh ? "还没有作品" : "No works yet"}
      description={
        isZh
          ? "创建第一个生成任务，完成后作品会出现在这里。"
          : "Create your first generation task. Completed works will appear here."
      }
    />
  );
}

export function EmptyStateTasks({ locale }: { locale: string }) {
  const isZh = locale === "zh-CN";
  return (
    <EmptyStateGeneric
      icon={VideoCamera}
      title={isZh ? "暂无任务" : "No tasks yet"}
      description={
        isZh
          ? "在创建页提交任务后，最近的任务会显示在这里。"
          : "Submit a task from the Create page. Recent tasks will show here."
      }
    />
  );
}
