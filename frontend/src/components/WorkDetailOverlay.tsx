import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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

const WORKS_FAVORITES_KEY = "scenewords_works_favorites_v1";

type LightboxKind = "image" | "video" | "failed";

interface LightboxMediaItem {
  key: string;
  taskId: string;
  url: string;
  kind: LightboxKind;
}

interface Props {
  tasks: VideoTaskDetail[];
  initialTaskId: string;
  onClose: () => void;
  onHint?: (message: string) => void;
}

export function WorkDetailOverlay(props: Props) {
  const { tasks, initialTaskId, onClose, onHint } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [favoriteTaskIds, setFavoriteTaskIds] = useState<string[]>(() => readFavoriteTaskIds());
  const imageLightboxItems = useMemo(() => buildLightboxItems(tasks, "image"), [tasks]);
  const videoLightboxItems = useMemo(() => buildLightboxItems(tasks, "video"), [tasks]);
  const [lightboxState, setLightboxState] = useState<{ kind: "image" | "video"; index: number } | null>(() =>
    resolveInitialLightboxState(initialTaskId, tasks, imageLightboxItems, videoLightboxItems),
  );
  const [isInfoHidden, setIsInfoHidden] = useState(false);

  useEffect(() => {
    localStorage.setItem(WORKS_FAVORITES_KEY, JSON.stringify(favoriteTaskIds));
  }, [favoriteTaskIds]);

  useEffect(() => {
    const nextState = resolveInitialLightboxState(
      initialTaskId,
      tasks,
      imageLightboxItems,
      videoLightboxItems,
    );
    if (!nextState) {
      onClose();
      return;
    }
    setLightboxState((current) => {
      if (current && current.kind === nextState.kind && current.index === nextState.index) {
        return current;
      }
      return nextState;
    });
  }, [imageLightboxItems, initialTaskId, tasks, videoLightboxItems]);

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
      onClose();
      return;
    }
    if (lightboxIndex != null && lightboxIndex >= lightboxItems.length) {
      setLightboxState((current) =>
        current ? { ...current, index: lightboxItems.length - 1 } : null,
      );
    }
  }, [lightboxIndex, lightboxItems, onClose]);

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
        onClose();
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
  }, [lightboxIndex, lightboxItems.length, onClose]);

  const deleteMutation = useMutation({
    mutationFn: async (payload: {
      taskId: string;
      assetType: AssetType;
      action: "cancel" | "delete";
    }) =>
      deleteVideoTask(payload.taskId, settings.gatewayToken, payload.assetType),
    onSuccess: async (_data, payload) => {
      onHint?.(
        payload.action === "cancel"
          ? t("jobs.cancelSuccess", { taskId: payload.taskId.slice(0, 8) })
          : t("jobs.deleteSuccess", { taskId: payload.taskId.slice(0, 8) }),
      );
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error, payload) => {
      onHint?.(
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
      onHint?.(t("jobs.retryQueued", { taskId: response.task_id.slice(0, 8) }));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      onHint?.(t("jobs.retryFailed", { message: error.message }));
    },
  });

  const mapErrorCode = (code: string): string | null => {
    const key = `error.${code}`;
    const translated = t(key);
    return translated === key ? null : translated;
  };

  const formatLocalizedStatus = (task: VideoTaskDetail): string => {
    if (task.asset_type === "image") {
      if (task.status === "queued") {
        if (task.queue_position != null) {
          return t("jobs.imageQueuedWithPosition", { position: task.queue_position });
        }
        return t("jobs.imageQueued");
      }
      if (task.status === "running") {
        return t("jobs.imageRunning");
      }
      if (task.status === "succeeded") {
        return t("jobs.imageSucceeded");
      }
      if (task.status === "failed") {
        return t("jobs.imageFailed");
      }
      return task.status;
    }

    if (task.status === "queued") {
      if (task.queue_position != null) {
        return t("jobs.queuedWithPosition", { position: task.queue_position });
      }
      return t("status.queued");
    }
    const key = `status.${task.status}`;
    const translated = t(key);
    return translated === key ? task.status : translated;
  };

  const toggleFavorite = (taskId: string) => {
    setFavoriteTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [taskId, ...current],
    );
  };

  if (!lightboxItem || !currentLightboxTask) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[#241F1A]/40 p-1.5 backdrop-blur-[2px] sm:p-3"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
                onClick={onClose}
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
                      onClose();
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
                      onClose();
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
                        () => onHint?.(t("jobs.copyJsonSuccess")),
                        () => onHint?.(t("jobs.copyJsonFailed")),
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
  );
}

function resolveInitialLightboxState(
  taskId: string,
  tasks: VideoTaskDetail[],
  imageItems: LightboxMediaItem[],
  videoItems: LightboxMediaItem[],
): { kind: "image" | "video"; index: number } | null {
  const targetTask = tasks.find((task) => task.task_id === taskId);
  if (!targetTask) {
    return null;
  }
  if (targetTask.asset_type === "video") {
    const index = videoItems.findIndex((item) => item.taskId === taskId);
    return index >= 0 ? { kind: "video", index } : null;
  }
  const index = imageItems.findIndex((item) => item.taskId === taskId);
  return index >= 0 ? { kind: "image", index } : null;
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
