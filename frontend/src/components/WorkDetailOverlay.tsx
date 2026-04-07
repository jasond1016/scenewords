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
  inferTaskOrientation,
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
  const imageLightboxItems = useMemo(() => buildLightboxItems(tasks, "image"), [tasks]);
  const videoLightboxItems = useMemo(() => buildLightboxItems(tasks, "video"), [tasks]);
  const [lightboxState, setLightboxState] = useState<{ kind: "image" | "video"; index: number } | null>(() =>
    resolveInitialLightboxState(initialTaskId, tasks, imageLightboxItems, videoLightboxItems),
  );
  const [isMediaExpanded, setIsMediaExpanded] = useState(false);
  const isLightboxOpen = lightboxState !== null;
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.task_id, task])),
    [tasks],
  );

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
  const currentLightboxOrientation = currentLightboxTask
    ? inferTaskOrientation(currentLightboxTask)
    : "landscape";
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

  useEscapeToClose(lightboxIndex != null && !isMediaExpanded, onClose);
  useEscapeToClose(isMediaExpanded, () => setIsMediaExpanded(false));

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
    supportsSeedRetry: providerSupportsSeedRetry(currentLightboxTask.provider),
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
    <>
      <MediaOverlayFrame
        title={t("works.workPreview")}
        currentIndex={lightboxIndex}
        totalItems={lightboxItems.length}
        onClose={onClose}
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
              onClose();
            }}
            onDelete={sidebarActions.onDelete}
            deleteDisabled={sidebarActions.deleteDisabled}
            cancelAction={sidebarActions.cancelAction}
            retryActions={sidebarActions.retryActions}
            onCopyRequestJson={() => {
              const payload = buildTaskRequestPayload(currentLightboxTask);
              const text = JSON.stringify(payload, null, 2);
              void copyText(text).then(
                () => onHint?.(t("works.copyJsonSuccess")),
                () => onHint?.(t("works.copyJsonFailed")),
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
                    mapErrorCode,
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
  );
}
