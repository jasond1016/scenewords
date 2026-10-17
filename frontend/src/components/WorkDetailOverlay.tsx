import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchCatalog, fetchTaskDetail } from "../api";
import { AppLightboxStage } from "./AppLightboxStage";
import { MediaOverlayEditComposer, MediaOverlayExportActions, MediaOverlayGenerationFeedback, MediaOverlayImageActions, MediaOverlayResizeComposer } from "./MediaOverlayActions";
import { MediaDetailSidebar } from "./MediaDetailSidebar";
import { MediaOverlayFrame } from "./MediaOverlayFrame";
import { useI18n } from "../i18n";
import {
  buildLightboxItems,
  resolveInitialLightboxState,
} from "../lightbox";
import {
  buildReuseDraft,
  formatRetryErrorMessage,
  formatRetryQueuedMessage,
  formatTaskActionErrorMessage,
  formatTaskActionSuccessMessage,
  type EditImagePayload,
  type HighResolutionCandidatePayload,
  type ResizeImagePayload,
  type RetryTaskPayload,
  type ReuseTaskPayload,
  type TaskActionPayload,
  runRetryTask,
  runTaskAction,
  submitHighResolutionCandidate,
  submitImageEdit,
  submitImageResize,
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
  initialItemKey?: string;
  initialAction?: "edit" | "resize";
  onClose: () => void;
  onHint?: (message: string) => void;
}

