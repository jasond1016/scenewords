import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { deleteVideoTask } from "../api";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import type { AssetType, VideoTaskDetail } from "../types";
import {
  errorMessage,
  extractImageUrls,
  extractOriginalImageUrls,
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

type LightboxKind = "image" | "video";

interface LightboxMediaItem {
  key: string;
  taskId: string;
  url: string;
  kind: LightboxKind;
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
  const [hoverVideoTaskId, setHoverVideoTaskId] = useState<string | null>(null);
  const [lightboxState, setLightboxState] = useState<{ kind: LightboxKind; index: number } | null>(null);

  const inProgressTasks = useMemo(
    () => tasks.filter((task) => task.status === "queued" || task.status === "running"),
    [tasks],
  );
  const inProgressBreakdown = useMemo(
    () => ({
      imageCount: inProgressTasks.filter((task) => task.asset_type === "image").length,
      videoCount: inProgressTasks.filter((task) => task.asset_type === "video").length,
    }),
    [inProgressTasks],
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
  const selectedTaskOriginalImageUrls = useMemo(
    () =>
      selectedTask && selectedTask.asset_type === "image"
        ? extractOriginalImageUrls(selectedTask)
        : [],
    [selectedTask],
  );
  const imageLightboxItems = useMemo(
    () => buildLightboxItems(assetList, "image"),
    [assetList],
  );
  const videoLightboxItems = useMemo(
    () => buildLightboxItems(assetList, "video"),
    [assetList],
  );
  const lightboxItems = lightboxState?.kind === "video" ? videoLightboxItems : imageLightboxItems;
  const lightboxIndex = lightboxState?.index ?? null;
  const lightboxKind = lightboxState?.kind ?? null;
  const lightboxItem = useMemo(() => {
    if (lightboxIndex == null || lightboxIndex < 0 || lightboxIndex >= lightboxItems.length) {
      return null;
    }
    return lightboxItems[lightboxIndex];
  }, [lightboxIndex, lightboxItems]);

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
    if (!lightboxItems.length) {
      setLightboxState(null);
      return;
    }
    if (lightboxIndex != null && lightboxIndex >= lightboxItems.length) {
      setLightboxState((current) =>
        current ? { ...current, index: lightboxItems.length - 1 } : null,
      );
    }
  }, [lightboxIndex, lightboxItems]);

  useEffect(() => {
    if (lightboxIndex == null || !lightboxItems.length) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxState(null);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setLightboxState((current) => {
          if (!current) {
            return null;
          }
          return {
            ...current,
            index: current.index > 0 ? current.index - 1 : lightboxItems.length - 1,
          };
        });
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setLightboxState((current) => {
          if (!current) {
            return null;
          }
          return {
            ...current,
            index: current.index < lightboxItems.length - 1 ? current.index + 1 : 0,
          };
        });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, lightboxItems.length]);

  const openImageLightbox = (taskId: string, imageUrl: string) => {
    const index = imageLightboxItems.findIndex(
      (item) => item.taskId === taskId && item.url === imageUrl,
    );
    if (index >= 0) {
      setLightboxState({ kind: "image", index });
    }
  };
  const openVideoLightbox = (taskId: string, videoUrl: string) => {
    const index = videoLightboxItems.findIndex(
      (item) => item.taskId === taskId && item.url === videoUrl,
    );
    if (index >= 0) {
      setLightboxState({ kind: "video", index });
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (payload: {
      taskId: string;
      assetType: AssetType;
      action: "cancel" | "delete";
    }) =>
      deleteVideoTask(payload.taskId, settings.gatewayToken, payload.assetType),
    onSuccess: async (_data, payload) => {
      setHint(
        payload.action === "cancel"
          ? t("jobs.cancelSuccess", { taskId: payload.taskId.slice(0, 8) })
          : t("jobs.deleteSuccess", { taskId: payload.taskId.slice(0, 8) }),
      );
      setSelectedTaskId((current) => (current === payload.taskId ? null : current));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error, payload) => {
      setHint(
        payload.action === "cancel"
          ? t("jobs.cancelFailed", { message: error.message })
          : t("jobs.deleteFailed", { message: error.message }),
      );
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
    if (task.asset_type === "image") {
      if (task.status === "queued") {
        if (task.queue_position != null) {
          return t("jobs.imageStatusQueuedWithPosition", { position: task.queue_position });
        }
        return t("jobs.imageStatusQueued");
      }
      if (task.status === "running") {
        return t("jobs.imageStatusRunning");
      }
      if (task.status === "succeeded") {
        return t("jobs.imageStatusSucceeded");
      }
    }
    if (task.asset_type === "video") {
      if (task.status === "queued") {
        if (task.queue_position != null) {
          return t("jobs.videoStatusQueuedWithPosition", { position: task.queue_position });
        }
        return t("jobs.videoStatusQueued");
      }
      if (task.status === "running") {
        return t("jobs.videoStatusRunning");
      }
      if (task.status === "succeeded") {
        return t("jobs.videoStatusSucceeded");
      }
    }
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
          <p className="hint">
            {t("jobs.queueMix", {
              imageCount: inProgressBreakdown.imageCount,
              videoCount: inProgressBreakdown.videoCount,
            })}
          </p>
          <ul className="queue-list">
            {inProgressTasks.map((task) => (
              <li key={task.task_id}>
                <strong>{task.task_id.slice(0, 8)}</strong>
                <span>{formatLocalizedStatus(task)}</span>
                <button
                  type="button"
                  className="mini-button"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    const confirmed = window.confirm(
                      t("jobs.cancelConfirm", {
                        taskId: task.task_id.slice(0, 8),
                      }),
                    );
                    if (!confirmed) {
                      return;
                    }
                    deleteMutation.mutate({
                      taskId: task.task_id,
                      assetType: task.asset_type,
                      action: "cancel",
                    });
                  }}
                >
                  {t("jobs.cancelInProgress")}
                </button>
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
            const cardMetaParts: string[] = [];
            if (task.resolution) {
              cardMetaParts.push(task.resolution);
            }
            if (task.asset_type === "video" && task.duration_sec != null) {
              cardMetaParts.push(`${task.duration_sec}s`);
            }
            if (task.status !== "succeeded") {
              cardMetaParts.push(status);
            }
            return (
              <article
                key={task.task_id}
                className={task.task_id === selectedTaskId ? "asset-card active" : "asset-card"}
                onClick={() => setSelectedTaskId(task.task_id)}
              >
                {thumb ? (
                  <button
                    type="button"
                    className="asset-image-hit"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedTaskId(task.task_id);
                      openImageLightbox(task.task_id, thumb);
                    }}
                  >
                    <img className="asset-thumb" src={thumb} alt={task.task_id} />
                    <span className="asset-image-zoom">{t("jobs.previewImage")}</span>
                  </button>
                ) : videoUrl ? (
                  <button
                    type="button"
                    className="asset-video-hit asset-video-wrap"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedTaskId(task.task_id);
                      openVideoLightbox(task.task_id, videoUrl);
                    }}
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
                    <span className="asset-video-badge">{t("jobs.previewVideo")}</span>
                  </button>
                ) : (
                  <div className="asset-thumb-placeholder">
                    <span>{task.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}</span>
                  </div>
                )}
                <p className="asset-prompt">{task.prompt || t("jobs.emptyPrompt")}</p>
                <p className="asset-meta">
                  {task.model} · {task.operation ?? "generate"}
                </p>
                {cardMetaParts.length ? <p className="asset-meta">{cardMetaParts.join(" · ")}</p> : null}
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
                {selectedTask.task_id}
                {selectedTask.status !== "succeeded"
                  ? ` · ${formatLocalizedStatus(selectedTask)}`
                  : ""}
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
                  <button
                    type="button"
                    className="video-preview-button"
                    onClick={() => {
                      const url = extractVideoUrl(selectedTask);
                      if (url) {
                        openVideoLightbox(selectedTask.task_id, url);
                      }
                    }}
                  >
                    <video controls playsInline src={extractVideoUrl(selectedTask) ?? undefined} />
                  </button>
                </div>
              ) : null}
              {selectedTask.asset_type === "image" ? (
                <div className="image-preview-grid">
                  {extractImageUrls(selectedTask).map((url) => (
                    <button
                      type="button"
                      key={url}
                      className="image-preview-button"
                      onClick={() => openImageLightbox(selectedTask.task_id, url)}
                    >
                      <img className="image-preview-item" src={url} alt={selectedTask.task_id} />
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="asset-primary-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    settings.setPendingReuseDraft(toDraft(selectedTask));
                    navigate("/create");
                  }}
                >
                  {t("jobs.reuseSettings")}
                </button>
              </div>

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
                      const payload = buildTaskRequestPayload(selectedTask);
                      const text = JSON.stringify(payload, null, 2);
                      void copyText(text).then(
                        () => setHint(t("jobs.copyJsonSuccess")),
                        () => setHint(t("jobs.copyJsonFailed")),
                      );
                    }}
                  >
                    {t("jobs.copyRequestJson")}
                  </button>
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
                        action: "delete",
                      });
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    {t("jobs.delete")}
                  </button>
                </div>
                {selectedTask.asset_type === "image" && selectedTaskOriginalImageUrls.length ? (
                  <details>
                    <summary>{t("jobs.originalImageLinks")}</summary>
                    <div className="raw-link-list">
                      {selectedTaskOriginalImageUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          {url}
                        </a>
                      ))}
                    </div>
                  </details>
                ) : null}
                <details>
                  <summary>{t("jobs.rawResult")}</summary>
                  <pre>{formatRawDebugPayload(selectedTask)}</pre>
                </details>
              </details>
            </>
          ) : (
            <p className="hint">{t("jobs.selectHint")}</p>
          )}
        </aside>
      </div>

      <p className="hint">{hint}</p>

      {lightboxItem ? (
        <div className="image-lightbox" role="dialog" aria-modal="true" onClick={() => setLightboxState(null)}>
          <div className="image-lightbox-stage" onClick={(event) => event.stopPropagation()}>
            <div className="image-lightbox-head">
              <p className="image-lightbox-title">
                {t("jobs.lightboxIndex", { index: (lightboxIndex ?? 0) + 1, total: lightboxItems.length })}
              </p>
              <button
                type="button"
                className="mini-button"
                onClick={() => setLightboxState(null)}
              >
                {t("common.close")}
              </button>
            </div>
            <div className="image-lightbox-body">
              {lightboxItems.length > 1 ? (
                <button
                  type="button"
                  className="image-lightbox-nav prev"
                  onClick={() =>
                    setLightboxState((current) =>
                      !current
                        ? null
                        : {
                            ...current,
                            index: current.index > 0 ? current.index - 1 : lightboxItems.length - 1,
                          },
                    )}
                >
                  {t("jobs.lightboxPrev")}
                </button>
              ) : null}
              {lightboxKind === "video" ? (
                <video
                  className="image-lightbox-video"
                  src={lightboxItem.url}
                  controls
                  autoPlay
                  loop
                  playsInline
                />
              ) : (
                <img className="image-lightbox-img" src={lightboxItem.url} alt={lightboxItem.taskId} />
              )}
              {lightboxItems.length > 1 ? (
                <button
                  type="button"
                  className="image-lightbox-nav next"
                  onClick={() =>
                    setLightboxState((current) =>
                      !current
                        ? null
                        : {
                            ...current,
                            index: current.index < lightboxItems.length - 1 ? current.index + 1 : 0,
                          },
                    )}
                >
                  {t("jobs.lightboxNext")}
                </button>
              ) : null}
            </div>
            <div className="image-lightbox-actions">
              <a href={lightboxItem.url} target="_blank" rel="noreferrer">
                {lightboxKind === "video"
                  ? t("jobs.lightboxOpenOriginalVideo")
                  : t("jobs.lightboxOpenOriginal")}
              </a>
              <a href={lightboxItem.url} download>
                {lightboxKind === "video"
                  ? t("jobs.lightboxDownloadVideo")
                  : t("jobs.lightboxDownload")}
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildLightboxItems(tasks: VideoTaskDetail[], kind: LightboxKind): LightboxMediaItem[] {
  const items: LightboxMediaItem[] = [];
  for (const task of tasks) {
    if (kind === "image") {
      if (task.asset_type !== "image") {
        continue;
      }
      const urls = extractImageUrls(task);
      urls.forEach((url, index) => {
        items.push({
          key: `${task.task_id}_img_${index}_${url}`,
          taskId: task.task_id,
          url,
          kind: "image",
        });
      });
      continue;
    }
    if (task.asset_type !== "video") {
      continue;
    }
    const url = extractVideoUrl(task);
    if (!url) {
      continue;
    }
    items.push({
      key: `${task.task_id}_video_${url}`,
      taskId: task.task_id,
      url,
      kind: "video",
    });
  }
  return items;
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

function buildTaskRequestPayload(task: VideoTaskDetail) {
  return {
    provider: task.provider,
    model: task.model,
    operation: task.operation ?? "generate",
    prompt: task.prompt,
    negative_prompt: task.negative_prompt,
    duration_sec: task.duration_sec,
    resolution: task.resolution,
    fps: task.fps,
    seed: task.seed,
    provider_options: task.provider_options ?? {},
  };
}

function formatRawDebugPayload(task: VideoTaskDetail): string {
  if (task.status === "failed" && task.error) {
    const rawError = task.error.raw_error;
    if (rawError !== undefined) {
      return JSON.stringify(rawError, null, 2);
    }
    return JSON.stringify(task.error, null, 2);
  }
  return JSON.stringify(task.result, null, 2);
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
