import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Star,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";
import { fetchTaskDetail } from "../api";
import { AppLightboxStage } from "../components/AppLightboxStage";
import { SkeletonGrid, EmptyStateWorks } from "../components/Skeletons";
import { ScrollReveal } from "../useScrollEntry";
import { MediaDetailSidebar } from "../components/MediaDetailSidebar";
import { MediaOverlayFrame } from "../components/MediaOverlayFrame";
import { useI18n, type TranslateFn } from "../i18n";
import {
  buildLightboxItems,
  extractVideoPoster,
  inferTaskPortrait,
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
} from "../overlayTaskPresentation";
import { useAppSettingsStore } from "../state";
import {
  readFavoriteTaskIds,
  useCompactOverlayInfo,
  useEscapeToClose,
  useOverlayScrollLock,
} from "../useMediaOverlay";
import type { VideoTaskDetail, VideoTaskResponse } from "../types";
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

const WORKS_FAVORITES_KEY = "scenewords_works_favorites_v1";

type BrowseFilter = "all" | "image" | "video" | "favorite";

export function JobsPage(props: Props) {
  const { tasks, loading } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const handledTaskDeepLinkRef = useRef<string>("");

  const [browseFilter, setBrowseFilter] = useState<BrowseFilter>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [hoverVideoTaskId, setHoverVideoTaskId] = useState<string | null>(null);
  const [favoriteTaskIds, setFavoriteTaskIds] = useState<string[]>(() =>
    readFavoriteTaskIds(WORKS_FAVORITES_KEY),
  );
  const [lightboxState, setLightboxState] = useState<{ kind: LightboxKind; index: number } | null>(null);
  const isLightboxOpen = lightboxState !== null;
  const { isInfoHidden, setIsInfoHidden } = useCompactOverlayInfo(isLightboxOpen);
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

  useEffect(() => {
    localStorage.setItem(WORKS_FAVORITES_KEY, JSON.stringify(favoriteTaskIds));
  }, [favoriteTaskIds]);

  const assetList = useMemo(() => {
    if (browseFilter === "favorite") {
      return completedTasks.filter((task) => favoriteTaskIds.includes(task.task_id));
    }
    if (browseFilter === "all") {
      return completedTasks;
    }
    return completedTasks.filter((task) => task.asset_type === browseFilter);
  }, [browseFilter, completedTasks, favoriteTaskIds]);

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
  const currentLightboxIsPortrait = currentLightboxTask ? inferTaskPortrait(currentLightboxTask) : false;
  const [isRawResultOpen, setIsRawResultOpen] = useState(false);

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
    enabled: isRawResultOpen && Boolean(currentLightboxTask),
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

  useEscapeToClose(lightboxIndex != null, () => setLightboxState(null));

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
    onSuccess: async (response) => {
      setHint(formatRetryQueuedMessage(response.task_id, t));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(formatRetryErrorMessage(error, t));
    },
  });

  const mapErrorCode = (code: string): string | null => {
    const key = `error.${code}`;
    const translated = t(key);
    return translated === key ? null : translated;
  };
  const worksCount = completedTasks.length;
  const imageCount = completedTasks.filter((task) => task.asset_type === "image").length;
  const videoCount = completedTasks.filter((task) => task.asset_type === "video").length;
  const favoriteCount = completedTasks.filter((task) => favoriteTaskIds.includes(task.task_id)).length;
  const toggleFavorite = (taskId: string) => {
    setFavoriteTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [taskId, ...current],
    );
  };
  const sidebarActions = currentLightboxTask
    ? buildMediaSidebarActions({
        task: currentLightboxTask,
        t,
        deleteDisabled: deleteMutation.isPending,
        retryDisabled: retryMutation.isPending,
        showBothRetryActions: settings.showBothRetryActions,
        retryModeDefault: settings.retryModeDefault,
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

  if (loading) {
    return (
      <div className="flex w-full flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-8 w-32" />
          <div className="skeleton h-4 w-64" />
        </div>
        <SkeletonGrid count={6} />
      </div>
    );
  }

  const filterPills: Array<{ value: BrowseFilter; label: string; count: number }> = [
    { value: "all", label: t("jobs.kindAll"), count: worksCount },
    { value: "image", label: t("jobs.kindImage"), count: imageCount },
    { value: "video", label: t("jobs.kindVideo"), count: videoCount },
    { value: "favorite", label: t("jobs.favorite"), count: favoriteCount },
  ];

  return (
    <div className="flex w-full flex-col gap-8">
      <ScrollReveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-display m-0">
              {t("nav.jobs")}
            </h1>
            <p className="mb-0 mt-2 text-sm text-[var(--c-text-secondary)]">
              {t("jobs.pageSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tag tag-neutral">
              {t("jobs.statsAll", { count: worksCount })}
            </span>
            <span className="tag tag-neutral">
              {t("jobs.statsImages", { count: imageCount })}
            </span>
            <span className="tag tag-neutral">
              {t("jobs.statsVideos", { count: videoCount })}
            </span>
            <span className="tag tag-neutral">
              {t("jobs.statsInProgress", { count: inProgressTasks.length })}
            </span>
          </div>
        </div>
      </ScrollReveal>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
            {filterPills.map((pill) => {
              const isActive = browseFilter === pill.value;
              return (
                <button
                  type="button"
                  key={pill.value}
                  onClick={() => setBrowseFilter(pill.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive ? "bg-cta text-white" : "text-[var(--c-text-secondary)] hover:bg-[rgba(0,0,0,0.03)]"
                  }`}
                >
                  {pill.label} {pill.count}
                </button>
              );
            })}
          </div>
          {!!inProgressTasks.length && (
            <div className="tag tag-warning">
              {t("jobs.inProgressBreakdown", { imageCount: inProgressBreakdown.imageCount, videoCount: inProgressBreakdown.videoCount })}
            </div>
          )}
        </div>

        <div className="mt-3 mt-1">
          <MasonryGrid
            items={assetList}
            selectedTaskId={selectedTaskId}
            setSelectedTaskId={setSelectedTaskId}
            hoverVideoTaskId={hoverVideoTaskId}
            setHoverVideoTaskId={setHoverVideoTaskId}
            t={t}
            openImageLightbox={openImageLightbox}
            openVideoLightbox={openVideoLightbox}
            formatTime={formatTime}
            extractImageUrls={extractImageUrls}
            extractVideoUrl={extractVideoUrl}
            locale={locale}
            favoriteTaskIds={favoriteTaskIds}
            toggleFavorite={toggleFavorite}
          />
        </div>
      </section>

      {hint ? <p className="m-0 text-xs text-[var(--c-text-tertiary)]">{hint}</p> : null}

      {lightboxItem && currentLightboxTask ? (
        <MediaOverlayFrame
          title={t("jobs.workPreview")}
          currentIndex={lightboxIndex}
          totalItems={lightboxItems.length}
          isInfoHidden={isInfoHidden}
          onToggleInfo={() => setIsInfoHidden((current) => !current)}
          onClose={() => setLightboxState(null)}
          showInfoLabel={t("jobs.showInfo")}
          hideInfoLabel={t("jobs.hideInfo")}
          backLabel={t("jobs.back")}
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
            currentLightboxIsPortrait
              ? t("jobs.portraitHint")
              : t("jobs.landscapeHint")
          }
          sidebar={
            <MediaDetailSidebar
              task={currentLightboxTask}
              statusLabel={formatOverlayTaskStatus(currentLightboxTask, t)}
              updatedAtLabel={formatTime(currentLightboxTask.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
              isFavorited={favoriteTaskIds.includes(currentLightboxTask.task_id)}
              downloadUrl={lightboxItem.url}
              onReuse={() => {
                settings.setPendingReuseDraft(toDraft(currentLightboxTask));
                navigate("/create");
              }}
              onToggleFavorite={() => toggleFavorite(currentLightboxTask.task_id)}
              onDelete={sidebarActions?.onDelete ?? (() => undefined)}
              deleteDisabled={sidebarActions?.deleteDisabled}
              cancelAction={sidebarActions?.cancelAction}
              retryActions={sidebarActions?.retryActions}
              onCopyRequestJson={() => {
                const payload = buildTaskRequestPayload(currentLightboxTask);
                const text = JSON.stringify(payload, null, 2);
                void copyText(text).then(
                  () => setHint(t("jobs.copyJsonSuccess")),
                  () => setHint(t("jobs.copyJsonFailed")),
                );
              }}
              isRawResultOpen={isRawResultOpen}
              onRawResultOpenChange={setIsRawResultOpen}
              rawResultPending={taskDetailQuery.isPending}
              rawResultError={taskDetailQuery.error ? (taskDetailQuery.error as Error).message : null}
              rawResultPayload={rawResultPayload}
              errorText={errorMessage(currentLightboxTask, {
                mapErrorCode,
                fallbackMessage: t("error.defaultFailure"),
              })}
            />
          }
        />
      ) : null}
    </div>
  );
}

function AssetCardMedia({
  task,
  thumb,
  videoUrl,
  videoPoster,
  isHovered,
  isPortrait,
  onHover,
  onOpen,
  t,
}: {
  task: VideoTaskDetail;
  thumb: string | null;
  videoUrl: string | null;
  videoPoster: string | null;
  isHovered: boolean;
  isPortrait: boolean;
  onHover: (id: string | null) => void;
  onOpen: () => void;
  t: TranslateFn;
}) {
  const [hasError, setHasError] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState<boolean>(() =>
    task.asset_type === "video" ? Boolean(videoPoster) : true,
  );
  const mediaWrapClass = isPortrait ? "aspect-[3/4]" : "aspect-video";
  const isVideoTask = task.asset_type === "video";

  useEffect(() => {
    if (!isVideoTask) {
      return;
    }
    setIsVideoReady(Boolean(videoPoster));
  }, [isVideoTask, videoPoster, videoUrl]);

  if (hasError || (!thumb && !videoUrl)) {
    const isFailed = task.status === "failed";
    return (
      <button
        type="button"
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-border ${
          isFailed ? "bg-error-bg text-error-text" : "bg-canvas text-[var(--c-text-tertiary)]"
        }`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
          {isFailed ? (
            <>
              <WarningCircle size={22} weight="regular" />
              <span className="font-medium">{t("jobs.generationFailed")}</span>
            </>
          ) : (
            <span className="font-medium">
              {task.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}
            </span>
          )}
        </div>
      </button>
    );
  }

  if (isVideoTask) {
    return (
      <button
        type="button"
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-border bg-canvas`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onMouseEnter={() => onHover(task.task_id)}
        onMouseLeave={() => onHover(null)}
      >
        <video
          className="h-full w-full object-cover"
          src={videoUrl ?? undefined}
          poster={videoPoster ?? thumb ?? undefined}
          muted
          playsInline
          preload={isHovered ? "metadata" : "none"}
          autoPlay={isHovered}
          loop
          onLoadedData={() => setIsVideoReady(true)}
          onCanPlay={() => setIsVideoReady(true)}
          onError={() => setHasError(true)}
        />
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
            isVideoReady ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#F3EBDD] via-[#E7DFD2] to-[#DDD4C6]" />
          <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-2">
            <span className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-1 text-[10px] font-medium text-[var(--c-text-secondary)]">
              <Play size={11} weight="fill" />
              {t("jobs.videoLoading")}
            </span>
          </div>
        </div>
        <span className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white">
          {t("jobs.previewVideo")}
        </span>
      </button>
    );
  }

  if (thumb) {
    return (
      <button
        type="button"
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-border bg-canvas`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <img
          className="h-full w-full object-cover"
          src={thumb}
          alt={task.task_id}
          onError={() => setHasError(true)}
          loading="lazy"
        />
        <span className="absolute inset-0 flex items-end justify-end bg-black/0 p-2 text-[10px] font-semibold text-white/0 transition-colors group-hover:bg-black/10 group-hover:text-white/85">
          {t("jobs.previewImage")}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-border bg-black`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onMouseEnter={() => onHover(task.task_id)}
      onMouseLeave={() => onHover(null)}
    >
      <video
        className="h-full w-full object-cover"
        src={videoUrl ?? undefined}
        muted
        playsInline
        preload={isHovered ? "metadata" : "none"}
        autoPlay={isHovered}
        loop
        onError={() => setHasError(true)}
      />
      <span className="absolute bottom-2 left-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
        {t("jobs.previewVideo")}
      </span>
    </button>
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
  const portrait = inferTaskPortrait(task);
  if (task.asset_type === "video") {
    return portrait ? 1.55 : 1.1;
  }
  return portrait ? 1.42 : 0.98;
}

function MasonryGrid({
  items,
  selectedTaskId,
  setSelectedTaskId,
  hoverVideoTaskId,
  setHoverVideoTaskId,
  t,
  openImageLightbox,
  openVideoLightbox,
  formatTime,
  extractImageUrls,
  extractVideoUrl,
  locale,
  favoriteTaskIds,
  toggleFavorite,
}: {
  items: VideoTaskDetail[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  hoverVideoTaskId: string | null;
  setHoverVideoTaskId: (id: string | null) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  openImageLightbox: (id: string, url?: string) => void;
  openVideoLightbox: (id: string, url?: string) => void;
  formatTime: (date: string, locale?: string) => string;
  extractImageUrls: (task: VideoTaskDetail) => string[];
  extractVideoUrl: (task: VideoTaskDetail) => string | null;
  locale: string;
  favoriteTaskIds: string[];
  toggleFavorite: (taskId: string) => void;
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
    <div className="flex w-full items-start gap-3">
      {columns.map((columnItems, columnIndex) => (
        <div key={columnIndex} className="flex flex-1 flex-col gap-3">
          {columnItems.map((task) => {
            const imageUrls = extractImageUrls(task);
            const thumb = imageUrls[0] ?? null;
            const videoUrl = task.asset_type === "video" ? extractVideoUrl(task) : null;
            const videoPoster = task.asset_type === "video" ? extractVideoPoster(task) ?? thumb : null;
            const isFavorite = favoriteTaskIds.includes(task.task_id);
            const isPortrait = inferTaskPortrait(task);
            return (
              <article
                key={task.task_id}
                className={`relative overflow-hidden rounded-xl border bg-surface p-2 transition-[box-shadow,border-color] ${
                  task.task_id === selectedTaskId
                    ? "border-[var(--c-text)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                    : "border-border hover:border-[#D4D4D4] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                }`}
                onClick={() => setSelectedTaskId(task.task_id)}
              >
                <button
                  type="button"
                  className={`absolute right-3 top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-colors ${
                    isFavorite
                      ? "border-[#E8A878] bg-accent-bg text-accent"
                      : "border-border bg-white/90 text-[#9B907F] hover:border-accent hover:text-accent"
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(task.task_id);
                  }}
                  title={isFavorite ? t("jobs.unfavorite") : t("jobs.favorite")}
                >
                  <Star size={13} weight={isFavorite ? "fill" : "regular"} />
                </button>

                <AssetCardMedia
                  task={task}
                  thumb={thumb}
                  videoUrl={videoUrl}
                  videoPoster={videoPoster}
                  isHovered={hoverVideoTaskId === task.task_id}
                  isPortrait={isPortrait}
                  onHover={setHoverVideoTaskId}
                  onOpen={() => {
                    setSelectedTaskId(task.task_id);
                    if (task.asset_type === "video") {
                      if (videoUrl) {
                        openVideoLightbox(task.task_id, videoUrl);
                        return;
                      }
                      openVideoLightbox(task.task_id);
                      return;
                    }
                    if (thumb) {
                      openImageLightbox(task.task_id, thumb);
                      return;
                    }
                    if (task.status === "failed") {
                      if (task.asset_type === "image") {
                        openImageLightbox(task.task_id);
                      } else {
                        openVideoLightbox(task.task_id);
                      }
                    }
                  }}
                  t={t}
                />

                <div className="mt-2 flex flex-col gap-1 px-0.5 pb-0.5">
                  <p className="m-0 line-clamp-2 text-xs font-semibold leading-relaxed text-[var(--c-text)]">
                    {task.prompt || t("jobs.emptyPrompt")}
                  </p>
                  <p className="m-0 truncate text-[10px] text-[var(--c-text-tertiary)]">
                    {task.provider || task.model} · {formatTime(task.created_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </div>
  );
}