export function WorkDetailOverlay(props: Props) {
  const { tasks, initialTaskId, initialItemKey, initialAction, onClose, onHint } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const imageLightboxItems = useMemo(() => buildLightboxItems(tasks, "image"), [tasks]);
  const videoLightboxItems = useMemo(() => buildLightboxItems(tasks, "video"), [tasks]);
  const resolveInitialState = useCallback(() => {
    const initialState = resolveInitialLightboxState(
      initialTaskId,
      tasks,
      imageLightboxItems,
      videoLightboxItems,
    );
    if (!initialState || initialState.kind !== "image" || !initialItemKey) {
      return initialState;
    }
    const itemIndex = imageLightboxItems.findIndex((item) => item.key === initialItemKey);
    return itemIndex >= 0 ? { ...initialState, index: itemIndex } : initialState;
  }, [imageLightboxItems, initialItemKey, initialTaskId, tasks, videoLightboxItems]);
  const [lightboxState, setLightboxState] = useState<{ kind: "image" | "video"; index: number } | null>(
    resolveInitialState,
  );
  const isLightboxOpen = lightboxState !== null;
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.task_id, task])),
    [tasks],
  );

  useEffect(() => {
    const nextState = resolveInitialState();
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
  }, [onClose, resolveInitialState]);

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
  const versionTasks = useMemo(
    () =>
      currentLightboxTask?.generation_id
        ? tasks
            .filter((task) => task.generation_id === currentLightboxTask.generation_id)
            .sort((left, right) => (left.version_number ?? 0) - (right.version_number ?? 0))
        : [],
    [currentLightboxTask?.generation_id, tasks],
  );
  const [queuedRetryTaskId, setQueuedRetryTaskId] = useState<string | null>(null);
  const [isEditPromptOpen, setIsEditPromptOpen] = useState(false);
  const [editInstruction, setEditInstruction] = useState("");
  const [isResizeOptionsOpen, setIsResizeOptionsOpen] = useState(false);

  const catalogQuery = useQuery({
    queryKey: ["catalog", settings.gatewayToken],
    queryFn: () => fetchCatalog(settings.gatewayToken),
    staleTime: 5 * 60_000,
  });

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
    enabled: currentLightboxTask?.status === "failed",
    staleTime: 30_000,
  });
  const errorTask = taskDetailQuery.data ?? currentLightboxTask;

  useEffect(() => {
    setQueuedRetryTaskId(null);
  }, [currentLightboxTask?.task_id]);

  useEffect(() => {
    const isInitialImage = currentLightboxTask?.task_id === initialTaskId && lightboxItem?.key === initialItemKey;
    setIsEditPromptOpen(isInitialImage && initialAction === "edit");
    setEditInstruction("");
    setIsResizeOptionsOpen(isInitialImage && initialAction === "resize");
  }, [currentLightboxTask?.task_id, lightboxItem?.key, initialAction, initialItemKey, initialTaskId]);

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
    onSuccess: async (response, payload) => {
      setQueuedRetryTaskId(payload.task.task_id);
      onHint?.(payload.task.status === "succeeded" ? t("works.regenerateQueued") : formatRetryQueuedMessage(response.task_id, t));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["scene", settings.gatewayToken, response.scene_id] }),
      ]);
    },
    onError: (error: Error, payload) => {
      onHint?.(payload.task.status === "succeeded" ? t("works.regenerateFailed", { message: error.message }) : formatRetryErrorMessage(error, t));
    },
  });

  const reuseMutation = useMutation({
    mutationFn: (payload: ReuseTaskPayload) => buildReuseDraft(payload, settings.gatewayToken),
    onMutate: () => {
      settings.setPendingReuseDraft(null);
      settings.setPendingReuseError(null);
      settings.setPendingReuseLoading(true);
      navigate("/create");
      onClose();
    },
    onSuccess: (draft) => {
      settings.setPendingReuseDraft(draft);
      settings.setPendingReuseLoading(false);
    },
    onError: (error: Error) => {
      settings.setPendingReuseLoading(false);
      settings.setPendingReuseError(error.message);
    },
  });

  const editMutation = useMutation<VideoTaskResponse, Error, EditImagePayload>({
    mutationFn: (payload) => submitImageEdit(payload, settings.gatewayToken),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({
          queryKey: ["scene", settings.gatewayToken, response.scene_id],
        }),
      ]);
      navigate("/create", { state: { returnSessionId: response.scene_id } });
      onClose();
    },
    onError: (error) => {
      onHint?.(t("works.editImageFailed", { message: error.message }));
    },
  });

  const highResolutionCandidateMutation = useMutation<VideoTaskResponse, Error, HighResolutionCandidatePayload>({
    mutationFn: (payload) => submitHighResolutionCandidate(payload, settings.gatewayToken),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({
          queryKey: ["scene", settings.gatewayToken, response.scene_id],
        }),
      ]);
    },
  });

  const resizeMutation = useMutation<VideoTaskResponse, Error, ResizeImagePayload>({
    mutationFn: (payload) => submitImageResize(payload, settings.gatewayToken),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({
          queryKey: ["scene", settings.gatewayToken, response.scene_id],
        }),
      ]);
      navigate("/create", { state: { returnSessionId: response.scene_id } });
      onClose();
    },
    onError: (error) => {
      onHint?.(t("works.resizeImageFailed", { message: error.message }));
    },
  });

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
  const retryActions =
    queuedRetryTaskId === currentLightboxTask.task_id
      ? {
          disabled: true,
          defaultLabel: t("works.retryQueuedSticky"),
          onDefault: () => undefined,
        }
      : sidebarActions.retryActions;

  const reuseCurrentImage = () => {
    reuseMutation.mutate({
      task: currentLightboxTask,
      imageIndex: lightboxItem.imageIndex ?? 0,
    });
  };

  const createHighResolutionCandidate = () => {
    if (!catalogQuery.data) {
      onHint?.(t("works.editOptionsUnavailable"));
      return;
    }
    retryMutation.reset();
    highResolutionCandidateMutation.mutate({
      task: currentLightboxTask,
      imageIndex: lightboxItem.imageIndex ?? 0,
      catalog: catalogQuery.data,
    });
  };

  return (
    <>
      <MediaOverlayFrame
        onClose={onClose}
        closeLabel={t("common.close")}
        detailsLabel={t("works.details")}
        closeDetailsLabel={t("works.closeDetails")}
        mediaToggleLabel={t("works.toggleOverlayActions")}
        isImage={lightboxItem.kind === "image"}
        topActions={
          <MediaOverlayExportActions key={lightboxItem.key} task={currentLightboxTask} downloadUrl={lightboxItem.url} />
        }
        bottomActions={
          lightboxItem.kind === "image" && currentLightboxTask.status === "succeeded" ? (
            <div className="media-overlay-action-stack" data-overlay-scroll="allow">
              <MediaOverlayImageActions
                disabled={retryMutation.isPending || reuseMutation.isPending || highResolutionCandidateMutation.isPending || editMutation.isPending || resizeMutation.isPending}
                isEditPromptOpen={isEditPromptOpen}
                isResizeOptionsOpen={isResizeOptionsOpen}
                onEdit={() => {
                  setIsResizeOptionsOpen(false);
                  setIsEditPromptOpen((open) => !open);
                  setEditInstruction("");
                }}
                onAdjustSize={() => {
                  setIsEditPromptOpen(false);
                  resizeMutation.reset();
                  setIsResizeOptionsOpen((open) => !open);
                }}
                onRegenerate={() => {
                  highResolutionCandidateMutation.reset();
                  retryMutation.mutate({
                    task: currentLightboxTask,
                    mode: providerSupportsSeedRetry(currentLightboxTask.provider) ? "new_seed" : "same_seed",
                  });
                }}
                onGenerateHighResolutionCandidate={createHighResolutionCandidate}
              />
              {[{ mutation: retryMutation, kind: "regenerate" as const }, { mutation: highResolutionCandidateMutation, kind: "highResolutionCandidate" as const }].map(({ mutation, kind }) =>
                mutation.variables?.task.task_id === currentLightboxTask.task_id ? (
                  <MediaOverlayGenerationFeedback
                    key={kind}
                    kind={kind}
                    pending={mutation.isPending}
                    queued={mutation.isSuccess}
                    error={mutation.error?.message}
                    onViewTask={() => {
                      const response = mutation.data;
                      if (!response) return;
                      navigate(response.scene_id ? "/create" : `/works?taskId=${encodeURIComponent(response.task_id)}`, {
                        state: response.scene_id ? { returnSessionId: response.scene_id } : null,
                      });
                      onClose();
                    }}
                  />
                ) : null,
              )}
              {isEditPromptOpen ? (
                <MediaOverlayEditComposer
                  value={editInstruction}
                  onChange={setEditInstruction}
                  pending={editMutation.isPending}
                  onSubmit={() => {
                    if (!editInstruction.trim()) {
                      onHint?.(t("works.editPromptRequired"));
                      return;
                    }
                    if (!catalogQuery.data) {
                      onHint?.(t("works.editOptionsUnavailable"));
                      return;
                    }
                    editMutation.mutate({
                      task: currentLightboxTask,
                      imageIndex: lightboxItem.imageIndex ?? 0,
                      instruction: editInstruction,
                      catalog: catalogQuery.data,
                    });
                  }}
                />
              ) : null}
              {isResizeOptionsOpen ? (
                <MediaOverlayResizeComposer
                  key={lightboxItem.key}
                  task={currentLightboxTask}
                  catalog={catalogQuery.data}
                  loading={catalogQuery.isFetching && !catalogQuery.data}
                  catalogError={catalogQuery.isError}
                  onReload={() => void catalogQuery.refetch()}
                  pending={resizeMutation.isPending}
                  disabled={retryMutation.isPending || reuseMutation.isPending || highResolutionCandidateMutation.isPending || editMutation.isPending}
                  error={resizeMutation.variables?.task.task_id === currentLightboxTask.task_id && resizeMutation.variables.imageIndex === (lightboxItem.imageIndex ?? 0) ? resizeMutation.error?.message : null}
                  onSubmit={(option) => {
                    if (!catalogQuery.data) return;
                    resizeMutation.mutate({
                      task: currentLightboxTask,
                      imageIndex: lightboxItem.imageIndex ?? 0,
                      resolution: option.value,
                      resolutionLabel: option.label,
                      catalog: catalogQuery.data,
                    });
                  }}
                />
              ) : null}
            </div>
          ) : null
        }
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
            onClose={onClose}
          />
        }
        sidebar={
          <MediaDetailSidebar
            task={currentLightboxTask}
            catalog={catalogQuery.data}
            versionTasks={versionTasks.filter((version) => lightboxItems.some((item) => item.taskId === version.task_id))}
            onVersionSelect={(taskId) => {
              const nextIndex = lightboxItems.findIndex((item) => item.taskId === taskId);
              if (nextIndex >= 0) {
                setLightboxState((current) => current ? { ...current, index: nextIndex } : current);
              }
            }}
            statusLabel={formatOverlayTaskStatus(currentLightboxTask, t)}
            updatedAtLabel={formatTime(currentLightboxTask.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
            downloadUrl={lightboxItem.url}
            onReuse={reuseCurrentImage}
            reuseDisabled={reuseMutation.isPending}
            gatewayToken={settings.gatewayToken}
            onDelete={sidebarActions.onDelete}
            deleteDisabled={sidebarActions.deleteDisabled}
            cancelAction={sidebarActions.cancelAction}
            retryActions={currentLightboxTask.asset_type === "image" && currentLightboxTask.status === "succeeded" ? undefined : retryActions}
            errorText={
              errorTask
                ? errorMessage(errorTask, {
                    fallbackMessage: t("error.defaultFailure"),
                    providerRetryRecommendedMessage: t("error.providerRetryRecommended"),
                  })
                : null
            }
          />
        }
      />
    </>
  );
}
