import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { deleteVideoTask, retryVideoTask } from "../api";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import type { AssetType, RetryMode, VideoTaskDetail } from "../types";
import {
  errorMessage,
  extractImageUrls,
  extractVideoUrl,
  formatTime,
} from "../utils";

interface Props {
  tasks: VideoTaskDetail[];
  loading: boolean;
}

const ASSET_FILTERS_KEY = "scenewords_assets_filters_v1";

interface AssetFilterSnapshot {
  kind: "all" | "video" | "image";
  searchKeyword: string;
  providerFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
}

export function JobsPage(props: Props) {
  const { tasks, loading } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const savedFilters = useMemo(() => readFilters(), []);

  const [kind, setKind] = useState<"all" | "video" | "image">(savedFilters.kind);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [searchKeyword, setSearchKeyword] = useState(savedFilters.searchKeyword);
  const [providerFilter, setProviderFilter] = useState(savedFilters.providerFilter);
  const [statusFilter, setStatusFilter] = useState(savedFilters.statusFilter);
  const [dateFrom, setDateFrom] = useState(savedFilters.dateFrom);
  const [dateTo, setDateTo] = useState(savedFilters.dateTo);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [hoverVideoTaskId, setHoverVideoTaskId] = useState<string | null>(null);

  const inProgressTasks = useMemo(
    () => tasks.filter((task) => task.status === "queued" || task.status === "running"),
    [tasks],
  );
  const completedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "queued" && task.status !== "running")
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)),
    [tasks],
  );
  const providerOptions = useMemo(
    () => ["all", ...Array.from(new Set(completedTasks.map((task) => task.provider))).sort()],
    [completedTasks],
  );

  useEffect(() => {
    if (providerFilter !== "all" && !providerOptions.includes(providerFilter)) {
      setProviderFilter("all");
    }
  }, [providerFilter, providerOptions]);

  useEffect(() => {
    writeFilters({
      kind,
      searchKeyword,
      providerFilter,
      statusFilter,
      dateFrom,
      dateTo,
    });
  }, [dateFrom, dateTo, kind, providerFilter, searchKeyword, statusFilter]);

  const assetList = useMemo(
    () =>
      completedTasks.filter((task) =>
        passesFilters(task, {
          kind,
          searchKeyword,
          providerFilter,
          statusFilter,
          dateFrom,
          dateTo,
        }),
      ),
    [completedTasks, dateFrom, dateTo, kind, providerFilter, searchKeyword, statusFilter],
  );

  const selectedTask = useMemo(
    () => assetList.find((task) => task.task_id === selectedTaskId) ?? null,
    [assetList, selectedTaskId],
  );
  const hasPromptEdited = useMemo(() => {
    if (!selectedTask) {
      return false;
    }
    const original = (selectedTask.prompt ?? "").trim();
    const current = draftPrompt.trim();
    return Boolean(current) && current !== original;
  }, [draftPrompt, selectedTask]);

  useEffect(() => {
    if (!assetList.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !assetList.some((task) => task.task_id === selectedTaskId)) {
      setSelectedTaskId(assetList[0].task_id);
    }
  }, [assetList, selectedTaskId]);

  useEffect(() => {
    if (!selectedTask) {
      setDraftPrompt("");
      return;
    }
    setDraftPrompt(selectedTask.prompt ?? "");
  }, [selectedTask?.task_id]);

  const retryMutation = useMutation({
    mutationFn: async (payload: {
      taskId: string;
      mode: RetryMode;
      prompt: string;
      assetType: AssetType;
    }) =>
      retryVideoTask(
        payload.taskId,
        payload.mode,
        payload.prompt.trim() || null,
        settings.gatewayToken,
        payload.assetType,
      ),
    onSuccess: async (response) => {
      setHint(t("jobs.retryQueued", { taskId: response.task_id.slice(0, 8) }));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(t("jobs.retryFailed", { message: error.message }));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (payload: { taskId: string; assetType: AssetType }) =>
      deleteVideoTask(payload.taskId, settings.gatewayToken, payload.assetType),
    onSuccess: async (_data, payload) => {
      setHint(t("jobs.deleteSuccess", { taskId: payload.taskId.slice(0, 8) }));
      setSelectedTaskId((current) => (current === payload.taskId ? null : current));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(t("jobs.deleteFailed", { message: error.message }));
    },
  });

  const mapErrorCode = (code: string): string | null => {
    const key = `error.${code}`;
    const translated = t(key);
    return translated === key ? null : translated;
  };
  const statusLabel = (status: string): string => {
    const key = `status.${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };
  const formatLocalizedStatus = (task: VideoTaskDetail): string => {
    if (task.status === "queued" && task.queue_position != null) {
      return t("jobs.statusQueuedWithPosition", { position: task.queue_position });
    }
    return statusLabel(task.status);
  };

  if (loading) {
    return <section className="panel">{t("jobs.loading")}</section>;
  }

  return (
    <section className="panel assets-page">
      <div className="panel-header">
        <h2>{t("jobs.title")}</h2>
        <p>{t("jobs.subtitle")}</p>
      </div>

      {inProgressTasks.length ? (
        <details className="queue-banner">
          <summary>{t("jobs.queueBanner", { count: inProgressTasks.length })}</summary>
          <ul className="queue-list">
            {inProgressTasks.map((task) => (
              <li key={task.task_id}>
                <strong>{task.task_id.slice(0, 8)}</strong>
                <span>{formatLocalizedStatus(task)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="assets-toolbar">
        <div className="kind-switch">
          <button
            type="button"
            className={kind === "all" ? "segment active" : "segment"}
            onClick={() => setKind("all")}
          >
            {t("jobs.kindAll")}
          </button>
          <button
            type="button"
            className={kind === "video" ? "segment active" : "segment"}
            onClick={() => setKind("video")}
          >
            {t("jobs.kindVideo")}
          </button>
          <button
            type="button"
            className={kind === "image" ? "segment active" : "segment"}
            onClick={() => setKind("image")}
          >
            {t("jobs.kindImage")}
          </button>
        </div>
        <input
          value={searchKeyword}
          onChange={(event) => setSearchKeyword(event.target.value)}
          placeholder={t("jobs.searchPlaceholder")}
        />
        <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {provider === "all" ? t("jobs.allProviders") : provider}
            </option>
          ))}
        </select>
      </div>

      <details className="assets-filters">
        <summary>{t("jobs.advancedFilters")}</summary>
        <div className="assets-filters-grid">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">{t("jobs.allStatus")}</option>
            <option value="succeeded">{statusLabel("succeeded")}</option>
            <option value="failed">{statusLabel("failed")}</option>
            <option value="canceled">{statusLabel("canceled")}</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              setSearchKeyword("");
              setProviderFilter("all");
              setStatusFilter("all");
              setDateFrom("");
              setDateTo("");
              setKind("all");
            }}
          >
            {t("jobs.clearFilters")}
          </button>
        </div>
      </details>

      <div className="assets-main">
        <div className="assets-grid">
          {assetList.map((task) => {
            const imageUrls = extractImageUrls(task);
            const thumb = imageUrls[0] ?? null;
            const videoUrl = task.asset_type === "video" ? extractVideoUrl(task) : null;
            const status = formatLocalizedStatus(task);
            return (
              <article
                key={task.task_id}
                className={task.task_id === selectedTaskId ? "asset-card active" : "asset-card"}
                onClick={() => setSelectedTaskId(task.task_id)}
              >
                {thumb ? (
                  <img className="asset-thumb" src={thumb} alt={task.task_id} />
                ) : videoUrl ? (
                  <div
                    className="asset-video-wrap"
                    onMouseEnter={() => setHoverVideoTaskId(task.task_id)}
                    onMouseLeave={() => setHoverVideoTaskId((current) => (current === task.task_id ? null : current))}
                  >
                    <video
                      className="asset-thumb asset-thumb-video"
                      src={videoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      autoPlay={hoverVideoTaskId === task.task_id}
                      loop
                    />
                    <span className="asset-video-badge">{t("jobs.kindVideo")}</span>
                  </div>
                ) : (
                  <div className="asset-thumb-placeholder">
                    <span>{task.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}</span>
                  </div>
                )}
                <p className="asset-prompt">{task.prompt || t("jobs.emptyPrompt")}</p>
                <p className="asset-meta">
                  {task.model} · {task.operation ?? "generate"}
                </p>
                <p className="asset-meta">
                  {task.resolution ?? "-"} · {task.duration_sec ?? "-"}s · {status}
                </p>
                <p className="asset-time">
                  {formatTime(task.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                </p>
              </article>
            );
          })}
          {!assetList.length ? (
            <div className="asset-empty">{t("jobs.assetEmpty")}</div>
          ) : null}
        </div>

        <aside className="asset-detail">
          {selectedTask ? (
            <>
              <h3>{t("jobs.assetDetailTitle")}</h3>
              <p className="job-meta">
                {selectedTask.task_id} · {formatLocalizedStatus(selectedTask)}
              </p>
              <p className="job-meta">
                {selectedTask.provider} / {selectedTask.model} / {selectedTask.operation ?? "generate"}
              </p>
              <p className="job-meta">
                {t("jobs.cost")}{" "}
                {settings.showActualCostPostDone && selectedTask.actual_cost != null
                  ? `${selectedTask.actual_cost.toFixed(3)} ${selectedTask.currency ?? settings.currency}`
                  : selectedTask.estimated_cost != null
                    ? `${selectedTask.estimated_cost.toFixed(3)} ${selectedTask.currency ?? settings.currency} ${t("jobs.estimatedSuffix")}`
                    : t("common.na")}
              </p>

              {selectedTask.asset_type === "video" && extractVideoUrl(selectedTask) ? (
                <div className="video-shell">
                  <video controls playsInline src={extractVideoUrl(selectedTask) ?? undefined} />
                </div>
              ) : null}
              {selectedTask.asset_type === "image" ? (
                <div className="image-preview-grid">
                  {extractImageUrls(selectedTask).map((url) => (
                    <img key={url} className="image-preview-item" src={url} alt={selectedTask.task_id} />
                  ))}
                </div>
              ) : null}

              <label>
                {t("jobs.retryPrompt")}
                <textarea
                  rows={4}
                  value={draftPrompt}
                  onChange={(event) => setDraftPrompt(event.target.value)}
                />
              </label>

              <div className="asset-primary-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!hasPromptEdited}
                  onClick={() => {
                    settings.setPendingReuseDraft(toDraftWithPrompt(selectedTask, draftPrompt));
                    navigate("/create");
                  }}
                >
                  {t("jobs.primaryRefine")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    settings.setPendingReuseDraft(toDraft(selectedTask));
                    navigate("/create");
                  }}
                >
                  {t("jobs.reuseSettings")}
                </button>
              </div>
              {!hasPromptEdited ? (
                <p className="hint">{t("jobs.primaryRefineHint")}</p>
              ) : null}

              {errorMessage(selectedTask, {
                mapErrorCode,
                fallbackMessage: t("error.defaultFailure"),
              }) ? (
                <p className="error-text">
                  {errorMessage(selectedTask, {
                    mapErrorCode,
                    fallbackMessage: t("error.defaultFailure"),
                  })}
                </p>
              ) : null}

              <details className="asset-more">
                <summary>{t("jobs.moreActions")}</summary>
                <div className="job-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const payload = buildTaskRequestPayload(selectedTask, draftPrompt);
                      const text = JSON.stringify(payload, null, 2);
                      void copyText(text).then(
                        () => setHint(t("jobs.copyJsonSuccess")),
                        () => setHint(t("jobs.copyJsonFailed")),
                      );
                    }}
                  >
                    {t("jobs.copyRequestJson")}
                  </button>
                  {settings.showBothRetryActions ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          retryMutation.mutate({
                            taskId: selectedTask.task_id,
                            mode: "same_seed",
                            prompt: draftPrompt,
                            assetType: selectedTask.asset_type,
                          })
                        }
                        disabled={retryMutation.isPending}
                      >
                        {t("common.retrySameSeed")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          retryMutation.mutate({
                            taskId: selectedTask.task_id,
                            mode: "new_seed",
                            prompt: draftPrompt,
                            assetType: selectedTask.asset_type,
                          })
                        }
                        disabled={retryMutation.isPending}
                      >
                        {t("common.retryNewSeed")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        retryMutation.mutate({
                          taskId: selectedTask.task_id,
                          mode: settings.retryModeDefault,
                          prompt: draftPrompt,
                          assetType: selectedTask.asset_type,
                        })
                      }
                      disabled={retryMutation.isPending}
                    >
                      {t("jobs.retry", {
                        mode:
                          settings.retryModeDefault === "same_seed"
                            ? t("settings.sameSeed")
                            : t("settings.newSeed"),
                      })}
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      const confirmed = window.confirm(
                        t("jobs.deleteConfirm", {
                          taskId: selectedTask.task_id.slice(0, 8),
                        }),
                      );
                      if (!confirmed) {
                        return;
                      }
                      deleteMutation.mutate({
                        taskId: selectedTask.task_id,
                        assetType: selectedTask.asset_type,
                      });
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    {t("jobs.delete")}
                  </button>
                </div>
                <details>
                  <summary>{t("jobs.rawResult")}</summary>
                  <pre>{JSON.stringify(selectedTask.result, null, 2)}</pre>
                </details>
              </details>
            </>
          ) : (
            <p className="hint">{t("jobs.selectHint")}</p>
          )}
        </aside>
      </div>

      <p className="hint">{hint}</p>
    </section>
  );
}

function readFilters(): AssetFilterSnapshot {
  const defaults: AssetFilterSnapshot = {
    kind: "all",
    searchKeyword: "",
    providerFilter: "all",
    statusFilter: "all",
    dateFrom: "",
    dateTo: "",
  };
  const raw = localStorage.getItem(ASSET_FILTERS_KEY);
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AssetFilterSnapshot>;
    const kind =
      parsed.kind === "video" || parsed.kind === "image" || parsed.kind === "all"
        ? parsed.kind
        : "all";
    return {
      kind,
      searchKeyword: typeof parsed.searchKeyword === "string" ? parsed.searchKeyword : "",
      providerFilter: typeof parsed.providerFilter === "string" ? parsed.providerFilter : "all",
      statusFilter: typeof parsed.statusFilter === "string" ? parsed.statusFilter : "all",
      dateFrom: typeof parsed.dateFrom === "string" ? parsed.dateFrom : "",
      dateTo: typeof parsed.dateTo === "string" ? parsed.dateTo : "",
    };
  } catch {
    return defaults;
  }
}

function writeFilters(snapshot: AssetFilterSnapshot): void {
  localStorage.setItem(ASSET_FILTERS_KEY, JSON.stringify(snapshot));
}

function passesFilters(
  task: VideoTaskDetail,
  filters: {
    kind: "all" | "video" | "image";
    searchKeyword: string;
    providerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
  },
): boolean {
  if (filters.kind !== "all" && task.asset_type !== filters.kind) {
    return false;
  }
  if (filters.providerFilter !== "all" && task.provider !== filters.providerFilter) {
    return false;
  }
  if (filters.statusFilter !== "all" && task.status !== filters.statusFilter) {
    return false;
  }
  if (filters.searchKeyword.trim()) {
    const keyword = filters.searchKeyword.trim().toLowerCase();
    const haystack = [
      task.task_id,
      task.prompt ?? "",
      task.provider,
      task.model,
      task.operation ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }
  const taskTs = Date.parse(task.updated_at);
  if (Number.isFinite(taskTs)) {
    if (filters.dateFrom) {
      const fromTs = Date.parse(`${filters.dateFrom}T00:00:00`);
      if (Number.isFinite(fromTs) && taskTs < fromTs) {
        return false;
      }
    }
    if (filters.dateTo) {
      const toTs = Date.parse(`${filters.dateTo}T23:59:59`);
      if (Number.isFinite(toTs) && taskTs > toTs) {
        return false;
      }
    }
  }
  return true;
}

function toDraft(task: VideoTaskDetail) {
  return {
    provider: task.provider,
    model: task.model,
    operation: task.operation ?? "generate",
    prompt: task.prompt,
    negativePrompt: task.negative_prompt ?? "",
    durationSec: task.duration_sec,
    resolution: task.resolution ?? "",
    fps: task.fps,
    seed: task.seed,
    providerOptions: task.provider_options ?? {},
  };
}

function toDraftWithPrompt(task: VideoTaskDetail, prompt: string) {
  return {
    ...toDraft(task),
    prompt: prompt.trim() || task.prompt,
  };
}

function buildTaskRequestPayload(task: VideoTaskDetail, prompt: string) {
  return {
    provider: task.provider,
    model: task.model,
    operation: task.operation ?? "generate",
    prompt: prompt.trim() || task.prompt,
    negative_prompt: task.negative_prompt,
    duration_sec: task.duration_sec,
    resolution: task.resolution,
    fps: task.fps,
    seed: task.seed,
    provider_options: task.provider_options ?? {},
  };
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const success = document.execCommand("copy");
    if (!success) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
