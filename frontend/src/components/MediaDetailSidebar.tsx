import { DotsThree, Info, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { useI18n, type TranslateFn } from "../i18n";
import { deriveTaskFormatMeta } from "../overlayTaskPresentation";
import type { VideoTaskDetail } from "../types";
import { formatCostAmount, resolveTaskCostState } from "../utils";

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
  downloadUrl?: string | null;
  onReuse: () => void;
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
    downloadUrl,
    onReuse,
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
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const formatMeta = deriveTaskFormatMeta(task);
  const normalizedLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  const costState = resolveTaskCostState(task);
  const costValue =
    costState.kind === "charged" && typeof costState.amount === "number"
      ? formatCostAmount(costState.amount, costState.currency, normalizedLocale)
      : costState.kind === "estimated" && typeof costState.amount === "number"
        ? `${formatCostAmount(costState.amount, costState.currency, normalizedLocale)} ${t("works.estimatedSuffix")}`
        : costState.kind === "not_charged"
          ? t("works.notCharged")
          : t("common.na");
  const buildSharedFileName = (contentType?: string): string => {
    const base = `${task.provider || "scenewords"}_${task.task_id.slice(0, 8)}`;
    const normalizedType = contentType?.toLowerCase() ?? "";
    if (normalizedType.includes("png")) return `${base}.png`;
    if (normalizedType.includes("webp")) return `${base}.webp`;
    if (normalizedType.includes("gif")) return `${base}.gif`;
    if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return `${base}.jpg`;
    if (normalizedType.includes("quicktime")) return `${base}.mov`;
    if (normalizedType.includes("webm")) return `${base}.webm`;
    if (normalizedType.includes("mp4")) return `${base}.mp4`;
    return task.asset_type === "image" ? `${base}.jpg` : `${base}.mp4`;
  };

  const handleNativeShare = async () => {
    if (!downloadUrl || typeof navigator === "undefined") {
      return;
    }

    const hasNativeShare = typeof navigator.share === "function";
    if (!hasNativeShare) {
      const requiresSecureContext =
        typeof window !== "undefined" && window.isSecureContext === false;
      setShareError(
        requiresSecureContext ? t("works.shareRequiresHttps") : t("works.shareUnavailable"),
      );
      return;
    }
    setIsSharing(true);
    setShareError(null);

    try {
      let shared = false;

      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const file = new File([blob], buildSharedFileName(blob.type), {
          type: blob.type || undefined,
        });

        const canShareFiles =
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] });

        if (canShareFiles) {
          await navigator.share({
            files: [file],
            title: task.prompt || t("works.share"),
          });
          shared = true;
        }
      } catch {
        // Fall through to URL-based share.
      }

      if (!shared) {
        await navigator.share({
          title: task.prompt || t("works.share"),
          url: downloadUrl,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setShareError(t("works.shareFailed"));
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {downloadUrl ? (
            <a href={downloadUrl} download className="btn-secondary text-xs" title={t("works.download")}>
              {t("works.download")}
            </a>
          ) : null}
          {downloadUrl ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                void handleNativeShare();
              }}
              disabled={isSharing}
              title={t("works.share")}
            >
              {isSharing ? t("works.sharing") : t("works.share")}
            </button>
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

        <details className="group relative shrink-0 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex h-9 w-9 list-none items-center justify-center rounded-full border border-border bg-surface-raised text-[var(--c-text-secondary)] shadow-[var(--shadow-xs)] transition-[background-color,border-color,color] duration-200 hover:border-[var(--c-border-strong)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)]">
            <DotsThree size={18} weight="regular" />
          </summary>
          <div className="absolute right-0 top-11 z-10 min-w-[160px] rounded-2xl border border-border bg-surface-raised p-1.5 shadow-[var(--shadow-lg)]">
            <button
              type="button"
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-xs font-medium text-error-text transition-colors hover:bg-error-bg"
              onClick={onDelete}
              disabled={deleteDisabled}
            >
              {t("works.delete")}
            </button>
          </div>
        </details>
      </div>

      {shareError ? (
        <p className="m-0 rounded-2xl border border-[var(--c-border-subtle)] bg-error-bg px-3 py-2 text-[11px] text-error-text">
          {shareError}
        </p>
      ) : null}

      <section className="space-y-2">
        <p className="m-0 text-label">{t("works.promptLabel")}</p>
        <p
          className="m-0 truncate text-sm font-medium leading-6 text-[var(--c-text)]"
          title={task.prompt || t("works.emptyPrompt")}
        >
          {task.prompt || t("works.emptyPrompt")}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--c-text-secondary)]">
          <InlineStat label={t("works.model")} value={task.model} />
          <InlineDivider />
          <InlineStat label={t("create.quickRatio")} value={formatMeta.ratio ?? t("common.na")} />
          <InlineDivider />
          <InlineStat label={t("works.resolution")} value={formatMeta.resolution ?? t("common.na")} />
          <InlineDivider />
          <InlineStat label={t("works.cost")} value={costValue} />
          <InlineDivider />
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-xs font-medium text-[var(--c-text-secondary)] transition-colors hover:text-[var(--c-text)]"
            onClick={() => setIsDetailsOpen((current) => !current)}
          >
            <Info size={14} weight="regular" />
            {t("works.detailsInline")}
          </button>
        </div>
      </section>

      {isDetailsOpen ? (
        <section className="rounded-[20px] border border-border bg-surface-raised/90 p-3.5">
          <div className="grid grid-cols-2 gap-3 text-[11px] text-[var(--c-text-secondary)]">
            <InfoCell label={t("works.provider")} value={task.provider} />
            <InfoCell label={t("works.statusLabel")} value={statusLabel} />
            <InfoCell label={t("works.created")} value={updatedAtLabel} />
            <InfoCell label={t("works.taskId")} value={task.task_id} mono />
            {task.provider_job_id ? <InfoCell label={t("works.upstreamJob")} value={task.provider_job_id} /> : null}
            {task.provider_status ? <InfoCell label={t("works.upstreamStatus")} value={task.provider_status} /> : null}
          </div>
          {task.negative_prompt ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="m-0 text-label">{t("works.negativePrompt")}</p>
              <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--c-text-secondary)]">
                {task.negative_prompt}
              </p>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={onCopyRequestJson}
            >
              {t("works.copyRequestJson")}
            </button>
          </div>
          <details
            className="mt-3 rounded-2xl border border-border bg-canvas/70 px-3 py-2"
            open={isRawResultOpen}
            onToggle={(event) => {
              onRawResultOpenChange(event.currentTarget.open);
            }}
          >
            <summary className="cursor-pointer text-xs font-semibold text-[var(--c-text-secondary)]">
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
                <pre
                  className="mt-2 max-h-44 overflow-auto rounded-xl border border-border bg-canvas p-2 text-[10px] text-[var(--c-text-secondary)]"
                  data-overlay-scroll="allow"
                >
                  {rawResultPayload}
                </pre>
              )
            ) : null}
          </details>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={onReuse}
        >
          {t("works.editAgain")}
        </button>
        {renderRetryButtons(retryActions, t)}
      </div>

      {errorText ? (
        <p className="m-0 rounded-2xl border border-[var(--c-border-subtle)] bg-error-bg px-3 py-2 text-xs text-error-text">
          <span className="inline-flex items-center gap-1.5">
            <WarningCircle size={14} weight="regular" />
            <span className="whitespace-pre-line">{errorText}</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

function renderRetryButtons(
  retryActions: SidebarRetryActions | undefined,
  t: TranslateFn,
) {
  if (!retryActions) {
    return null;
  }

  if (retryActions.onDefault) {
    return (
      <button
        type="button"
        className="btn-secondary text-xs"
        onClick={retryActions.onDefault}
        disabled={retryActions.disabled}
      >
        {retryActions.defaultLabel ?? t("works.generateAgain")}
      </button>
    );
  }

  return (
    <>
      {retryActions.onSameSeed ? (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={retryActions.onSameSeed}
          disabled={retryActions.disabled}
        >
          {retryActions.sameSeedLabel ?? t("works.generateAgainSameSeed")}
        </button>
      ) : null}
      {retryActions.onNewSeed ? (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={retryActions.onNewSeed}
          disabled={retryActions.disabled}
        >
          {retryActions.newSeedLabel ?? t("works.generateAgainNewSeed")}
        </button>
      ) : null}
    </>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-[var(--c-text-tertiary)]">{label}</span>
      <span className="font-medium text-[var(--c-text)]">{value}</span>
    </span>
  );
}

function InlineDivider() {
  return <span className="text-[var(--c-border-strong)]">|</span>;
}

function InfoCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-label">{label}</p>
      <p
        className={`m-0 mt-1 break-words font-medium text-[var(--c-text)] ${mono ? "font-mono text-[10px] tabular-nums" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
