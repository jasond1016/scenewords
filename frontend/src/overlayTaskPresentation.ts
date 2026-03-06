import type { TranslateFn } from "./i18n";
import type { RetryMode, VideoTaskDetail } from "./types";
import type { SidebarCancelAction, SidebarRetryActions } from "./components/MediaDetailSidebar";

function translateStatus(t: TranslateFn, status: string): string {
  const key = `status.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function formatOverlayTaskStatus(task: VideoTaskDetail, t: TranslateFn): string {
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

  return translateStatus(t, task.status);
}

interface BuildSidebarTaskActionsOptions {
  task: VideoTaskDetail;
  t: TranslateFn;
  deleteDisabled?: boolean;
  retryDisabled?: boolean;
  showBothRetryActions: boolean;
  retryModeDefault: RetryMode;
  onDeleteConfirmed: () => void;
  onCancelConfirmed: () => void;
  onRetry: (mode: RetryMode) => void;
}

interface MediaSidebarActions {
  onDelete: () => void;
  deleteDisabled?: boolean;
  cancelAction?: SidebarCancelAction;
  retryActions?: SidebarRetryActions;
}

export function buildMediaSidebarActions(
  options: BuildSidebarTaskActionsOptions,
): MediaSidebarActions {
  const {
    task,
    t,
    deleteDisabled,
    retryDisabled,
    showBothRetryActions,
    retryModeDefault,
    onDeleteConfirmed,
    onCancelConfirmed,
    onRetry,
  } = options;
  const shortTaskId = task.task_id.slice(0, 8);
  const isInProgress = task.status === "queued" || task.status === "running";

  const onDelete = () => {
    const confirmed = window.confirm(t("jobs.deleteConfirm", { taskId: shortTaskId }));
    if (!confirmed) {
      return;
    }
    onDeleteConfirmed();
  };

  const cancelAction = isInProgress
    ? {
        disabled: deleteDisabled ?? false,
        onCancel: () => {
          const confirmed = window.confirm(t("jobs.cancelConfirm", { taskId: shortTaskId }));
          if (!confirmed) {
            return;
          }
          onCancelConfirmed();
        },
      }
    : undefined;

  const retryActions = isInProgress
    ? undefined
    : showBothRetryActions
      ? {
          disabled: retryDisabled ?? false,
          sameSeedLabel: t("jobs.retry", { mode: t("common.retrySameSeed") }),
          newSeedLabel: t("jobs.retry", { mode: t("common.retryNewSeed") }),
          onSameSeed: () => onRetry("same_seed"),
          onNewSeed: () => onRetry("new_seed"),
        }
      : {
          disabled: retryDisabled ?? false,
          defaultLabel: t("jobs.retry", {
            mode:
              retryModeDefault === "same_seed"
                ? t("common.retrySameSeed")
                : t("common.retryNewSeed"),
          }),
          onDefault: () => onRetry(retryModeDefault),
        };

  return {
    onDelete,
    deleteDisabled,
    cancelAction,
    retryActions,
  };
}
