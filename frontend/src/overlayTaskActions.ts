import {
  cancelVideoTask,
  deleteVideoTask,
  retryVideoTask,
} from "./api";
import type { TranslateFn } from "./i18n";
import type { AssetType, RetryMode, VideoTaskDetail } from "./types";

export interface TaskActionPayload {
  taskId: string;
  assetType: AssetType;
  action: "cancel" | "delete";
}

export interface RetryTaskPayload {
  task: VideoTaskDetail;
  mode: RetryMode;
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
    ? t("jobs.cancelSuccess", { taskId })
    : t("jobs.deleteSuccess", { taskId });
}

export function formatTaskActionErrorMessage(
  payload: TaskActionPayload,
  error: Error,
  t: TranslateFn,
): string {
  return payload.action === "cancel"
    ? t("jobs.cancelFailed", { message: error.message })
    : t("jobs.deleteFailed", { message: error.message });
}

export function formatRetryQueuedMessage(taskId: string, t: TranslateFn): string {
  return t("jobs.retryQueued", { taskId: taskId.slice(0, 8) });
}

export function formatRetryErrorMessage(error: Error, t: TranslateFn): string {
  return t("jobs.retryFailed", { message: error.message });
}
