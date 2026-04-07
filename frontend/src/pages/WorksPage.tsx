import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { fetchTaskDetail } from "../api";
import { AppLightboxStage } from "../components/AppLightboxStage";
import { SkeletonGrid, EmptyStateWorks } from "../components/Skeletons";
import { MediaDetailSidebar } from "../components/MediaDetailSidebar";
import { MediaOverlayFrame } from "../components/MediaOverlayFrame";
import { TaskPreviewCard } from "../components/TaskPreviewCard";
import { useI18n, type TranslateFn } from "../i18n";
import {
  buildLightboxItems,
  inferTaskOrientation,
  type LightboxKind,
} from "../lightbox";
import {
  buildTaskRequestPayload,
  copyText,
  formatRawDebugPayload,
  toDraft,
} from "../overlayTaskUtils";
import {
  formatRetryErrorMessage,
  formatRetryQueuedMessage,
  formatTaskActionErrorMessage,
  formatTaskActionSuccessMessage,
  type RetryTaskPayload,
  type TaskActionPayload,
  runRetryTask,
  runTaskAction,
} from "../overlayTaskActions";
import {
  buildMediaSidebarActions,
  formatOverlayTaskStatus,
  providerSupportsSeedRetry,
} from "../overlayTaskPresentation";
import { useAppSettingsStore } from "../state";
import {
  useEscapeToClose,
  useOverlayScrollLock,
} from "../useMediaOverlay";
import type { VideoTaskDetail, VideoTaskResponse } from "../types";
import {
  errorMessage,
  formatTime,
} from "../utils";

interface Props {
  tasks: VideoTaskDetail[];
  loading: boolean;
}

type BrowseFilter = "all" | "image" | "video";

