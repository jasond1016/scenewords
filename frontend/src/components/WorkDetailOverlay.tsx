import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchTaskDetail } from "../api";
import { AppLightboxStage } from "./AppLightboxStage";
import { MediaDetailSidebar } from "./MediaDetailSidebar";
import { MediaOverlayFrame } from "./MediaOverlayFrame";
import { useI18n } from "../i18n";
import {
  buildLightboxItems,
  inferTaskPortrait,
  resolveInitialLightboxState,
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
  formatTime,
} from "../utils";

const WORKS_FAVORITES_KEY = "scenewords_works_favorites_v1";

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
  const [favoriteTaskIds, setFavoriteTaskIds] = useState<string[]>(() =>
    readFavoriteTaskIds(WORKS_FAVORITES_KEY),
  );
  const imageLightboxItems = useMemo(() => buildLightboxItems(tasks, "image"), [tasks]);
  const videoLightboxItems = useMemo(() => buildLightboxItems(tasks, "video"), [tasks]);
  const [lightboxState, setLightboxState] = useState<{ kind: "image" | "video"; index: number } | null>(() =>
    resolveInitialLightboxState(initialTaskId, tasks, imageLightboxItems, videoLightboxItems),
  );
  const isLightboxOpen = lightboxState !== null;
  const { isInfoHidden, setIsInfoHidden } = useCompactOverlayInfo(isLightboxOpen);
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.task_id, task])),
    [tasks],
  );

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
      onClose();
      return;
    }
    if (lightboxIndex != null && lightboxIndex >= lightboxItems.length) {
      setLightboxState((current) =>
        current ? { ...current, index: lightboxItems.length - 1 } : null,
      );
    }
  }, [lightboxIndex, lightboxItems, onClose]);

  useEscapeToClose(lightboxIndex != null, onClose);

  const deleteMutation = useMutation<unknown, Error, TaskActionPayload>({
    mutationFn: (payload) => runTaskAction(payload, settings.gatewayToken),
    onSuccess: async (_data, payload) => {
      onHint?.(formatTaskActionSuccessMessage(payload, t));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error, payload) => {
      onHint?.(formatTaskActionErrorMessage(payload, error, t));
    },
  });

  const retryMutation = useMutation<VideoTaskResponse, Error, RetryTaskPayload>({
    mutationFn: (payload) => runRetryTask(payload, settings.gatewayToken),
    onSuccess: async (response) => {
      onHint?.(formatRetryQueuedMessage(response.task_id, t));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      onHint?.(formatRetryErrorMessage(error, t));
    },
  });

  const mapErrorCode = (code: string): string | null => {
    const key = `error.${code}`;
    const translated = t(key);
    return translated === key ? null : translated;
  };

  const toggleFavorite = (taskId: string) => {
    setFavoriteTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [taskId, ...current],
    );
  };

  if (!lightboxItem || !currentLightboxTask) {
    return null;
  }

  const sidebarActions = buildMediaSidebarActions({
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
      onClose();
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
  });

  return (
    <MediaOverlayFrame
      title={locale === "zh-CN" ? "作品预览" : "Work Preview"}
      currentIndex={lightboxIndex}
      totalItems={lightboxItems.length}
      isInfoHidden={isInfoHidden}
      onToggleInfo={() => setIsInfoHidden((current) => !current)}
      onClose={onClose}
      showInfoLabel={locale === "zh-CN" ? "显示信息" : "Show Info"}
      hideInfoLabel={locale === "zh-CN" ? "隐藏信息" : "Hide Info"}
      backLabel={locale === "zh-CN" ? "返回浏览" : "Back"}
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
          ? locale === "zh-CN"
            ? "纵向作品：保持原始纵向比例展示。"
            : "Portrait asset: keeps vertical composition."
          : locale === "zh-CN"
            ? "横向作品：优先铺宽展示。"
            : "Landscape asset: rendered with wide priority."
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
            onClose();
          }}
          onToggleFavorite={() => toggleFavorite(currentLightboxTask.task_id)}
          onDelete={sidebarActions.onDelete}
          deleteDisabled={sidebarActions.deleteDisabled}
          cancelAction={sidebarActions.cancelAction}
          retryActions={sidebarActions.retryActions}
          onCopyRequestJson={() => {
            const payload = buildTaskRequestPayload(currentLightboxTask);
            const text = JSON.stringify(payload, null, 2);
            void copyText(text).then(
              () => onHint?.(t("jobs.copyJsonSuccess")),
              () => onHint?.(t("jobs.copyJsonFailed")),
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
  );
}
