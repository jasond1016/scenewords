import {
  cancelVideoTask,
  createImageTask,
  createScene,
  deleteVideoTask,
  importTaskImageAsFile,
  retryVideoTask,
} from "./api";
import type { TranslateFn } from "./i18n";
import type {
  AssetType,
  ProviderCatalogResponse,
  ProviderModelOperationInfo,
  RetryMode,
  VideoTaskDetail,
  VideoTaskResponse,
} from "./types";
import { buildVersionEditPrompt, toDraft } from "./overlayTaskUtils";

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

export interface EditImagePayload {
  task: VideoTaskDetail;
  imageIndex: number;
  instruction: string;
  catalog: ProviderCatalogResponse;
}

export interface ResizeImagePayload {
  task: VideoTaskDetail;
  imageIndex: number;
  resolution: string;
  resolutionLabel: string;
  catalog: ProviderCatalogResponse;
}

export async function submitImageEdit(
  payload: EditImagePayload,
  gatewayToken: string,
): Promise<VideoTaskResponse> {
  const instruction = payload.instruction.trim();
  if (!instruction) {
    throw new Error("Please describe what to change.");
  }
  if (payload.task.asset_type !== "image" || payload.task.status !== "succeeded") {
    throw new Error("Only completed images can be edited.");
  }

  const operation = resolveImageReferenceOperation(payload.task, payload.catalog);
  return submitImageTaskFromReference(
    payload.task,
    payload.imageIndex,
    buildVersionEditPrompt(payload.task.prompt, instruction),
    payload.task.resolution,
    operation,
    gatewayToken,
  );
}

export async function submitImageResize(
  payload: ResizeImagePayload,
  gatewayToken: string,
): Promise<VideoTaskResponse> {
  const operation = resolveImageReferenceOperation(payload.task, payload.catalog);
  const prompt = buildVersionResizePrompt(
    payload.task.prompt,
    payload.resolutionLabel,
  );
  return submitImageTaskFromReference(
    payload.task,
    payload.imageIndex,
    prompt,
    payload.resolution,
    operation,
    gatewayToken,
  );
}

export function getImageResizeOptions(
  task: VideoTaskDetail,
  catalog: ProviderCatalogResponse,
) {
  const operation = resolveImageReferenceOperation(task, catalog);
  return operation.fields.find((field) => field.key === "resolution")?.options ?? [];
}

function resolveImageReferenceOperation(
  task: VideoTaskDetail,
  catalog: ProviderCatalogResponse,
): ProviderModelOperationInfo {
  const model = catalog.providers
    .find((provider) => provider.id === task.provider)
    ?.models.find((candidate) => candidate.name === task.model);
  const supportsImageReference = (operation: ProviderModelOperationInfo) =>
    operation.fields.some(
      (field) =>
        field.target === "provider_options" &&
        field.input_type === "file_list" &&
        (field.key === "image_file_ids" || field.key === "input_reference_file_ids"),
    );
  const operation =
    model?.operations.find((candidate) => candidate.id === "edit" && supportsImageReference(candidate)) ??
    model?.operations.find((candidate) => candidate.id === task.operation && supportsImageReference(candidate)) ??
    model?.operations.find((candidate) => candidate.id === "generate" && supportsImageReference(candidate));
  if (!operation) {
    throw new Error("This model does not support editing with an image reference.");
  }
  return operation;
}

async function submitImageTaskFromReference(
  task: VideoTaskDetail,
  imageIndex: number,
  prompt: string,
  resolution: string | null,
  operation: ProviderModelOperationInfo,
  gatewayToken: string,
): Promise<VideoTaskResponse> {
  const referenceField = operation.fields.find(
    (field) =>
      field.target === "provider_options" &&
      field.input_type === "file_list" &&
      (field.key === "image_file_ids" || field.key === "input_reference_file_ids"),
  );
  if (!referenceField) {
    throw new Error("This model does not support editing with an image reference.");
  }
  const imported = await importTaskImageAsFile(task.task_id, imageIndex, gatewayToken);
  const scene = task.scene_id
    ? null
    : await createScene(
        {
          title: (task.prompt.trim() || "Image edit").slice(0, 160),
          description: "",
        },
        gatewayToken,
      );
  const providerOptions: Record<string, unknown> = { ...(task.provider_options ?? {}) };
  delete providerOptions.image_file_ids;
  delete providerOptions.input_reference_file_ids;
  delete providerOptions.image;
  delete providerOptions.images;
  delete providerOptions.input_references;
  delete providerOptions.mask_file_id;
  providerOptions[referenceField.key] = [imported.file_id];
  const resolutionField = operation.fields.find((field) => field.key === "resolution");
  const effectiveResolution =
    resolution ??
    (typeof resolutionField?.default === "string" ? resolutionField.default : null);

  return createImageTask(
    {
      provider: task.provider,
      model: task.model,
      operation: operation.id,
      scene_id: task.scene_id ?? scene?.scene_id ?? null,
      generation_id: task.scene_id ? task.generation_id : null,
      parent_version_id: task.scene_id ? task.task_id : null,
      prompt,
      negative_prompt: task.negative_prompt,
      duration_sec: task.duration_sec,
      resolution: effectiveResolution,
      fps: task.fps,
      seed: task.seed,
      provider_options: providerOptions,
      subject_bindings: [],
    },
    gatewayToken,
  );
}

function buildVersionResizePrompt(originalPrompt: string, resolutionLabel: string): string {
  return [
    "Create a higher-resolution version of the supplied image at the requested output size.",
    "Preserve the original composition, subjects, identity, details, and style without adding or removing content.",
    "Original scene request:",
    originalPrompt.trim(),
    `Requested output size: ${resolutionLabel}`,
  ].join("\n");
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
