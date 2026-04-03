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
        return t("works.imageStatusQueuedWithPosition", { position: task.queue_position });
      }
      return t("works.imageStatusQueued");
    }
    if (task.status === "running") {
      return t("works.imageStatusRunning");
    }
    if (task.status === "succeeded") {
      return t("works.imageStatusSucceeded");
    }
  }

  if (task.asset_type === "video") {
    if (task.status === "queued") {
      if (task.queue_position != null) {
        return t("works.videoStatusQueuedWithPosition", { position: task.queue_position });
      }
      return t("works.videoStatusQueued");
    }
    if (task.status === "running") {
      return t("works.videoStatusRunning");
    }
    if (task.status === "succeeded") {
      return t("works.videoStatusSucceeded");
    }
  }

  if (task.status === "queued" && task.queue_position != null) {
    return t("works.statusQueuedWithPosition", { position: task.queue_position });
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
  supportsSeedRetry?: boolean;
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
    supportsSeedRetry = true,
    onDeleteConfirmed,
    onCancelConfirmed,
    onRetry,
  } = options;
  const shortTaskId = task.task_id.slice(0, 8);
  const isInProgress = task.status === "queued" || task.status === "running";

  const onDelete = () => {
    const confirmed = window.confirm(t("works.deleteConfirm", { taskId: shortTaskId }));
    if (!confirmed) {
      return;
    }
    onDeleteConfirmed();
  };

  const cancelAction = isInProgress
    ? {
        disabled: deleteDisabled ?? false,
        onCancel: () => {
          const confirmed = window.confirm(t("works.cancelConfirm", { taskId: shortTaskId }));
          if (!confirmed) {
            return;
          }
          onCancelConfirmed();
        },
      }
    : undefined;

  const retryActions = isInProgress
    ? undefined
    : !supportsSeedRetry
      ? {
          disabled: retryDisabled ?? false,
          defaultLabel: t("works.generateAgain"),
          onDefault: () => onRetry("same_seed"),
        }
      : showBothRetryActions
      ? {
          disabled: retryDisabled ?? false,
          sameSeedLabel: t("works.retry", { mode: t("common.retrySameSeed") }),
          newSeedLabel: t("works.retry", { mode: t("common.retryNewSeed") }),
          onSameSeed: () => onRetry("same_seed"),
          onNewSeed: () => onRetry("new_seed"),
        }
      : {
          disabled: retryDisabled ?? false,
          defaultLabel: t("works.retry", {
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

const SEEDLESS_PROVIDER_IDS = new Set(["nano_banana2", "veo31"]);

export function providerSupportsSeedRetry(providerId: string): boolean {
  return !SEEDLESS_PROVIDER_IDS.has(providerId);
}

export function deriveTaskFormatMeta(task: VideoTaskDetail): {
  ratio: string | null;
  resolution: string | null;
} {
  const fromResolution = parseResolutionMeta(task.resolution);
  const providerWidth = readNumber(task.provider_options ?? {}, "width");
  const providerHeight = readNumber(task.provider_options ?? {}, "height");

  const ratio =
    fromResolution.ratio ||
    (providerWidth != null && providerHeight != null && providerWidth > 0 && providerHeight > 0
      ? normalizeAspectRatio(providerWidth, providerHeight)
      : "");

  const resolution =
    fromResolution.size ||
    (providerWidth != null && providerHeight != null && providerWidth > 0 && providerHeight > 0
      ? summarizeResolution(providerWidth, providerHeight)
      : inferResolutionFromModel(task.model));

  return {
    ratio: ratio || null,
    resolution: resolution || null,
  };
}

function inferResolutionFromModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.includes("4k")) {
    return "4K";
  }
  if (normalized.includes("2k")) {
    return "2K";
  }
  if (normalized.includes("720p")) {
    return "720P";
  }
  if (
    normalized.startsWith("gemini-3-pro-image-preview") ||
    normalized.startsWith("gemini-3.1-flash-image-preview")
  ) {
    return "1K";
  }
  return "";
}

function parseResolutionMeta(raw: string | null): { ratio: string; size: string } {
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return { ratio: "", size: "" };
  }

  const ratioMatch = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
  if (ratioMatch) {
    return {
      ratio: `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}`,
      size: "",
    };
  }

  const resolutionMatch = normalized.match(/^(\d+)\s*[x]\s*(\d+)$/);
  if (resolutionMatch) {
    const width = Number(resolutionMatch[1]);
    const height = Number(resolutionMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return {
        ratio: normalizeAspectRatio(width, height),
        size: summarizeResolution(width, height),
      };
    }
  }

  const sizeMatch = normalized.match(/^(\d+)\s*p$/);
  if (sizeMatch) {
    return {
      ratio: "",
      size: `${Number(sizeMatch[1])}P`,
    };
  }

  return {
    ratio: raw?.trim() ?? "",
    size: raw?.trim() ?? "",
  };
}

function summarizeResolution(width: number, height: number): string {
  if (Math.max(width, height) >= 3840 || Math.min(width, height) >= 2160) {
    return "4K";
  }
  if (Math.max(width, height) >= 2560 || Math.min(width, height) >= 1440) {
    return "2K";
  }
  return `${Math.min(width, height)}P`;
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

function normalizeAspectRatio(width: number, height: number): string {
  const target = width / height;
  const candidates: Array<[string, number]> = [
    ["21:9", 21 / 9],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["1:1", 1],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
  ];
  let best = candidates[0];
  let diff = Math.abs(target - best[1]);
  for (let index = 1; index < candidates.length; index += 1) {
    const currentDiff = Math.abs(target - candidates[index][1]);
    if (currentDiff < diff) {
      diff = currentDiff;
      best = candidates[index];
    }
  }
  if (diff <= 0.12) {
    return best[0];
  }
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}
