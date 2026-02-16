import { useEffect, useMemo, useRef, useState, type TouchEvent, type TransitionEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { deleteVideoTask } from "../api";
import { useI18n, type TranslateFn } from "../i18n";
import { useAppSettingsStore } from "../state";
import type { AssetType, VideoTaskDetail } from "../types";
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
const LIGHTBOX_SWIPE_DISTANCE_PX = 56;
const LIGHTBOX_SWIPE_MAX_DURATION_MS = 900;
const LIGHTBOX_SWIPE_DOMINANCE_RATIO = 1.2;
const LIGHTBOX_SWIPE_FEEDBACK_MAX_PX = 120;
const LIGHTBOX_MEDIA_TRACK_TRANSITION_MS = 240;
const LIGHTBOX_MEDIA_TRACK_GAP_PX = 18;

interface AssetFilterSnapshot {
  kind: "all" | "video" | "image";
  searchKeyword: string;
  providerFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
}

type LightboxKind = "image" | "video" | "failed";

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

  const hasActiveFilters = !!(
    savedFilters.searchKeyword ||
    savedFilters.providerFilter !== "all" ||
    savedFilters.statusFilter !== "all" ||
    savedFilters.dateFrom ||
    savedFilters.dateTo
  );
  const [isSearchExpanded, setIsSearchExpanded] = useState(hasActiveFilters);
  const [isImmersive, setIsImmersive] = useState(false);

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
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
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
  const lightboxItem = useMemo(() => {
    if (lightboxIndex == null || lightboxIndex < 0 || lightboxIndex >= lightboxItems.length) {
      return null;
    }
    return lightboxItems[lightboxIndex];
  }, [lightboxIndex, lightboxItems]);

  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipePendingDirectionRef = useRef<"next" | "previous" | null>(null);
  const swipeCommitTimerRef = useRef<number | null>(null);
  const swipeRebaseTimerRef = useRef<number | null>(null);
  const mediaViewportRef = useRef<HTMLDivElement | null>(null);
  const [mediaViewportWidth, setMediaViewportWidth] = useState(0);
  const [mediaDragOffsetX, setMediaDragOffsetX] = useState(0);
  const [mediaIsDragging, setMediaIsDragging] = useState(false);
  const [mediaIsRebasing, setMediaIsRebasing] = useState(false);

  const mediaSlideStepPx =
    (mediaViewportWidth > 0 ? mediaViewportWidth : 360) + LIGHTBOX_MEDIA_TRACK_GAP_PX;

  const clearSwipeCommitTimer = () => {
    if (swipeCommitTimerRef.current != null) {
      window.clearTimeout(swipeCommitTimerRef.current);
      swipeCommitTimerRef.current = null;
    }
  };

  const clearSwipeRebaseTimer = () => {
    if (swipeRebaseTimerRef.current != null) {
      window.clearTimeout(swipeRebaseTimerRef.current);
      swipeRebaseTimerRef.current = null;
    }
  };

  const resetMediaDragFeedback = () => {
    setMediaIsDragging(false);
    setMediaIsRebasing(false);
    setMediaDragOffsetX(0);
  };

  const clampMediaDragOffset = (offsetX: number): number => {
    const maxOffset = Math.max(LIGHTBOX_SWIPE_FEEDBACK_MAX_PX, mediaSlideStepPx * 0.9);
    if (offsetX > maxOffset) {
      return maxOffset;
    }
    if (offsetX < -maxOffset) {
      return -maxOffset;
    }
    return offsetX;
  };

  const goToPreviousLightboxItem = () => {
    if (lightboxItems.length <= 1) {
      return;
    }
    setLightboxState((current) => {
      if (!current) {
        return null;
      }
      return {
        ...current,
        index: current.index > 0 ? current.index - 1 : lightboxItems.length - 1,
      };
    });
  };

  const goToNextLightboxItem = () => {
    if (lightboxItems.length <= 1) {
      return;
    }
    setLightboxState((current) => {
      if (!current) {
        return null;
      }
      return {
        ...current,
        index: current.index < lightboxItems.length - 1 ? current.index + 1 : 0,
      };
    });
  };

  const commitLightboxSwipe = (direction: "next" | "previous") => {
    if (lightboxItems.length <= 1) {
      return;
    }
    clearSwipeCommitTimer();
    clearSwipeRebaseTimer();
    swipePendingDirectionRef.current = direction;
    setMediaIsDragging(false);
    setMediaIsRebasing(false);
    setMediaDragOffsetX(
      direction === "next" ? -mediaSlideStepPx : mediaSlideStepPx,
    );

    // Fallback: finalize even if transitionend is missed on some devices.
    swipeCommitTimerRef.current = window.setTimeout(() => {
      finalizeCommittedSwipe();
      swipeCommitTimerRef.current = null;
    }, LIGHTBOX_MEDIA_TRACK_TRANSITION_MS + 80);
  };

  const finalizeCommittedSwipe = () => {
    const direction = swipePendingDirectionRef.current;
    if (!direction) {
      return;
    }
    swipePendingDirectionRef.current = null;
    clearSwipeCommitTimer();
    clearSwipeRebaseTimer();

    setMediaIsRebasing(true);
    if (direction === "next") {
      goToNextLightboxItem();
    } else {
      goToPreviousLightboxItem();
    }
    setMediaDragOffsetX(0);
    swipeRebaseTimerRef.current = window.setTimeout(() => {
      setMediaIsRebasing(false);
      swipeRebaseTimerRef.current = null;
    }, 34);
  };

  const handleMediaTrackTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== "transform") {
      return;
    }
    finalizeCommittedSwipe();
  };

  const mediaTrackStyle = {
    transform:
      "translate3d(" +
      (-mediaSlideStepPx + mediaDragOffsetX) +
      "px, 0, 0)",
    transition: mediaIsDragging || mediaIsRebasing
      ? "none"
      : "transform " +
        LIGHTBOX_MEDIA_TRACK_TRANSITION_MS +
        "ms cubic-bezier(0.22, 1, 0.36, 1)",
    willChange: "transform",
  };

  const resolveLightboxItemByOffset = (offset: number): LightboxMediaItem | null => {
    if (!lightboxItems.length || lightboxIndex == null) {
      return null;
    }
    if (lightboxItems.length === 1 && offset !== 0) {
      return null;
    }
    const index =
      (lightboxIndex + offset + lightboxItems.length) %
      lightboxItems.length;
    return lightboxItems[index] ?? null;
  };

  const previousLightboxItem = resolveLightboxItemByOffset(-1);
  const currentLightboxItem = resolveLightboxItemByOffset(0);
  const nextLightboxItem = resolveLightboxItemByOffset(1);

  const renderLightboxMediaItem = (
    item: LightboxMediaItem | null,
    isActive: boolean,
  ) => {
    if (!item) {
      return <div className="w-full h-full min-h-0" aria-hidden="true" />;
    }
    if (item.kind === "failed") {
      return (
        <div className="flex flex-col items-center justify-center text-white/50 gap-4 w-full h-full min-h-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <p className="text-lg font-medium">{t("jobs.generationFailed")}</p>
        </div>
      );
    }
    if (item.kind === "video") {
      return (
        <video
          className="max-w-full max-h-full object-contain shadow-2xl"
          src={item.url}
          controls={isActive}
          autoPlay={isActive}
          loop
          playsInline
          muted={!isActive}
          preload={isActive ? "metadata" : "none"}
        />
      );
    }
    return (
      <img
        className="max-w-full max-h-full object-contain shadow-2xl"
        src={item.url}
        alt={item.taskId}
      />
    );
  };

  const handleMediaTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    clearSwipeCommitTimer();
    clearSwipeRebaseTimer();
    swipePendingDirectionRef.current = null;
    if (event.touches.length !== 1) {
      swipeStartRef.current = null;
      resetMediaDragFeedback();
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    setMediaIsRebasing(false);
    setMediaIsDragging(lightboxItems.length > 1);
    setMediaDragOffsetX(0);
  };

  const handleMediaTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start || event.touches.length !== 1 || lightboxItems.length <= 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < Math.abs(deltaY) * 0.75) {
      return;
    }

    event.preventDefault();
    setMediaIsDragging(true);
    setMediaDragOffsetX(clampMediaDragOffset(deltaX));
  };

  const handleMediaTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || event.changedTouches.length !== 1 || lightboxItems.length <= 1) {
      resetMediaDragFeedback();
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const elapsed = Date.now() - start.time;

    if (
      elapsed <= LIGHTBOX_SWIPE_MAX_DURATION_MS &&
      Math.abs(deltaX) >= LIGHTBOX_SWIPE_DISTANCE_PX &&
      Math.abs(deltaX) >= Math.abs(deltaY) * LIGHTBOX_SWIPE_DOMINANCE_RATIO
    ) {
      commitLightboxSwipe(deltaX < 0 ? "next" : "previous");
      return;
    }

    setMediaIsDragging(false);
    setMediaDragOffsetX(0);
  };

  const handleMediaTouchCancel = () => {
    swipeStartRef.current = null;
    resetMediaDragFeedback();
  };

  useEffect(() => {
    if (!lightboxState) {
      return;
    }
    const element = mediaViewportRef.current;
    if (!element) {
      return;
    }

    const updateViewportWidth = () => {
      setMediaViewportWidth(element.clientWidth);
    };

    updateViewportWidth();

    if (typeof ResizeObserver === "undefined") {
      const onResize = () => updateViewportWidth();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const observer = new ResizeObserver(() => updateViewportWidth());
    observer.observe(element);
    return () => observer.disconnect();
  }, [lightboxState, isImmersive, lightboxItem?.key]);
  useEffect(() => {
    if (!lightboxState) {
      clearSwipeCommitTimer();
      clearSwipeRebaseTimer();
      swipePendingDirectionRef.current = null;
      swipeStartRef.current = null;
      resetMediaDragFeedback();
    }
  }, [lightboxState]);

  useEffect(() => {
    return () => {
      clearSwipeCommitTimer();
      clearSwipeRebaseTimer();
      swipePendingDirectionRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    if (!lightboxState) {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyWidth = body.style.width;

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [lightboxState]);
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
      // If we found a failed video item, it might be in the video list
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
    return (
      <div className="flex items-center justify-center py-32 text-gray-400 text-sm">
        {t("jobs.loading")}
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-10 py-6 flex flex-col gap-5">
      {/* ── Page Header ──────────────────────────── */}
      <div className="flex items-end justify-end gap-4">

        {/* Queue banner (collapsed) */}
        {inProgressTasks.length ? (
          <details className="shrink-0">
            <summary className="text-xs text-coral font-medium cursor-pointer hover:underline">
              {t("jobs.queueBanner", { count: inProgressTasks.length })}
            </summary>
            <div className="absolute right-6 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 z-20 w-80">
              <p className="text-xs text-gray-500 mb-2">
                {t("jobs.queueMix", {
                  imageCount: inProgressBreakdown.imageCount,
                  videoCount: inProgressBreakdown.videoCount,
                })}
              </p>
              <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
                {inProgressTasks.map((task) => (
                  <li key={task.task_id} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-gray-700">{task.task_id.slice(0, 8)}</span>
                    <span className="text-gray-400 dark:text-gray-500 flex-1 truncate">{formatLocalizedStatus(task)}</span>
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-600 transition-colors shrink-0"
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
            </div>
          </details>
        ) : null}
      </div>

      {/* ── Toolbar ───────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Kind switch */}
        <div className="inline-flex items-center gap-0.5 bg-surface rounded-lg p-0.5">
          {(["all", "video", "image"] as const).map((k) => (
            <button
              type="button"
              key={k}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${kind === k
                ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              onClick={() => setKind(k)}
            >
              {k === "all" ? t("jobs.kindAll") : k === "video" ? t("jobs.kindVideo") : t("jobs.kindImage")}
            </button>
          ))}
        </div>

        {/* Search Toggle Button */}
        <button
          type="button"
          onClick={() => setIsSearchExpanded(!isSearchExpanded)}
          className={`p-2 rounded-lg transition-colors ${isSearchExpanded
            ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
            : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          aria-label="Toggle search"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>

        {isSearchExpanded ? (
          <>
            {/* Search */}
            <div className="flex-1 min-w-0 max-w-xs">
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder={t("jobs.searchPlaceholder")}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 transition-all placeholder:text-gray-300 dark:placeholder:text-gray-600 dark:text-white"
                autoFocus
              />
            </div>

            {/* Provider filter */}
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-white"
            >
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === "all" ? t("jobs.allProviders") : provider}
                </option>
              ))}
            </select>

            {/* Advanced filters toggle */}
            <details className="relative">
              <summary className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer transition-colors select-none">
                {t("jobs.advancedFilters")}
              </summary>
              <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3 z-20 w-[min(400px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white min-w-[120px] flex-1"
                >
                  <option value="all">{t("jobs.allStatus")}</option>
                  <option value="succeeded">{statusLabel("succeeded")}</option>
                  <option value="failed">{statusLabel("failed")}</option>
                  <option value="canceled">{statusLabel("canceled")}</option>
                </select>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white min-w-[120px] flex-1"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white min-w-[120px] flex-1"
                />
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-red-400 transition-colors w-full sm:w-auto text-left"
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
          </>
        ) : null}
      </div>

      {/* ── Main: Grid + Detail ──────────────────── */}
      <div className="flex gap-6 items-start min-h-[60vh]">
        {/* Masonry Grid (Horizontal Order: L->R then down) */}
        <MasonryGrid items={assetList} selectedTaskId={selectedTaskId} setSelectedTaskId={setSelectedTaskId} hoverVideoTaskId={hoverVideoTaskId} setHoverVideoTaskId={setHoverVideoTaskId} t={t} openImageLightbox={openImageLightbox} openVideoLightbox={openVideoLightbox} formatTime={formatTime} extractImageUrls={extractImageUrls} extractVideoUrl={extractVideoUrl} locale={locale} />

      </div>

      {/* Hint */}
      {hint ? <p className="text-xs text-gray-400 m-0">{hint}</p> : null}

      {/* ── Lightbox ──────────────────────────────── */}
      {lightboxItem ? (
        <div
          className="fixed inset-0 z-50 bg-dark-overlay flex flex-col md:flex-row text-left overflow-hidden"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxState(null)}
        >
          {/* Media Area (Flex Grow) */}
          <div
            className="relative flex-1 min-h-0 md:min-h-0 flex flex-col items-center justify-center min-w-0 overflow-hidden transition-all duration-300 px-3 py-14 md:px-0 md:py-0"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleMediaTouchStart}
            onTouchMove={handleMediaTouchMove}
            onTouchEnd={handleMediaTouchEnd}
            onTouchCancel={handleMediaTouchCancel}
            style={{ touchAction: lightboxItems.length > 1 ? "pan-y" : "auto" }}
          >
            {/* Top actions: Immersive Toggle + Close */}
            <div className="absolute top-3 right-3 md:top-4 md:right-6 flex items-center gap-2 md:gap-4 z-20">
              <button
                type="button"
                className="text-white/60 hover:text-white text-xs md:text-sm bg-black/20 hover:bg-black/40 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full backdrop-blur-md transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsImmersive(!isImmersive);
                }}
              >
                {isImmersive ? t("jobs.showDetails") : t("jobs.immersiveMode")}
              </button>
              <button
                type="button"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white/60 hover:text-white transition-all backdrop-blur-md"
                onClick={() => setLightboxState(null)}
              >
                ✕
              </button>
            </div>

            {/* Media Nav Left */}
            {lightboxItems.length > 1 && (
              <button
                type="button"
                className="absolute left-2 md:left-6 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/20 hover:bg-black/40 text-white/60 hover:text-white flex items-center justify-center transition-all text-2xl backdrop-blur-md z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPreviousLightboxItem();
                }}
              >
                ‹
              </button>
            )}

            {/* Media Content */}
            <div ref={mediaViewportRef} className="w-full h-full max-w-[min(96vw,1280px)] overflow-hidden">
              <div
                className="flex items-center h-full"
                onTransitionEnd={handleMediaTrackTransitionEnd}
                style={{
                  ...mediaTrackStyle,
                  gap: `${LIGHTBOX_MEDIA_TRACK_GAP_PX}px`,
                }}
              >
                <div className="shrink-0 w-full h-full flex items-center justify-center overflow-hidden">
                  {renderLightboxMediaItem(previousLightboxItem, false)}
                </div>
                <div className="shrink-0 w-full h-full flex items-center justify-center overflow-hidden">
                  {renderLightboxMediaItem(currentLightboxItem, true)}
                </div>
                <div className="shrink-0 w-full h-full flex items-center justify-center overflow-hidden">
                  {renderLightboxMediaItem(nextLightboxItem, false)}
                </div>
              </div>
            </div>

            {/* Media Nav Right */}
            {lightboxItems.length > 1 && (
              <button
                type="button"
                className="absolute right-2 md:right-6 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/20 hover:bg-black/40 text-white/60 hover:text-white flex items-center justify-center transition-all text-2xl backdrop-blur-md z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  goToNextLightboxItem();
                }}
              >
                ›
              </button>
            )}

            {/* Counter (Bottom) */}
            {lightboxItems.length > 1 && (
              <div className="absolute bottom-3 md:bottom-6 left-1/2 -translate-x-1/2 bg-black/20 text-white/80 px-3 py-1 rounded-full text-xs backdrop-blur-md">
                {lightboxIndex != null ? lightboxIndex + 1 : 0} / {lightboxItems.length}
              </div>
            )}
          </div>

          {/* Details Panel (Right Side) */}
          {!isImmersive && (() => {
            const currentTask = tasks.find(t => t.task_id === lightboxItem.taskId);
            if (!currentTask) return null;

            return (
              <div
                className="w-full md:w-96 md:max-w-[40vw] bg-gray-900 border-t md:border-t-0 md:border-l border-white/10 flex flex-col shadow-2xl max-h-[56vh] md:max-h-none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4 md:gap-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-white/90 m-0">{t("jobs.assetDetailTitle")}</h3>
                      <p className="text-xs text-white/40 m-0 mt-1 font-mono break-all select-all">
                        {currentTask.task_id}
                        {currentTask.status !== "succeeded" ? ` · ${formatLocalizedStatus(currentTask)}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="md:hidden shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                      onClick={() => setIsImmersive(true)}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-sm text-white/80 leading-relaxed m-0 whitespace-pre-wrap font-medium">
                      {currentTask.prompt || t("jobs.emptyPrompt")}
                    </p>
                    {currentTask.negative_prompt ? (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-1">Negative Prompt</p>
                        <p className="text-xs text-white/60 leading-relaxed m-0">{currentTask.negative_prompt}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-xs">
                    <div>
                      <span className="block text-white/40 mb-0.5">{t("jobs.provider")}</span>
                      <span className="text-white/90 font-medium">{currentTask.provider}</span>
                    </div>
                    <div>
                      <span className="block text-white/40 mb-0.5">{t("jobs.model")}</span>
                      <span className="text-white/90 font-medium">{currentTask.model}</span>
                    </div>
                    {currentTask.resolution && (
                      <div>
                        <span className="block text-white/40 mb-0.5">{t("jobs.resolution")}</span>
                        <span className="text-white/90 font-medium">{currentTask.resolution}</span>
                      </div>
                    )}
                    {currentTask.duration_sec && (
                      <div>
                        <span className="block text-white/40 mb-0.5">{t("jobs.duration")}</span>
                        <span className="text-white/90 font-medium">{currentTask.duration_sec}s</span>
                      </div>
                    )}
                    <div>
                      <span className="block text-white/40 mb-0.5">{t("jobs.cost")}</span>
                      <span className="text-white/90 font-medium">
                        {settings.showActualCostPostDone && currentTask.actual_cost != null
                          ? `${currentTask.actual_cost.toFixed(3)} ${currentTask.currency ?? settings.currency}`
                          : currentTask.estimated_cost != null
                            ? `${currentTask.estimated_cost.toFixed(3)} ${currentTask.currency ?? settings.currency} ${t("jobs.estimatedSuffix")}`
                            : t("common.na")}
                      </span>
                    </div>
                    <div>
                      <span className="block text-white/40 mb-0.5">{t("jobs.created")}</span>
                      <span className="text-white/90 font-medium">{formatTime(currentTask.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-auto pt-4 border-t border-white/10">
                    <button
                      type="button"
                      className="flex-1 h-10 px-4 bg-coral hover:bg-coral-dark text-white font-medium text-sm rounded-lg transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 whitespace-nowrap"
                      onClick={() => {
                        settings.setPendingReuseDraft(toDraft(currentTask));
                        navigate("/create");
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                        <path d="M8 16H3v5" />
                      </svg>
                      {t("jobs.reusePrompt")}
                    </button>
                    {lightboxItem.url ? (
                      <a
                        href={lightboxItem.url}
                        download
                        className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                        title={t("jobs.download")}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" x2="12" y1="15" y2="3" />
                        </svg>
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-red-500/20 text-white hover:text-red-400 rounded-lg transition-colors group/delete"
                      title={t("jobs.delete")}
                      onClick={() => {
                        const confirmed = window.confirm(
                          t("jobs.deleteConfirm", {
                            taskId: currentTask.task_id.slice(0, 8),
                          }),
                        );
                        if (!confirmed) return;

                        deleteMutation.mutate({
                          taskId: currentTask.task_id,
                          assetType: currentTask.asset_type,
                          action: "delete",
                        });
                        setLightboxState(null);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white/70 group-hover/delete:text-red-400 transition-colors"
                      >
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        <line x1="10" x2="10" y1="11" y2="17" />
                        <line x1="14" x2="14" y1="11" y2="17" />
                      </svg>
                    </button>
                  </div>

                  {/* More actions section - mostly reused code logic */}
                  <details className="group pt-2 border-t border-white/10">
                    <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60 transition-colors select-none py-1">
                      {t("jobs.moreActions")}
                    </summary>
                    <div className="mt-2 flex flex-col gap-1.5 pl-2">
                      <button
                        type="button"
                        className="text-left text-xs text-white/50 hover:text-white/80 transition-colors py-1"
                        onClick={() => {
                          const payload = buildTaskRequestPayload(currentTask);
                          const text = JSON.stringify(payload, null, 2);
                          void copyText(text).then(
                            () => setHint(t("jobs.copyJsonSuccess")),
                            () => setHint(t("jobs.copyJsonFailed")),
                          );
                        }}
                      >
                        {t("jobs.copyRequestJson")}
                      </button>

                    </div>
                    <details className="mt-2 pl-2">
                      <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60">{t("jobs.rawResult")}</summary>
                      <pre className="mt-2 text-[10px] text-white/30 bg-black/20 p-2 rounded-lg overflow-x-auto max-h-40 whitespace-pre-wrap break-all border border-white/5">{formatRawDebugPayload(currentTask)}</pre>
                    </details>
                  </details>

                  {errorMessage(currentTask, {
                    mapErrorCode,
                    fallbackMessage: t("error.defaultFailure"),
                  }) ? (
                    <p className="text-xs text-red-400 m-0 mt-2">
                      {errorMessage(currentTask, {
                        mapErrorCode,
                        fallbackMessage: t("error.defaultFailure"),
                      })}
                    </p>
                  ) : null}

                </div>
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}



// ... (JobsPage component remains the same for now, we edit outside functions primarily)

function buildLightboxItems(tasks: VideoTaskDetail[], kind: "image" | "video"): LightboxMediaItem[] {
  const items: LightboxMediaItem[] = [];
  for (const task of tasks) {
    if (kind === "image") {
      if (task.asset_type !== "image") {
        continue;
      }
      if (task.status === "failed") {
        items.push({
          key: `${task.task_id}_failed`,
          taskId: task.task_id,
          url: "",
          kind: "failed",
        });
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
    // kind === "video"
    if (task.asset_type !== "video") {
      continue;
    }
    if (task.status === "failed") {
      items.push({
        key: `${task.task_id}_failed`,
        taskId: task.task_id,
        url: "",
        kind: "failed",
      });
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

function AssetCardMedia({
  task,
  thumb,
  videoUrl,
  isHovered,
  onHover,
  onClick,
  t,
}: {
  task: VideoTaskDetail;
  thumb: string | null;
  videoUrl: string | null;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
  t: TranslateFn;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError || (!thumb && !videoUrl)) {
    const isFailed = task.status === "failed";
    return (
      <div
        className={`aspect-video flex flex-col items-center justify-center text-xs rounded-t-xl border-b border-gray-100 dark:border-gray-700 cursor-pointer transition-colors ${isFailed
          ? "bg-gray-50 dark:bg-red-900/10 hover:bg-red-50/50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400"
          : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500"
          }`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {isFailed ? (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-2 opacity-80"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="font-medium opacity-90">
              {t("jobs.generationFailed")}
            </span>
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-2 opacity-40"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span className="font-medium opacity-60">
              {task.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}
            </span>
          </>
        )}
      </div>
    );
  }

  if (thumb) {
    return (
      <button
        type="button"
        className="relative w-full block bg-transparent border-none p-0 cursor-pointer group"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <img
          className="w-full block rounded-t-xl min-h-[100px] object-cover bg-gray-50 dark:bg-gray-800"
          src={thumb}
          alt={task.task_id}
          onError={() => setHasError(true)}
          loading="lazy"
        />
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center text-white/0 group-hover:text-white/80 text-xs font-medium">
          {t("jobs.previewImage")}
        </span>
      </button>
    );
  }

  if (videoUrl) {
    return (
      <button
        type="button"
        className="relative w-full block bg-transparent border-none p-0 cursor-pointer group"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onMouseEnter={() => onHover(task.task_id)}
        onMouseLeave={() => onHover(null)}
      >
        <video
          className="w-full block rounded-t-xl bg-black"
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          autoPlay={isHovered}
          loop
          onError={() => setHasError(true)}
        />
        <span className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-md font-medium">
          {t("jobs.previewVideo")}
        </span>
      </button>
    );
  }

  return null;
}

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return width;
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
  locale
}: {
  items: VideoTaskDetail[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  hoverVideoTaskId: string | null;
  setHoverVideoTaskId: (id: string | null) => void;
  t: (key: string, params?: any) => string;
  openImageLightbox: (id: string, url?: string) => void;
  openVideoLightbox: (id: string, url?: string) => void;
  formatTime: (date: string, locale?: string) => string;
  extractImageUrls: (task: VideoTaskDetail) => string[];
  extractVideoUrl: (task: VideoTaskDetail) => string | null;
  locale: string;
}) {
  const width = useWindowWidth();
  // md breakpoint is 768px
  const columnCount = width >= 1024 ? 3 : width >= 640 ? 2 : 1;

  const columns = useMemo(() => {
    const cols: VideoTaskDetail[][] = Array.from({ length: columnCount }, () => []);
    items.forEach((item, index) => {
      cols[index % columnCount].push(item);
    });
    return cols;
  }, [items, columnCount]);

  if (!items.length) {
    return (
      <div className="w-full flex items-center justify-center py-20 text-sm text-gray-400">
        {t("jobs.assetEmpty")}
      </div>
    );
  }

  return (
    <div className="flex gap-4 w-full items-start">
      {columns.map((colItems, colIndex) => (
        <div key={colIndex} className="flex-1 flex flex-col gap-4">
          {colItems.map((task) => {
            const imageUrls = extractImageUrls(task);
            const thumb = imageUrls[0] ?? null;
            const videoUrl = task.asset_type === "video" ? extractVideoUrl(task) : null;

            return (
              <article
                key={task.task_id}
                className={`rounded-xl overflow-hidden cursor-pointer border-2 transition-all hover:shadow-md ${task.task_id === selectedTaskId
                  ? "border-coral shadow-md"
                  : "border-transparent"
                  }`}
                onClick={() => setSelectedTaskId(task.task_id)}
              >
                <AssetCardMedia
                  task={task}
                  thumb={thumb}
                  videoUrl={videoUrl}
                  isHovered={hoverVideoTaskId === task.task_id}
                  onHover={setHoverVideoTaskId}
                  onClick={() => {
                    setSelectedTaskId(task.task_id);
                    if (thumb) {
                      openImageLightbox(task.task_id, thumb);
                    } else if (videoUrl) {
                      openVideoLightbox(task.task_id, videoUrl);
                    } else if (task.status === "failed") {
                      if (task.asset_type === "image") {
                        openImageLightbox(task.task_id);
                      } else {
                        openVideoLightbox(task.task_id);
                      }
                    }
                  }}
                  t={t}
                />
                <div className="px-3 py-2.5 bg-surface flex flex-col gap-1">
                  <p className="text-xs font-medium text-gray-900 dark:text-white line-clamp-2 m-0 leading-relaxed h-11" title={task.prompt}>
                    {task.prompt || t("jobs.emptyPrompt")}
                  </p>
                  <p className="text-[10px] text-gray-400 m-0 truncate">
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








