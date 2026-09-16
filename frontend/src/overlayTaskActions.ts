import {
  cancelVideoTask,
  deleteVideoTask,
  importTaskImageAsFile,
  retryVideoTask,
} from "./api";
import type { TranslateFn } from "./i18n";
import type { AssetType, RetryMode, VideoTaskDetail } from "./types";
import { toDraft } from "./overlayTaskUtils";

export interface TaskActionPayload {
  taskId: string;
  assetType: AssetType;
  action: "cancel" | "delete";
}

export interface RetryTaskPayload {
  task: VideoTaskDetail;
  mode: RetryMode;
}

export interface ReuseTaskPayload {
  task: VideoTaskDetail;
  imageIndex: number;
  branch: boolean;
}

export async function buildReuseDraft(
  payload: ReuseTaskPayload,
  gatewayToken: string,
) {
  if (payload.task.asset_type !== "image" || payload.task.status !== "succeeded") {
    return toDraft(payload.task);
  }
  const imported = await importTaskImageAsFile(
    payload.task.task_id,
    payload.imageIndex,
    gatewayToken,
  );
  return toDraft(payload.task, {
    sourceFileId: imported.file_id,
    branch: payload.branch,
  });
}

export async function runTaskAction(
  payload: TaskActionPayload,
  gatewayToken: string,
) {
  if (payload.action === "cancel") {
    return cancelVideoTask(payload.taskId, gatewayToken, payload.assetType);
  }
  return deleteVideoTask(payload.taskId, gatewayToken, payload.assetType);
}

export async function runRetryTask(
  payload: RetryTaskPayload,
  gatewayToken: string,
) {
  return retryVideoTask(
    payload.task.task_id,
    payload.mode,
    payload.task.prompt || null,
    gatewayToken,
    payload.task.asset_type,
  );
}

export function formatTaskActionSuccessMessage(
  payload: TaskActionPayload,
  t: TranslateFn,
): string {
  const taskId = payload.taskId.slice(0, 8);
  return payload.action === "cancel"
    ? t("works.cancelSuccess", { taskId })
    : t("works.deleteSuccess", { taskId });
}

export function formatTaskActionErrorMessage(
  payload: TaskActionPayload,
  error: Error,
  t: TranslateFn,
): string {
  return payload.action === "cancel"
    ? t("works.cancelFailed", { message: error.message })
    : t("works.deleteFailed", { message: error.message });
}

export function formatRetryQueuedMessage(taskId: string, t: TranslateFn): string {
  return t("works.retryQueued", { taskId: taskId.slice(0, 8) });
}

export function formatRetryErrorMessage(error: Error, t: TranslateFn): string {
  return t("works.retryFailed", { message: error.message });
}