export function WorksPage(props: Props) {
  const { tasks, loading } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const handledTaskDeepLinkRef = useRef<string>("");
  const inProgressSectionRef = useRef<HTMLElement | null>(null);

  const [browseFilter, setBrowseFilter] = useState<BrowseFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [lightboxState, setLightboxState] = useState<{ kind: LightboxKind; index: number } | null>(null);
  const [isMediaExpanded, setIsMediaExpanded] = useState(false);
  const isLightboxOpen = lightboxState !== null;
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.task_id, task])),
    [tasks],
  );

  const inProgressTasks = useMemo(
    () => tasks.filter((task) => task.status === "queued" || task.status === "running"),
    [tasks],
  );
  const completedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "queued" && task.status !== "running")
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
    [tasks],
  );
  const inProgressBreakdown = useMemo(
    () => ({
      imageCount: inProgressTasks.filter((task) => task.asset_type === "image").length,
      videoCount: inProgressTasks.filter((task) => task.asset_type === "video").length,
    }),
    [inProgressTasks],
  );

  const providerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          completedTasks
            .map((task) => task.provider)
            .filter((provider): provider is string => Boolean(provider)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [completedTasks],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const assetList = useMemo(() => {
    let nextList = completedTasks;
    if (browseFilter !== "all") {
      nextList = completedTasks.filter((task) => task.asset_type === browseFilter);
    }

    if (providerFilter !== "all") {
      nextList = nextList.filter((task) => task.provider === providerFilter);
    }
    if (!normalizedSearchQuery) {
      return nextList;
    }
    return nextList.filter((task) => {
      const searchable = [
        task.task_id,
        task.provider,
        task.model,
        task.prompt ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedSearchQuery);
    });
  }, [browseFilter, completedTasks, normalizedSearchQuery, providerFilter]);

  useEffect(() => {
    if (!assetList.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !assetList.some((task) => task.task_id === selectedTaskId)) {
      setSelectedTaskId(assetList[0].task_id);
    }
  }, [assetList, selectedTaskId]);

  const imageLightboxItems = useMemo(() => buildLightboxItems(assetList, "image"), [assetList]);
  const videoLightboxItems = useMemo(() => buildLightboxItems(assetList, "video"), [assetList]);
  const allImageLightboxItems = useMemo(
    () => buildLightboxItems(completedTasks, "image"),
    [completedTasks],
  );
  const allVideoLightboxItems = useMemo(
    () => buildLightboxItems(completedTasks, "video"),
    [completedTasks],
  );
  const lightboxItems = lightboxState?.kind === "video" ? videoLightboxItems : imageLightboxItems;
  const lightboxIndex = lightboxState?.index ?? null;
  const lightboxItem = useMemo(() => {
    if (lightboxIndex == null || lightboxIndex < 0 || lightboxIndex >= lightboxItems.length) {
      return null;
    }
    return lightboxItems[lightboxIndex];
  }, [lightboxIndex, lightboxItems]);
  const currentLightboxTask = lightboxItem
    ? taskById.get(lightboxItem.taskId) ?? null
    : null;
  const currentLightboxOrientation = currentLightboxTask
    ? inferTaskOrientation(currentLightboxTask)
    : "landscape";
  const [isRawResultOpen, setIsRawResultOpen] = useState(false);
  const [queuedRetryTaskId, setQueuedRetryTaskId] = useState<string | null>(null);

  const taskDetailQuery = useQuery({
    queryKey: [
      "task-detail",
      settings.gatewayToken,
      currentLightboxTask?.asset_type,
      currentLightboxTask?.task_id,
    ],
    queryFn: async () => {
      if (!currentLightboxTask) {
        throw new Error("Missing task context");
      }
      return fetchTaskDetail(
        currentLightboxTask.task_id,
        settings.gatewayToken,
        currentLightboxTask.asset_type,
      );
    },
    enabled:
      Boolean(currentLightboxTask) &&
      (isRawResultOpen || currentLightboxTask?.status === "failed"),
    staleTime: 30_000,
  });
  const rawResultTask = taskDetailQuery.data ?? currentLightboxTask;
  const rawResultPayload = useMemo(() => {
    if (!isRawResultOpen || !rawResultTask) {
      return "";
    }
    return formatRawDebugPayload(rawResultTask);
  }, [isRawResultOpen, rawResultTask]);

  useEffect(() => {
    setIsRawResultOpen(false);
  }, [currentLightboxTask?.task_id]);

  useEffect(() => {
    setIsMediaExpanded(false);
  }, [currentLightboxTask?.task_id]);

  useEffect(() => {
    setQueuedRetryTaskId(null);
  }, [currentLightboxTask?.task_id]);

  useOverlayScrollLock(isLightboxOpen);

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

  useEscapeToClose(lightboxIndex != null && !isMediaExpanded, () => setLightboxState(null));
  useEscapeToClose(isMediaExpanded, () => setIsMediaExpanded(false));

  const openImageLightbox = (taskId: string, imageUrl?: string) => {
    const index = imageLightboxItems.findIndex(
      (item) => item.taskId === taskId && (!imageUrl || item.url === imageUrl),
    );
    if (index >= 0) {
      setLightboxState({ kind: "image", index });
    }
  };

  const openVideoLightbox = (taskId: string, videoUrl?: string) => {
    const index = videoLightboxItems.findIndex(
      (item) => item.taskId === taskId && (!videoUrl || item.url === videoUrl),
    );
    if (index >= 0) {
      setLightboxState({ kind: "video", index });
    }
  };

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get("taskId")?.trim() ?? "";
    if (!taskId) {
      handledTaskDeepLinkRef.current = "";
      return;
    }
    if (handledTaskDeepLinkRef.current === taskId) {
      return;
    }
    const targetTask = completedTasks.find((task) => task.task_id === taskId);
    if (!targetTask) {
      return;
    }

    handledTaskDeepLinkRef.current = taskId;
    setBrowseFilter("all");
    setSelectedTaskId(taskId);

    if (targetTask.asset_type === "video") {
      const nextIndex = allVideoLightboxItems.findIndex((item) => item.taskId === taskId);
      if (nextIndex >= 0) {
        setLightboxState({ kind: "video", index: nextIndex });
      }
      return;
    }
    const nextIndex = allImageLightboxItems.findIndex((item) => item.taskId === taskId);
    if (nextIndex >= 0) {
      setLightboxState({ kind: "image", index: nextIndex });
    }
  }, [allImageLightboxItems, allVideoLightboxItems, completedTasks, location.search]);

  const deleteMutation = useMutation<unknown, Error, TaskActionPayload>({
    mutationFn: (payload) => runTaskAction(payload, settings.gatewayToken),
    onSuccess: async (_data, payload) => {
      setHint(formatTaskActionSuccessMessage(payload, t));
      setSelectedTaskId((current) => (current === payload.taskId ? null : current));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error, payload) => {
      setHint(formatTaskActionErrorMessage(payload, error, t));
    },
  });

  const retryMutation = useMutation<VideoTaskResponse, Error, RetryTaskPayload>({
    mutationFn: (payload) => runRetryTask(payload, settings.gatewayToken),
    onSuccess: async (response, payload) => {
      setQueuedRetryTaskId(payload.task.task_id);
      setHint(formatRetryQueuedMessage(response.task_id, t));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(formatRetryErrorMessage(error, t));
    },
  });

  const worksCount = completedTasks.length;
  const imageCount = completedTasks.filter((task) => task.asset_type === "image").length;
  const videoCount = completedTasks.filter((task) => task.asset_type === "video").length;
  const sidebarActions = currentLightboxTask
    ? buildMediaSidebarActions({
        task: currentLightboxTask,
        t,
        deleteDisabled: deleteMutation.isPending,
        retryDisabled: retryMutation.isPending,
        showBothRetryActions: settings.showBothRetryActions,
        retryModeDefault: settings.retryModeDefault,
        supportsSeedRetry: providerSupportsSeedRetry(currentLightboxTask.provider),
        onDeleteConfirmed: () => {
          deleteMutation.mutate({
            taskId: currentLightboxTask.task_id,
            assetType: currentLightboxTask.asset_type,
            action: "delete",
          });
          setLightboxState(null);
        },
        onCancelConfirmed: () => {
          deleteMutation.mutate({
            taskId: currentLightboxTask.task_id,
            assetType: currentLightboxTask.asset_type,
            action: "cancel",
          });
        },
        onRetry: (mode) =>
          retryMutation.mutate({
            task: currentLightboxTask,
            mode,
          }),
      })
    : null;
  const retryActions =
    currentLightboxTask && queuedRetryTaskId === currentLightboxTask.task_id
      ? {
          disabled: true,
          defaultLabel: t("works.retryQueuedSticky"),
          onDefault: () => undefined,
        }
      : sidebarActions?.retryActions;

  if (loading) {
    return (
      <div className="flex w-full flex-col gap-6">
        <SkeletonGrid count={6} />
      </div>
    );
  }

  const filterPills: Array<{ value: BrowseFilter; label: string; count: number }> = [
    { value: "all", label: t("works.kindAll"), count: worksCount },
    { value: "image", label: t("works.kindImage"), count: imageCount },
    { value: "video", label: t("works.kindVideo"), count: videoCount },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="card">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="segment-group">
            {filterPills.map((pill) => {
              const isActive = browseFilter === pill.value;
              return (
                <button
                  type="button"
                  key={pill.value}
                  onClick={() => setBrowseFilter(pill.value)}
                  className={`segment-item ${isActive ? "segment-active" : ""}`}
                >
                  {pill.label} {pill.count}
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(280px,360px)_minmax(220px,1fr)] sm:items-center xl:grid-cols-[minmax(280px,360px)_minmax(220px,1fr)_auto]">
            <label className="flex h-10 w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--c-border-focus)] focus-within:shadow-[0_0_0_3px_rgba(161,161,170,0.12)]">
              <MagnifyingGlass
                size={14}
                weight="regular"
                className="shrink-0 text-[var(--c-text-tertiary)]"
              />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("works.searchPlaceholder")}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-[var(--c-text)] outline-none placeholder:text-[var(--c-text-tertiary)]"
                aria-label={t("works.searchPlaceholder")}
              />
            </label>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="input-base h-10 w-full min-w-0"
              aria-label={t("works.allProviders")}
            >
              <option value="all">{t("works.allProviders")}</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
            {!!inProgressTasks.length && (
              <span className="tag tag-warning font-mono tabular-nums">
                {t("works.inProgressBreakdown", { imageCount: inProgressBreakdown.imageCount, videoCount: inProgressBreakdown.videoCount })}
              </span>
            )}
          </div>
        </div>
      </section>

      {!!inProgressTasks.length && (
        <section ref={inProgressSectionRef} className="card-flat space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <span className="text-label">{t("works.statsInProgress", { count: inProgressTasks.length })}</span>
            </div>
          </div>

          <InProgressStrip
            tasks={inProgressTasks}
            locale={locale}
            t={t}
            onCancel={(task) =>
              deleteMutation.mutate({
                taskId: task.task_id,
                assetType: task.asset_type,
                action: "cancel",
              })
            }
            cancelDisabled={deleteMutation.isPending}
          />
        </section>
      )}

      <section className="card">
        <div>
          <MasonryGrid
            items={assetList}
            selectedTaskId={selectedTaskId}
            setSelectedTaskId={setSelectedTaskId}
            openImageLightbox={openImageLightbox}
            openVideoLightbox={openVideoLightbox}
            formatTime={formatTime}
            locale={locale}
          />
        </div>
      </section>

      {hint ? <p className="m-0 text-xs text-[var(--c-text-tertiary)]">{hint}</p> : null}

      {lightboxItem && currentLightboxTask ? (
        <>
          <MediaOverlayFrame
            title={t("works.workPreview")}
            currentIndex={lightboxIndex}
            totalItems={lightboxItems.length}
            onClose={() => setLightboxState(null)}
            onExpandMedia={() => setIsMediaExpanded(true)}
            closeLabel={t("common.close")}
            media={
              <AppLightboxStage
                items={lightboxItems}
                index={lightboxIndex ?? 0}
                taskById={taskById}
                onIndexChange={(nextIndex) =>
                  setLightboxState((current) =>
                    current ? { ...current, index: nextIndex } : null,
                  )
                }
              />
            }
            mediaHint={
              currentLightboxOrientation === "portrait"
                ? t("works.portraitHint")
                : currentLightboxOrientation === "square"
                  ? t("works.squareHint")
                  : t("works.landscapeHint")
            }
            sidebar={
              <MediaDetailSidebar
                task={currentLightboxTask}
                statusLabel={formatOverlayTaskStatus(currentLightboxTask, t)}
                updatedAtLabel={formatTime(currentLightboxTask.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                downloadUrl={lightboxItem.url}
                onReuse={() => {
                  settings.setPendingReuseDraft(toDraft(currentLightboxTask));
                  navigate("/create");
                }}
                onDelete={sidebarActions?.onDelete ?? (() => undefined)}
                deleteDisabled={sidebarActions?.deleteDisabled}
                cancelAction={sidebarActions?.cancelAction}
                retryActions={retryActions}
                onCopyRequestJson={() => {
                  const payload = buildTaskRequestPayload(currentLightboxTask);
                  const text = JSON.stringify(payload, null, 2);
                  void copyText(text).then(
                    () => setHint(t("works.copyJsonSuccess")),
                    () => setHint(t("works.copyJsonFailed")),
                  );
                }}
                isRawResultOpen={isRawResultOpen}
                onRawResultOpenChange={setIsRawResultOpen}
                rawResultPending={taskDetailQuery.isPending}
                rawResultError={taskDetailQuery.error ? (taskDetailQuery.error as Error).message : null}
                rawResultPayload={rawResultPayload}
                errorText={
                  rawResultTask
                    ? errorMessage(rawResultTask, {
                        fallbackMessage: t("error.defaultFailure"),
                        providerRetryRecommendedMessage: t("error.providerRetryRecommended"),
                      })
                    : null
                }
              />
            }
          />
          {isMediaExpanded ? (
            <div
              className="fixed inset-0 z-[60] bg-[rgba(9,9,11,0.8)] p-4 backdrop-blur-[4px]"
              role="dialog"
              aria-modal="true"
              onClick={() => setIsMediaExpanded(false)}
            >
              <div
                className="relative mx-auto flex h-full max-w-[min(96vw,1460px)] items-center justify-center"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(24,24,27,0.82)] text-white shadow-[var(--shadow-lg)] transition-colors hover:bg-[rgba(39,39,42,0.92)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  onClick={() => setIsMediaExpanded(false)}
                  aria-label={t("common.close")}
                  title={t("common.close")}
                >
                  ×
                </button>
                <div className="h-full w-full overflow-hidden rounded-[28px] bg-[rgba(10,10,14,0.9)] p-3 shadow-[var(--shadow-overlay)] md:p-4">
                  <AppLightboxStage
                    items={lightboxItems}
                    index={lightboxIndex ?? 0}
                    taskById={taskById}
                    onIndexChange={(nextIndex) =>
                      setLightboxState((current) =>
                        current ? { ...current, index: nextIndex } : null,
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function InProgressStrip({
  tasks,
  locale,
  t,
  onCancel,
  cancelDisabled,
}: {
  tasks: VideoTaskDetail[];
  locale: string;
  t: TranslateFn;
  onCancel: (task: VideoTaskDetail) => void;
  cancelDisabled?: boolean;
}) {
  const sortedTasks = [...tasks].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3">
        {sortedTasks.map((task) => (
          <article
            key={task.task_id}
            className="flex w-[280px] flex-col gap-3 rounded-2xl border border-border bg-surface px-4 py-4 shadow-[var(--shadow-xs)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="tag tag-warning">{t("works.inProgressCardStatus")}</span>
              <span className="text-[10px] text-[var(--c-text-tertiary)]">
                {task.asset_type === "image" ? t("works.kindImage") : t("works.kindVideo")}
              </span>
            </div>
            <p className="m-0 line-clamp-3 text-sm font-semibold leading-6 text-[var(--c-text)]">
              {task.prompt || t("works.emptyPrompt")}
            </p>
            <div className="space-y-1 text-[11px] text-[var(--c-text-secondary)]">
              <p className="m-0 truncate">{task.provider || task.model}</p>
              <p className="m-0">{formatTime(task.created_at, locale === "zh-CN" ? "zh-CN" : "en-US")}</p>
            </div>
            <div className="pt-1">
              <button
                type="button"
                className="btn-danger text-xs"
                onClick={() => onCancel(task)}
                disabled={cancelDisabled}
              >
                {t("works.cancelInProgress")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return width;
}

function estimateCardWeight(task: VideoTaskDetail): number {
  const portrait = inferTaskOrientation(task) === "portrait";
  if (task.asset_type === "video") {
    return portrait ? 1.55 : 1.1;
  }
  return portrait ? 1.42 : 0.98;
}

function MasonryGrid({
  items,
  selectedTaskId,
  setSelectedTaskId,
  openImageLightbox,
  openVideoLightbox,
  formatTime,
  locale,
}: {
  items: VideoTaskDetail[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  openImageLightbox: (id: string, url?: string) => void;
  openVideoLightbox: (id: string, url?: string) => void;
  formatTime: (date: string, locale?: string) => string;
  locale: string;
}) {
  const width = useWindowWidth();
  const columnCount = width >= 1280 ? 4 : width >= 980 ? 3 : width >= 640 ? 2 : 1;

  const columns = useMemo(() => {
    const cols: VideoTaskDetail[][] = Array.from({ length: columnCount }, () => []);
    const columnHeights = Array.from({ length: columnCount }, () => 0);
    items.forEach((item) => {
      const weight = estimateCardWeight(item);
      let shortestIndex = 0;
      for (let index = 1; index < columnCount; index += 1) {
        if (columnHeights[index] < columnHeights[shortestIndex]) {
          shortestIndex = index;
        }
      }
      cols[shortestIndex].push(item);
      columnHeights[shortestIndex] += weight;
    });
    return cols;
  }, [columnCount, items]);

  if (!items.length) {
    return <EmptyStateWorks locale={locale} />;
  }

  return (
    <div className="flex w-full items-start gap-4">
      {columns.map((columnItems, columnIndex) => (
        <div key={columnIndex} className="flex flex-1 flex-col gap-4">
          {columnItems.map((task) => {
            return (
              <TaskPreviewCard
                key={task.task_id}
                task={task}
                className="media-card p-2"
                selected={task.task_id === selectedTaskId}
                timestampLabel={formatTime(task.created_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                modelLabel={task.model || task.provider}
                onClick={() => {
                  setSelectedTaskId(task.task_id);
                  if (task.asset_type === "video") {
                    openVideoLightbox(task.task_id);
                  } else {
                    openImageLightbox(task.task_id);
                  }
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
