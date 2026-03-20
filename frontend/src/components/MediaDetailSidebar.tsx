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
  const { locale, t } = useI18n();

  return (
    <div
      className="flex h-full flex-col gap-3 overflow-y-auto overscroll-contain pr-1 sm:pr-0"
      data-overlay-scroll="allow"
    >
      <div className="rounded-xl border border-border bg-white p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-[var(--c-text)]">{t("jobs.assetDetailTitle")}</h3>
            <p className="m-0 mt-1 truncate font-mono text-[11px] text-[var(--c-text-tertiary)]">
              {task.task_id}
            </p>
            {task.provider_job_id ? (
              <p className="m-0 mt-1 truncate text-[10px] text-[var(--c-text-tertiary)]">
                {t("jobs.upstreamJob")}: {task.provider_job_id}
              </p>
            ) : null}
            {task.provider_status ? (
              <p className="m-0 mt-0.5 truncate text-[10px] text-[var(--c-text-tertiary)]">
                {t("jobs.upstreamStatus")}: {task.provider_status}
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-[rgba(0,0,0,0.05)] px-2 py-1 text-[10px] font-semibold text-[var(--c-text-secondary)] whitespace-nowrap">
            {statusLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--c-text-secondary)]">
          <InfoCell label={t("jobs.provider")} value={task.provider} />
          <InfoCell label={t("jobs.model")} value={task.model} />
          <InfoCell label={t("jobs.resolution")} value={task.resolution ?? t("common.na")} />
          <InfoCell label={t("jobs.created")} value={updatedAtLabel} />
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border bg-white p-3">
        <p className="m-0 mb-1 text-[11px] font-semibold text-[var(--c-text-secondary)]">Prompt</p>
        <div
          className="max-h-[40vh] overflow-y-auto overscroll-contain pr-1 sm:max-h-[30vh]"
          data-overlay-scroll="allow"
        >
          <p className="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--c-text)]">
            {task.prompt || t("jobs.emptyPrompt")}
          </p>
          {task.negative_prompt ? (
            <div className="mt-2 border-t border-border pt-2">
              <p className="m-0 mb-1 text-[11px] font-semibold text-[var(--c-text-secondary)]">
                {locale === "zh-CN" ? "负向提示词" : "Negative Prompt"}
              </p>
              <p className="m-0 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--c-text-secondary)]">
                {task.negative_prompt}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {isFavorited ? (
            <span className="rounded-full bg-accent-bg px-2 py-1 text-[10px] font-semibold text-accent">
              {locale === "zh-CN" ? "已收藏" : "Favorited"}
            </span>
          ) : null}
          <span className="rounded-full bg-info-bg px-2 py-1 text-[10px] font-semibold text-info-text">
            {task.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-cta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cta-hover"
            onClick={onReuse}
          >
            {t("jobs.reusePrompt")}
          </button>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-canvas"
              title={t("jobs.download")}
            >
              {t("jobs.download")}
            </a>
          ) : null}
          {cancelAction ? (
            <button
              type="button"
              className="rounded-lg border border-[#F1D7CF] bg-error-bg px-3 py-2 text-xs font-semibold text-error-text transition-colors hover:bg-[#FAE8E4]"
              onClick={cancelAction.onCancel}
              disabled={cancelAction.disabled}
            >
              {t("jobs.cancelInProgress")}
            </button>
          ) : null}
          {retryActions?.onSameSeed ? (
            <button
              type="button"
              className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-canvas"
              onClick={retryActions.onSameSeed}
              disabled={retryActions.disabled}
            >
              {retryActions.sameSeedLabel}
            </button>
          ) : null}
          {retryActions?.onNewSeed ? (
            <button
              type="button"
              className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-canvas"
              onClick={retryActions.onNewSeed}
              disabled={retryActions.disabled}
            >
              {retryActions.newSeedLabel}
            </button>
          ) : null}
          {retryActions?.onDefault ? (
            <button
              type="button"
              className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-canvas"
              onClick={retryActions.onDefault}
              disabled={retryActions.disabled}
            >
              {retryActions.defaultLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-canvas"
            onClick={onToggleFavorite}
          >
            {isFavorited
              ? locale === "zh-CN" ? "取消收藏" : "Unfavorite"
              : locale === "zh-CN" ? "加入收藏" : "Favorite"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[#F1D7CF] bg-error-bg px-3 py-2 text-xs font-semibold text-error-text transition-colors hover:bg-[#FAE8E4]"
            onClick={onDelete}
            disabled={deleteDisabled}
          >
            {t("jobs.delete")}
          </button>
        </div>
      </div>

      <details className="rounded-xl border border-border bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--c-text-secondary)]">
          {t("jobs.moreActions")}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            className="text-left text-xs text-[var(--c-text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--c-text)]"
            onClick={onCopyRequestJson}
          >
            {t("jobs.copyRequestJson")}
          </button>
          <details
            open={isRawResultOpen}
            onToggle={(event) => {
              onRawResultOpenChange(event.currentTarget.open);
            }}
          >
            <summary className="cursor-pointer text-xs text-[var(--c-text-secondary)]">
              {t("jobs.rawResult")}
            </summary>
            {isRawResultOpen ? (
              rawResultPending ? (
                <p className="m-0 mt-2 text-[11px] text-[var(--c-text-tertiary)]">
                  {locale === "zh-CN" ? "加载中..." : "Loading..."}
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
      <p className="m-0 text-[10px] uppercase tracking-wide text-[var(--c-text-tertiary)]">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[11px] font-semibold text-[var(--c-text)]">{value}</p>
    </div>
  );
}
