import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { deleteVideoTask, retryVideoTask } from "../api";
import { useI18n, type TranslateFn } from "../i18n";
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

const WORKS_FAVORITES_KEY = "scenewords_works_favorites_v1";

type BrowseFilter = "all" | "image" | "video" | "favorite";
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
  const location = useLocation();
  const navigate = useNavigate();
  const handledTaskDeepLinkRef = useRef<string>("");

  const [browseFilter, setBrowseFilter] = useState<BrowseFilter>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [hoverVideoTaskId, setHoverVideoTaskId] = useState<string | null>(null);
  const [favoriteTaskIds, setFavoriteTaskIds] = useState<string[]>(() => readFavoriteTaskIds());
  const [lightboxState, setLightboxState] = useState<{ kind: LightboxKind; index: number } | null>(null);
  const [isInfoHidden, setIsInfoHidden] = useState(false);

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
    ? tasks.find((task) => task.task_id === lightboxItem.taskId) ?? null
    : null;
  const currentLightboxIsPortrait = currentLightboxTask ? inferTaskPortrait(currentLightboxTask) : false;
  const isLightboxOpen = lightboxState !== null;

  useEffect(() => {
    if (!isLightboxOpen) {
      setIsInfoHidden(false);
      return;
    }
    const prefersCompactInfo =
      typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
    setIsInfoHidden(prefersCompactInfo);
  }, [isLightboxOpen]);

  useEffect(() => {
    if (!isLightboxOpen) {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscrollBehavior = body.style.overscrollBehavior;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      root.style.overflow = prevRootOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscrollBehavior;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isLightboxOpen]);

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

  const setLightboxByOffset = (offset: -1 | 1) => {
    if (!lightboxItems.length || lightboxIndex == null) {
      return;
    }
    const nextIndex =
      (lightboxIndex + offset + lightboxItems.length) %
      lightboxItems.length;
    setLightboxState((current) => (current ? { ...current, index: nextIndex } : null));
  };

  useEffect(() => {
    if (lightboxIndex == null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxState(null);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setLightboxByOffset(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setLightboxByOffset(1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, lightboxItems.length]);

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

  const retryMutation = useMutation({
    mutationFn: async (payload: {
      task: VideoTaskDetail;
      mode: RetryMode;
    }) =>
      retryVideoTask(
        payload.task.task_id,
        payload.mode,
        payload.task.prompt || null,
        settings.gatewayToken,
        payload.task.asset_type,
      ),
    onSuccess: async (response) => {
      setHint(t("jobs.retryQueued", { taskId: response.task_id.slice(0, 8) }));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(t("jobs.retryFailed", { message: error.message }));
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

  const worksCount = completedTasks.length;
  const imageCount = completedTasks.filter((task) => task.asset_type === "image").length;
  const videoCount = completedTasks.filter((task) => task.asset_type === "video").length;
  const favoriteCount = completedTasks.filter((task) => favoriteTaskIds.includes(task.task_id)).length;
  const toggleFavorite = (taskId: string) => {
    setFavoriteTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [taskId, ...current],
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-[#6B665E]">
        {t("jobs.loading")}
      </div>
    );
  }

  const filterPills: Array<{ value: BrowseFilter; label: string; count: number }> = [
    { value: "all", label: t("jobs.kindAll"), count: worksCount },
    { value: "image", label: t("jobs.kindImage"), count: imageCount },
    { value: "video", label: t("jobs.kindVideo"), count: videoCount },
    { value: "favorite", label: locale === "zh-CN" ? "收藏" : "Favorite", count: favoriteCount },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1366px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-[#DDD6C8] bg-[#FBF8F2] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-bold tracking-tight text-[#1C1917] sm:text-[28px]">
              Works · Gallery
            </h1>
            <p className="mb-0 mt-2 text-xs font-medium text-[#78716C]">
              {locale === "zh-CN"
                ? "瀑布流浏览作品，点击卡片进入全屏详情。"
                : "Browse works in waterfall view and open full-screen details."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#ECE7DC] px-3 py-1 text-xs font-semibold text-[#57534E]">
              {locale === "zh-CN" ? `全部 ${worksCount}` : `All ${worksCount}`}
            </span>
            <span className="rounded-full border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-1 text-xs font-semibold text-[#57534E]">
              {locale === "zh-CN" ? `图片 ${imageCount}` : `Images ${imageCount}`}
            </span>
            <span className="rounded-full border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-1 text-xs font-semibold text-[#57534E]">
              {locale === "zh-CN" ? `视频 ${videoCount}` : `Videos ${videoCount}`}
            </span>
            <span className="rounded-full border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-1 text-xs font-semibold text-[#57534E]">
              {locale === "zh-CN" ? `进行中 ${inProgressTasks.length}` : `In Progress ${inProgressTasks.length}`}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#DDD6C8] bg-[#FBF8F2] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-xl border border-[#E5DED0] bg-[#F6F3EC] p-1">
            {filterPills.map((pill) => {
              const isActive = browseFilter === pill.value;
              return (
                <button
                  type="button"
                  key={pill.value}
                  onClick={() => setBrowseFilter(pill.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive ? "bg-[#E8692A] text-white" : "text-[#6F675C] hover:bg-[#EEE7DA]"
                  }`}
                >
                  {pill.label} {pill.count}
                </button>
              );
            })}
          </div>
          {!!inProgressTasks.length && (
            <div className="rounded-full border border-[#E0DACD] bg-white px-3 py-1 text-[11px] text-[#81776B]">
              {locale === "zh-CN"
                ? `进行中：图片 ${inProgressBreakdown.imageCount} / 视频 ${inProgressBreakdown.videoCount}`
                : `In progress: image ${inProgressBreakdown.imageCount} / video ${inProgressBreakdown.videoCount}`}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl border border-[#E6E0D5] bg-[#F3EFE8] p-2.5 sm:p-3">
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

      {hint ? <p className="m-0 text-xs text-[#736B5E]">{hint}</p> : null}

      {lightboxItem && currentLightboxTask ? (
        <div
          className="fixed inset-0 z-50 bg-[#241F1A]/40 p-1.5 backdrop-blur-[2px] sm:p-3"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxState(null)}
        >
          <div
            className="relative flex h-full w-full overflow-hidden rounded-2xl border border-[#DCD4C7] bg-[#F7F4EE] sm:flex-row"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-[#E0D9CD] px-3 py-2 sm:px-4">
                <strong className="text-sm text-[#2C241E]">
                  {locale === "zh-CN" ? "作品预览" : "Work Preview"}
                </strong>
                <div className="flex items-center gap-2">
                  {lightboxItems.length > 1 ? (
                    <span className="rounded-full bg-[#EFE8DB] px-2 py-1 text-[11px] font-semibold text-[#7A6F62]">
                      {(lightboxIndex ?? 0) + 1} / {lightboxItems.length}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-full border border-[#D7CFBF] bg-white px-3 py-1 text-xs font-semibold text-[#5D5349] transition-colors hover:bg-[#F8F4EC]"
                    onClick={() => setIsInfoHidden((current) => !current)}
                  >
                    {isInfoHidden ? (locale === "zh-CN" ? "显示信息" : "Show Info") : (locale === "zh-CN" ? "隐藏信息" : "Hide Info")}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-[#E8692A] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#D95E22]"
                    onClick={() => setLightboxState(null)}
                  >
                    {locale === "zh-CN" ? "返回浏览" : "Back"}
                  </button>
                </div>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center p-1.5 sm:p-4">
                {lightboxItems.length > 1 ? (
                  <button
                    type="button"
                    className="absolute left-1.5 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#D6CEBF] bg-white/90 text-xl text-[#5D5349] transition-colors hover:bg-white sm:left-3 sm:h-10 sm:w-10"
                    onClick={() => setLightboxByOffset(-1)}
                    aria-label={t("jobs.lightboxPrev")}
                  >
                    ‹
                  </button>
                ) : null}

                <div className="flex h-full w-full items-center justify-center rounded-xl border border-[#E4DDD0] bg-[#EFEAE2] px-2 py-2 sm:px-4 sm:py-4">
                  {renderLightboxMediaItem({
                    item: lightboxItem,
                    isActive: true,
                    isPortraitMode: currentLightboxIsPortrait,
                    t,
                  })}
                </div>

                {lightboxItems.length > 1 ? (
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#D6CEBF] bg-white/90 text-xl text-[#5D5349] transition-colors hover:bg-white sm:right-3 sm:h-10 sm:w-10"
                    onClick={() => setLightboxByOffset(1)}
                    aria-label={t("jobs.lightboxNext")}
                  >
                    ›
                  </button>
                ) : null}
              </div>

              <p className="m-0 hidden border-t border-[#E0D9CD] px-4 py-2 text-[11px] text-[#8A7E71] sm:block">
                {currentLightboxIsPortrait
                  ? locale === "zh-CN"
                    ? "纵向作品：保持原始纵向比例展示。"
                    : "Portrait asset: keeps vertical composition."
                  : locale === "zh-CN"
                    ? "横向作品：优先铺宽展示。"
                    : "Landscape asset: rendered with wide priority."}
              </p>
            </div>

            {!isInfoHidden ? (
              <aside className="absolute inset-x-2 bottom-2 top-[62px] z-30 overflow-hidden rounded-xl border border-[#E0D9CD] bg-[#FAF8F3]/95 p-3 shadow-[0_16px_40px_rgba(36,31,26,0.2)] backdrop-blur-[1.5px] sm:static sm:inset-auto sm:w-[360px] sm:shrink-0 sm:rounded-none sm:border-l sm:border-t-0 sm:bg-[#FAF8F3] sm:p-3 sm:shadow-none sm:backdrop-blur-none">
                <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1 sm:pr-0">
                  <div className="rounded-xl border border-[#E2DBC9] bg-white p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="m-0 text-sm font-semibold text-[#2C241E]">{t("jobs.assetDetailTitle")}</h3>
                        <p className="m-0 mt-1 truncate font-mono text-[11px] text-[#7C7266]">
                          {currentLightboxTask.task_id}
                        </p>
                      </div>
                      <span className="rounded-full bg-[#EEE8DB] px-2 py-1 text-[10px] font-semibold text-[#6B6257]">
                        {formatLocalizedStatus(currentLightboxTask)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-[#6D6459]">
                      <InfoCell label={t("jobs.provider")} value={currentLightboxTask.provider} />
                      <InfoCell label={t("jobs.model")} value={currentLightboxTask.model} />
                      <InfoCell label={t("jobs.resolution")} value={currentLightboxTask.resolution ?? t("common.na")} />
                      <InfoCell
                        label={t("jobs.created")}
                        value={formatTime(currentLightboxTask.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                      />
                    </div>
                  </div>

                  <div className="min-h-0 rounded-xl border border-[#E2DBC9] bg-white p-3">
                    <p className="m-0 mb-1 text-[11px] font-semibold text-[#675E52]">Prompt</p>
                    <p className="m-0 whitespace-pre-wrap text-xs leading-relaxed text-[#302822]">
                      {currentLightboxTask.prompt || t("jobs.emptyPrompt")}
                    </p>
                    {currentLightboxTask.negative_prompt ? (
                      <div className="mt-2 border-t border-[#F0EBE2] pt-2">
                        <p className="m-0 mb-1 text-[11px] font-semibold text-[#776E62]">
                          {locale === "zh-CN" ? "负向提示词" : "Negative Prompt"}
                        </p>
                        <p className="m-0 text-[11px] leading-relaxed text-[#6A6054]">
                          {currentLightboxTask.negative_prompt}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-[#E2DBC9] bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {favoriteTaskIds.includes(currentLightboxTask.task_id) ? (
                        <span className="rounded-full bg-[#FFF1E8] px-2 py-1 text-[10px] font-semibold text-[#A25329]">
                          {locale === "zh-CN" ? "已收藏" : "Favorited"}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-[#ECE9FF] px-2 py-1 text-[10px] font-semibold text-[#4B43A0]">
                        {currentLightboxTask.asset_type === "image" ? t("jobs.kindImage") : t("jobs.kindVideo")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-[#E8692A] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D95E22]"
                        onClick={() => {
                          settings.setPendingReuseDraft(toDraft(currentLightboxTask));
                          navigate("/create");
                        }}
                      >
                        {t("jobs.reusePrompt")}
                      </button>
                      {lightboxItem.url ? (
                        <a
                          href={lightboxItem.url}
                          download
                          className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
                          title={t("jobs.download")}
                        >
                          {t("jobs.download")}
                        </a>
                      ) : null}
                      {currentLightboxTask.status !== "queued" && currentLightboxTask.status !== "running" ? (
                        settings.showBothRetryActions ? (
                          <>
                            <button
                              type="button"
                              className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
                              onClick={() =>
                                retryMutation.mutate({
                                  task: currentLightboxTask,
                                  mode: "same_seed",
                                })
                              }
                              disabled={retryMutation.isPending}
                            >
                              {t("jobs.retry", { mode: t("common.retrySameSeed") })}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
                              onClick={() =>
                                retryMutation.mutate({
                                  task: currentLightboxTask,
                                  mode: "new_seed",
                                })
                              }
                              disabled={retryMutation.isPending}
                            >
                              {t("jobs.retry", { mode: t("common.retryNewSeed") })}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
                            onClick={() =>
                              retryMutation.mutate({
                                task: currentLightboxTask,
                                mode: settings.retryModeDefault,
                              })
                            }
                            disabled={retryMutation.isPending}
                          >
                            {t(
                              "jobs.retry",
                              {
                                mode:
                                  settings.retryModeDefault === "same_seed"
                                    ? t("common.retrySameSeed")
                                    : t("common.retryNewSeed"),
                              },
                            )}
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        className="rounded-lg border border-[#D8D0C0] bg-white px-3 py-2 text-xs font-semibold text-[#5F564B] transition-colors hover:bg-[#F8F3EA]"
                        onClick={() => toggleFavorite(currentLightboxTask.task_id)}
                      >
                        {favoriteTaskIds.includes(currentLightboxTask.task_id)
                          ? locale === "zh-CN" ? "取消收藏" : "Unfavorite"
                          : locale === "zh-CN" ? "加入收藏" : "Favorite"}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[#E4C9BD] bg-[#FFF8F5] px-3 py-2 text-xs font-semibold text-[#A64633] transition-colors hover:bg-[#FDEDE6]"
                        onClick={() => {
                          const confirmed = window.confirm(
                            t("jobs.deleteConfirm", { taskId: currentLightboxTask.task_id.slice(0, 8) }),
                          );
                          if (!confirmed) {
                            return;
                          }
                          deleteMutation.mutate({
                            taskId: currentLightboxTask.task_id,
                            assetType: currentLightboxTask.asset_type,
                            action: "delete",
                          });
                          setLightboxState(null);
                        }}
                        disabled={deleteMutation.isPending}
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
                        onClick={() => {
                          const payload = buildTaskRequestPayload(currentLightboxTask);
                          const text = JSON.stringify(payload, null, 2);
                          void copyText(text).then(
                            () => setHint(t("jobs.copyJsonSuccess")),
                            () => setHint(t("jobs.copyJsonFailed")),
                          );
                        }}
                      >
                        {t("jobs.copyRequestJson")}
                      </button>
                      <details>
                        <summary className="cursor-pointer text-xs text-[#5B5146]">
                          {t("jobs.rawResult")}
                        </summary>
                        <pre className="mt-2 max-h-44 overflow-auto rounded-lg border border-[#EEE6D8] bg-[#F8F4EC] p-2 text-[10px] text-[#5E5449]">
                          {formatRawDebugPayload(currentLightboxTask)}
                        </pre>
                      </details>
                    </div>
                  </details>

                  {errorMessage(currentLightboxTask, {
                    mapErrorCode,
                    fallbackMessage: t("error.defaultFailure"),
                  }) ? (
                    <p className="m-0 rounded-lg border border-[#F1D7CF] bg-[#FFF1ED] px-2.5 py-2 text-xs text-[#A04431]">
                      {errorMessage(currentLightboxTask, {
                        mapErrorCode,
                        fallbackMessage: t("error.defaultFailure"),
                      })}
                    </p>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderLightboxMediaItem({
  item,
  isActive,
  isPortraitMode,
  t,
}: {
  item: LightboxMediaItem;
  isActive: boolean;
  isPortraitMode: boolean;
  t: TranslateFn;
}) {
  const mediaClass = isPortraitMode
    ? "max-h-full max-w-[min(92vw,460px)] object-contain rounded-lg border border-[#DDD6C8] bg-[#EDE8DF] shadow-[0_16px_40px_rgba(56,48,40,0.14)] sm:max-w-[min(72vw,620px)]"
    : "max-h-full max-w-full object-contain rounded-lg border border-[#DDD6C8] bg-[#EDE8DF] shadow-[0_16px_40px_rgba(56,48,40,0.14)]";

  if (item.kind === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[#7F7364]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="52"
          height="52"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
        <p className="m-0 text-sm font-semibold">{t("jobs.generationFailed")}</p>
      </div>
    );
  }
  if (item.kind === "video") {
    return (
      <video
        className={mediaClass}
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
  return <img className={mediaClass} src={item.url} alt={item.taskId} />;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-[10px] uppercase tracking-wide text-[#8B8174]">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[11px] font-semibold text-[#4A4035]">{value}</p>
    </div>
  );
}

function buildLightboxItems(tasks: VideoTaskDetail[], kind: "image" | "video"): LightboxMediaItem[] {
  const items: LightboxMediaItem[] = [];
  for (const task of tasks) {
    if (kind === "image") {
      if (task.asset_type !== "image") {
        continue;
      }
      if (task.status === "failed") {
        items.push({ key: `${task.task_id}_failed`, taskId: task.task_id, url: "", kind: "failed" });
        continue;
      }
      const urls = extractImageUrls(task);
      urls.forEach((url, index) => {
        items.push({ key: `${task.task_id}_img_${index}_${url}`, taskId: task.task_id, url, kind: "image" });
      });
      continue;
    }
    if (task.asset_type !== "video") {
      continue;
    }
    if (task.status === "failed") {
      items.push({ key: `${task.task_id}_failed`, taskId: task.task_id, url: "", kind: "failed" });
      continue;
    }
    const url = extractVideoUrl(task);
    if (!url) {
      continue;
    }
    items.push({ key: `${task.task_id}_video_${url}`, taskId: task.task_id, url, kind: "video" });
  }
  return items;
}

function extractVideoPoster(task: VideoTaskDetail): string | null {
  const result = task.result;
  if (!result || typeof result !== "object") {
    return null;
  }
  const candidates = [
    "local_thumbnail_url",
    "thumbnail_url",
    "local_poster_url",
    "poster_url",
    "cover_url",
    "preview_image_url",
    "first_frame_url",
  ];
  for (const key of candidates) {
    const value = (result as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readFavoriteTaskIds(): string[] {
  const raw = localStorage.getItem(WORKS_FAVORITES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function inferTaskPortrait(task: VideoTaskDetail): boolean {
  const ratio = parseResolutionRatio(task.resolution);
  if (ratio != null) {
    return ratio < 1;
  }
  const providerWidth = readNumber(task.provider_options, "width");
  const providerHeight = readNumber(task.provider_options, "height");
  if (providerWidth != null && providerHeight != null && providerWidth > 0) {
    return providerHeight / providerWidth > 1;
  }
  const providerRatio = readAspectRatio(task.provider_options, "aspect_ratio");
  if (providerRatio != null) {
    return providerRatio < 1;
  }
  return false;
}

function parseResolutionRatio(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("portrait") || normalized.includes("vertical")) {
    return 9 / 16;
  }
  if (normalized.includes("landscape") || normalized.includes("horizontal")) {
    return 16 / 9;
  }
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return width / height;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function readAspectRatio(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const ratio = parseResolutionRatio(value);
  return ratio != null && ratio > 0 ? ratio : null;
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
  videoPoster,
  locale,
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
  locale: string;
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
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-[#DDD6C8] ${
          isFailed ? "bg-[#F7EDE9] text-[#AA4B37]" : "bg-[#ECE8DE] text-[#7E7468]"
        }`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
          {isFailed ? (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" x2="12" y1="9" y2="13" />
                <line x1="12" x2="12.01" y1="17" y2="17" />
              </svg>
              <span className="font-semibold">{t("jobs.generationFailed")}</span>
            </>
          ) : (
            <span className="font-semibold">
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
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-[#DDD6C8] bg-[#E8E1D6]`}
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
          preload="metadata"
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
            <span className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-1 text-[10px] font-semibold text-[#6A5E4F]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
          {locale === "zh-CN" ? "视频加载中…" : "Loading video..."}
            </span>
          </div>
        </div>
        <span className="absolute bottom-2 left-2 rounded bg-[#1F1A16]/65 px-2 py-0.5 text-[10px] font-semibold text-white">
          {t("jobs.previewVideo")}
        </span>
      </button>
    );
  }

  if (thumb) {
    return (
      <button
        type="button"
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-[#DDD6C8] bg-[#ECE8DE]`}
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
      className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-lg border border-[#DDD6C8] bg-black`}
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
        preload="metadata"
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
    return (
      <div className="flex w-full items-center justify-center py-16 text-sm text-[#756C60]">
        {t("jobs.assetEmpty")}
      </div>
    );
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
                className={`relative overflow-hidden rounded-xl border bg-[#FCFAF6] p-2 transition-[box-shadow,border-color] ${
                  task.task_id === selectedTaskId
                    ? "border-[#E8692A] shadow-[0_8px_22px_rgba(174,110,67,0.18)]"
                    : "border-[#E2DBC9] hover:border-[#D9CFBD] hover:shadow-[0_8px_18px_rgba(80,69,54,0.08)]"
                }`}
                onClick={() => setSelectedTaskId(task.task_id)}
              >
                <button
                  type="button"
                  className={`absolute right-3 top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-colors ${
                    isFavorite
                      ? "border-[#E8A878] bg-[#FFF2E7] text-[#A55A2E]"
                      : "border-[#DFD7C9] bg-white/90 text-[#9B907F] hover:border-[#D7B08D] hover:text-[#A65A2C]"
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(task.task_id);
                  }}
                  title={isFavorite ? (locale === "zh-CN" ? "取消收藏" : "Unfavorite") : (locale === "zh-CN" ? "收藏" : "Favorite")}
                >
                  ★
                </button>

                <AssetCardMedia
                  task={task}
                  thumb={thumb}
                  videoUrl={videoUrl}
                  videoPoster={videoPoster}
                  locale={locale}
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
                  <p className="m-0 line-clamp-2 text-xs font-semibold leading-relaxed text-[#2F271F]">
                    {task.prompt || t("jobs.emptyPrompt")}
                  </p>
                  <p className="m-0 truncate text-[10px] text-[#7C7266]">
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
