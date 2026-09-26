import { DotsThree, Info, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useI18n, type TranslateFn } from "../i18n";
import { deriveTaskFormatMeta } from "../overlayTaskPresentation";
import type { VideoTaskDetail } from "../types";
import { extractImageUrls, formatCostAmount, resolveTaskCostState } from "../utils";

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
  versionTasks?: VideoTaskDetail[];
  onVersionSelect?: (taskId: string) => void;
  statusLabel: string;
  updatedAtLabel: string;
  downloadUrl?: string | null;
  onReuse: () => void;
  reuseDisabled?: boolean;
  onBranch?: () => void;
  onAdoptVersion?: (taskId: string) => void;
  adoptDisabled?: boolean;
  gatewayToken?: string;
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
    versionTasks = [],
    onVersionSelect,
    statusLabel,
    updatedAtLabel,
    downloadUrl,
    onReuse,
    reuseDisabled,
    onBranch,
    onAdoptVersion,
    adoptDisabled,
    gatewayToken = "",
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
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonTaskId, setComparisonTaskId] = useState("");
  const comparisonCandidates = useMemo(
    () => versionTasks.filter((version) => version.task_id !== task.task_id),
    [task.task_id, versionTasks],
  );
  const comparisonTask = comparisonCandidates.find((version) => version.task_id === comparisonTaskId)
    ?? comparisonCandidates[comparisonCandidates.length - 1]
    ?? null;

  useEffect(() => {
    if (!comparisonCandidates.some((version) => version.task_id === comparisonTaskId)) {
      setComparisonTaskId(comparisonCandidates[comparisonCandidates.length - 1]?.task_id ?? "");
    }
  }, [comparisonCandidates, comparisonTaskId]);
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
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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

      {task.status === "succeeded" && !downloadUrl ? (
        <p className="m-0 rounded-2xl border border-[var(--c-border-subtle)] bg-warning-bg px-3 py-2 text-[11px] text-warning-text">
          {t("works.resourceExpiredHint")}
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

      <div className="flex flex-wrap gap-2 border-y border-border py-3">
        {task.asset_type !== "image" || task.status !== "succeeded" ? (
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={onReuse}
            disabled={reuseDisabled}
          >
            {task.generation_id
              ? locale === "zh-CN" ? "基于此版本继续" : "Continue from this version"
              : t("works.editAgain")}
          </button>
        ) : null}
        {onBranch && task.asset_type === "image" && task.status === "succeeded" && task.generation_id ? (
          <button type="button" className="btn-secondary text-xs" onClick={onBranch} disabled={reuseDisabled}>
            {locale === "zh-CN" ? "从此分支" : "Branch from here"}
          </button>
        ) : null}
        {renderRetryButtons(retryActions, t)}
      </div>

      {task.scene_id && task.generation_id ? (
        <section className="rounded-[20px] border border-border bg-surface-raised/90 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-label">{locale === "zh-CN" ? "会话 · 生成记录" : "Chat · generation"}</p>
              <p className="m-0 mt-1 text-sm font-semibold text-[var(--c-text)]">
                {task.scene_title ?? (locale === "zh-CN" ? "未命名会话" : "Untitled chat")}
              </p>
            </div>
            <span className="tag tag-warning">V{task.version_number ?? 1}</span>
          </div>
          {versionTasks.length > 1 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {versionTasks.map((version) => (
                <button
                  key={version.task_id}
                  type="button"
                  className={version.task_id === task.task_id ? "btn-primary px-3 text-xs" : "btn-ghost px-3 text-xs"}
                  onClick={() => onVersionSelect?.(version.task_id)}
                >
                  V{version.version_number ?? 1}
                  {task.adopted_version_id === version.task_id ? " ✓" : ""}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {comparisonCandidates.length ? (
              <button type="button" className="btn-ghost text-xs" onClick={() => setIsComparing((current) => !current)}>
                {locale === "zh-CN" ? "并排比较" : "Compare side by side"}
              </button>
            ) : null}
            {task.adopted_version_id === task.task_id ? (
              <span className="tag tag-success">{locale === "zh-CN" ? "已采用" : "Adopted"}</span>
            ) : (
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={adoptDisabled || task.status !== "succeeded"}
                onClick={() => onAdoptVersion?.(task.task_id)}
              >
                {locale === "zh-CN" ? "采用此版本" : "Adopt this version"}
              </button>
            )}
          </div>
        </section>
      ) : null}

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
                <p className="m-0 mt-2 text-[11px] text-[var(--c-text-secondary)]">
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

      {errorText ? (
        <p className="m-0 rounded-2xl border border-[var(--c-border-subtle)] bg-error-bg px-3 py-2 text-xs text-error-text">
          <span className="inline-flex items-center gap-1.5">
            <WarningCircle size={14} weight="regular" />
            <span className="whitespace-pre-line">{errorText}</span>
          </span>
        </p>
      ) : null}

      {isComparing && comparisonTask ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--c-overlay)] p-4 backdrop-blur-[5px]"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsComparing(false)}
        >
          <div
            className="w-full max-w-[1180px] rounded-[28px] border border-border bg-[var(--c-surface)] p-4 shadow-[var(--shadow-overlay)] md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="m-0 text-sm font-semibold text-[var(--c-text)]">
                  {locale === "zh-CN" ? "并排比较版本" : "Compare versions side by side"}
                </p>
                <p className="m-0 mt-1 text-xs text-[var(--c-text-secondary)]">
                  {locale === "zh-CN" ? `当前 V${task.version_number ?? 1} 与对比版本` : `Current V${task.version_number ?? 1} and comparison version`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--c-text-secondary)]">
                  <span className="mr-2">{locale === "zh-CN" ? "对比" : "Compare"}</span>
                  <select
                    className="input-base text-xs"
                    value={comparisonTask.task_id}
                    onChange={(event) => setComparisonTaskId(event.target.value)}
                  >
                    {comparisonCandidates.map((version) => (
                      <option key={version.task_id} value={version.task_id}>
                        V{version.version_number ?? 1}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn-ghost text-xs" onClick={() => setIsComparing(false)}>
                  {t("common.close")}
                </button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <VersionComparisonCard task={task} token={gatewayToken} active large />
              <VersionComparisonCard task={comparisonTask} token={gatewayToken} large />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VersionComparisonCard(props: { task: VideoTaskDetail; token: string; active?: boolean; large?: boolean }) {
  const { task, token, active = false, large = false } = props;
  const [source, setSource] = useState("");
  const imageUrl = extractImageUrls(task)[0] ?? "";
  useEffect(() => {
    if (!imageUrl) {
      setSource("");
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    const headers = new Headers();
    if (token.trim()) headers.set("Authorization", `Bearer ${token.trim()}`);
    void fetch(imageUrl, { headers, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource("");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl, token]);
  return (
    <article className={active ? "overflow-hidden rounded-xl border border-[var(--c-accent)] bg-[var(--c-surface)]" : "overflow-hidden rounded-xl border border-border bg-[var(--c-surface)]"}>
      {source ? <img src={source} alt={`V${task.version_number ?? 1}`} className={large ? "max-h-[68vh] w-full bg-[var(--c-surface-inset)] object-contain" : "aspect-square w-full object-cover"} /> : <div className={large ? "h-[55vh] w-full bg-[var(--c-surface-inset)]" : "aspect-square w-full bg-[var(--c-surface-inset)]"} />}
      <p className={large ? "m-0 px-3 py-2 text-xs text-[var(--c-text-secondary)]" : "m-0 truncate px-2 py-1.5 text-[10px] text-[var(--c-text-secondary)]"}>
        V{task.version_number ?? 1} · {task.prompt || "—"}
      </p>
    </article>
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
      <span className="text-[var(--c-text)]">{label}</span>
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
