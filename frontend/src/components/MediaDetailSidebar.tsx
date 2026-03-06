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
      <div className="rounded-xl border border-[#E2DBC9] bg-white p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-[#2C241E]">{t("jobs.assetDetailTitle")}</h3>
            <p className="m-0 mt-1 truncate font-mono text-[11px] text-[#7C7266]">
              {task.task_id}
            </p>
            {task.provider_job_id ? (
              <p className="m-0 mt-1 truncate text-[10px] text-[#8A7E71]">
                {t("jobs.upstreamJob")}: {task.provider_job_id}
              </p>
            ) : null}
            {task.provider_status ? (
              <p className="m-0 mt-0.5 truncate text-[10px] text-[#8A7E71]">
                {t("jobs.upstreamStatus")}: {task.provider_status}
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-[#EEE8DB] px-2 py-1 text-[10px] font-semibold text-[#6B6257] whitespace-nowrap">
            {statusLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-[#6D6459]">
          <InfoCell label={t("jobs.provider")} value={task.provider} />
          <InfoCell label={t("jobs.model")} value={task.model} />
          <InfoCell label={t("jobs.resolution")} value={task.resolution ?? t("common.na")} />
          <InfoCell label={t("jobs.created")} value={updatedAtLabel} />
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-[#E2DBC9] bg-white p-3">
        <p className="m-0 mb-1 text-[11px] font-semibold text-[#675E52]">Prompt</p>
        <div
          className="max-h-[40vh] overflow-y-auto overscroll-contain pr-1 sm:max-h-[30vh]"
          data-overlay-scroll="allow"
        >
          <p className="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-[#302822]">
            {task.prompt || t("jobs.emptyPrompt")}
          </p>
          {task.negative_prompt ? (
            <div className="mt-2 border-t border-[#F0EBE2] pt-2">
              <p className="m-0 mb-1 text-[11px] font-semibold text-[#776E62]">
                {locale === "zh-CN" ? "负向提示词" : "Negative Prompt"}
              </p>
              <p className="m-0 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#6A6054]">
                {task.negative_prompt}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-[#E2DBC9] bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {isFavorited ? (
            <span className="rounded-full bg-[#FFF1E8] px-2 py-1 text-[10px] font-semibold text-[#A25329]">
              {locale === "zh-CN" ? "已收藏" : "Favorited"}
            </span>
          ) : null}
          <span className="rounded-full bg-[#ECE9FF] px-2 py-1 text-[10px] font-semibold text-[#4B43A0]">
            {task.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[#E8692A] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D95E22]"
            onClick={onReuse}
          >
            {t("jobs.reusePrompt")}
          </button>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
              title={t("jobs.download")}
            >
              {t("jobs.download")}
            </a>
          ) : null}
          {cancelAction ? (
            <button
              type="button"
              className="rounded-lg border border-[#E4C9BD] bg-[#FFF8F5] px-3 py-2 text-xs font-semibold text-[#A64633] transition-colors hover:bg-[#FDEDE6]"
              onClick={cancelAction.onCancel}
              disabled={cancelAction.disabled}
            >
              {t("jobs.cancelInProgress")}
            </button>
          ) : null}
          {retryActions?.onSameSeed ? (
            <button
              type="button"
              className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
              onClick={retryActions.onSameSeed}
              disabled={retryActions.disabled}
            >
              {retryActions.sameSeedLabel}
            </button>
          ) : null}
          {retryActions?.onNewSeed ? (
            <button
              type="button"
              className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
              onClick={retryActions.onNewSeed}
              disabled={retryActions.disabled}
            >
              {retryActions.newSeedLabel}
            </button>
          ) : null}
          {retryActions?.onDefault ? (
            <button
              type="button"
              className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
              onClick={retryActions.onDefault}
              disabled={retryActions.disabled}
            >
              {retryActions.defaultLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
            onClick={onToggleFavorite}
          >
            {isFavorited
              ? locale === "zh-CN" ? "取消收藏" : "Unfavorite"
              : locale === "zh-CN" ? "加入收藏" : "Favorite"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[#E4C9BD] bg-[#FFF8F5] px-3 py-2 text-xs font-semibold text-[#A64633] transition-colors hover:bg-[#FDEDE6]"
            onClick={onDelete}
            disabled={deleteDisabled}
          >
            {t("jobs.delete")}
          </button>
        </div>
      </div>

      <details className="rounded-xl border border-[#E2DBC9] bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[#6E6458]">
          {t("jobs.moreActions")}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            className="text-left text-xs text-[#5B5146] underline decoration-dotted underline-offset-2 hover:text-[#2F271F]"
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
            <summary className="cursor-pointer text-xs text-[#5B5146]">
              {t("jobs.rawResult")}
            </summary>
            {isRawResultOpen ? (
              rawResultPending ? (
                <p className="m-0 mt-2 text-[11px] text-[#776C60]">
                  {locale === "zh-CN" ? "加载中..." : "Loading..."}
                </p>
              ) : rawResultError ? (
                <p className="m-0 mt-2 text-[11px] text-[#A04431]">
                  {rawResultError}
                </p>
              ) : (
                <pre className="mt-2 max-h-44 overflow-auto rounded-lg border border-[#EEE6D8] bg-[#F8F4EC] p-2 text-[10px] text-[#5E5449]">
                  {rawResultPayload}
                </pre>
              )
            ) : null}
          </details>
        </div>
      </details>

      {errorText ? (
        <p className="m-0 rounded-lg border border-[#F1D7CF] bg-[#FFF1ED] px-2.5 py-2 text-xs text-[#A04431]">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-[10px] uppercase tracking-wide text-[#8B8174]">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[11px] font-semibold text-[#4A4035]">{value}</p>
    </div>
  );
}
