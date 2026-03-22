import { useI18n } from "../i18n";
import type { VideoTaskDetail } from "../types";

export interface SidebarRetryActions {
  disabled: boolean;
  sameSeedLabel?: string;
  newSeedLabel?: string;
  defaultLabel?: string;
  onSameSeed?: () => void;
  onNewSeed?: () => void;
  onDefault?: () => void;
}

export interface SidebarCancelAction {
  disabled: boolean;
  onCancel: () => void;
}

interface Props {
  task: VideoTaskDetail;
  statusLabel: string;
  updatedAtLabel: string;
  isFavorited: boolean;
  downloadUrl?: string | null;
  onReuse: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
  cancelAction?: SidebarCancelAction;
  retryActions?: SidebarRetryActions;
  onCopyRequestJson: () => void;
  isRawResultOpen: boolean;
  onRawResultOpenChange: (open: boolean) => void;
  rawResultPending: boolean;
  rawResultError?: string | null;
  rawResultPayload: string;
  errorText?: string | null;
}

export function MediaDetailSidebar(props: Props) {
  const {
    task,
    statusLabel,
    updatedAtLabel,
    isFavorited,
    downloadUrl,
    onReuse,
    onToggleFavorite,
    onDelete,
    deleteDisabled,
    cancelAction,
    retryActions,
    onCopyRequestJson,
    isRawResultOpen,
    onRawResultOpenChange,
    rawResultPending,
    rawResultError,
    rawResultPayload,
    errorText,
  } = props;
  const { t } = useI18n();

  return (
    <div
      className="flex h-full flex-col gap-3.5 overflow-y-auto overscroll-contain pr-1 sm:pr-0"
      data-overlay-scroll="allow"
    >
      {/* Task info card */}
      <div className="rounded-xl border border-border bg-surface-raised p-3.5">
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-[var(--c-text)]">{t("works.assetDetailTitle")}</h3>
            <p className="m-0 mt-1 truncate font-mono text-[11px] tabular-nums text-[var(--c-text-tertiary)]">
              {task.task_id}
            </p>
            {task.provider_job_id ? (
              <p className="m-0 mt-1 truncate text-[10px] text-[var(--c-text-tertiary)]">
                {t("works.upstreamJob")}: {task.provider_job_id}
              </p>
            ) : null}
            {task.provider_status ? (
              <p className="m-0 mt-0.5 truncate text-[10px] text-[var(--c-text-tertiary)]">
                {t("works.upstreamStatus")}: {task.provider_status}
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-[var(--c-surface-inset)] px-2.5 py-1 text-[10px] font-semibold text-[var(--c-text-secondary)] whitespace-nowrap">
            {statusLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--c-text-secondary)]">
          <InfoCell label={t("works.provider")} value={task.provider} />
          <InfoCell label={t("works.model")} value={task.model} />
          <InfoCell label={t("works.resolution")} value={task.resolution ?? t("common.na")} />
          <InfoCell label={t("works.created")} value={updatedAtLabel} />
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border bg-surface-raised p-3.5">
        <p className="m-0 mb-1.5 text-label">Prompt</p>
        <div
          className="max-h-[40vh] overflow-y-auto overscroll-contain pr-1 sm:max-h-[30vh]"
          data-overlay-scroll="allow"
        >
          <p className="m-0 max-w-prose whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--c-text)]">
            {task.prompt || t("works.emptyPrompt")}
          </p>
          {task.negative_prompt ? (
            <div className="mt-2 border-t border-border pt-2">
              <p className="m-0 mb-1 text-[11px] font-semibold text-[var(--c-text-secondary)]">
                {t("works.negativePrompt")}
              </p>
              <p className="m-0 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--c-text-secondary)]">
                {task.negative_prompt}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-raised p-3.5 space-y-3">
        {/* Tags row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-info-bg px-2 py-1 text-[10px] font-semibold text-info-text">
            {task.asset_type === "image" ? t("works.kindImage") : t("works.kindVideo")}
          </span>
          {isFavorited ? (
            <span className="rounded-full bg-accent-bg px-2 py-1 text-[10px] font-semibold text-accent">
              {t("works.favorited")}
            </span>
          ) : null}
        </div>

        {/* Primary actions row */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={onReuse}
          >
            {t("works.reusePrompt")}
          </button>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="btn-secondary text-xs"
              title={t("works.download")}
            >
              {t("works.download")}
            </a>
          ) : null}
          {cancelAction ? (
            <button
              type="button"
              className="btn-danger text-xs"
              onClick={cancelAction.onCancel}
              disabled={cancelAction.disabled}
            >
              {t("works.cancelInProgress")}
            </button>
          ) : null}
        </div>

        {/* Secondary actions row (retry + favorite) */}
        {(retryActions?.onSameSeed || retryActions?.onNewSeed || retryActions?.onDefault) ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <span className="text-[11px] text-[var(--c-text-tertiary)]">{t("works.retry", { mode: "" }).replace(/[() ]/g, "").trim() || "Retry"}</span>
            {retryActions?.onSameSeed ? (
              <button type="button" className="btn-ghost text-xs" onClick={retryActions.onSameSeed} disabled={retryActions.disabled}>
                {retryActions.sameSeedLabel}
              </button>
            ) : null}
            {retryActions?.onNewSeed ? (
              <button type="button" className="btn-ghost text-xs" onClick={retryActions.onNewSeed} disabled={retryActions.disabled}>
                {retryActions.newSeedLabel}
              </button>
            ) : null}
            {retryActions?.onDefault ? (
              <button type="button" className="btn-ghost text-xs" onClick={retryActions.onDefault} disabled={retryActions.disabled}>
                {retryActions.defaultLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Tertiary: favorite + delete */}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onToggleFavorite}
          >
            {isFavorited ? t("works.unfavorite") : t("works.favorite")}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs text-error-text"
            onClick={onDelete}
            disabled={deleteDisabled}
          >
            {t("works.delete")}
          </button>
        </div>
      </div>

      <details className="rounded-xl border border-border bg-surface-raised p-3.5">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--c-text-secondary)]">
          {t("works.moreActions")}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            className="text-left text-xs text-[var(--c-text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--c-text)]"
            onClick={onCopyRequestJson}
          >
            {t("works.copyRequestJson")}
          </button>
          <details
            open={isRawResultOpen}
            onToggle={(event) => {
              onRawResultOpenChange(event.currentTarget.open);
            }}
          >
            <summary className="cursor-pointer text-xs text-[var(--c-text-secondary)]">
              {t("works.rawResult")}
            </summary>
            {isRawResultOpen ? (
              rawResultPending ? (
                <p className="m-0 mt-2 text-[11px] text-[var(--c-text-tertiary)]">
                  {t("common.loading")}
                </p>
              ) : rawResultError ? (
                <p className="m-0 mt-2 text-[11px] text-error-text">
                  {rawResultError}
                </p>
              ) : (
                <pre className="mt-2 max-h-44 overflow-auto rounded-lg border border-border bg-canvas p-2 text-[10px] text-[var(--c-text-secondary)]">
                  {rawResultPayload}
                </pre>
              )
            ) : null}
          </details>
        </div>
      </details>

      {errorText ? (
        <p className="m-0 rounded-lg border border-[#F1D7CF] bg-error-bg px-2.5 py-2 text-xs text-error-text">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-label">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[11px] font-semibold text-[var(--c-text)]">{value}</p>
    </div>
  );
}
