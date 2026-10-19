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
  RetryMode,
  VideoTaskDetail,
  VideoTaskResponse,
} from "./types";
import { buildVersionEditPrompt, toDraft } from "./overlayTaskUtils";
import { sanitizeComposerOptions } from "./composerOptions";

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
}

export interface HighResolutionCandidatePayload {
  task: VideoTaskDetail;
  imageIndex: number;
  catalog: ProviderCatalogResponse;
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

  return submitImageTaskFromReference(
    payload.task,
    payload.imageIndex,
    buildVersionEditPrompt(payload.task.prompt, instruction),
    payload.task.resolution,
    payload.catalog,
    gatewayToken,
  );
}

export async function submitImageResize(
  payload: ResizeImagePayload,
  gatewayToken: string,
): Promise<VideoTaskResponse> {
  const prompt = buildVersionResizePrompt(
    payload.task.prompt,
    payload.resolutionLabel,
  );
  return submitImageTaskFromReference(
    payload.task,
    payload.imageIndex,
    prompt,
    payload.resolution,
    payload.catalog,
    gatewayToken,
  );
}

export function getImageResizeOptions(
  task: VideoTaskDetail,
  catalog: ProviderCatalogResponse,
) {
  const { operation } = resolveImageReferenceOperation(task, catalog);
  return operation.fields.find((field) => field.key === "resolution")?.options ?? [];
}

function resolveImageReferenceOperation(
  task: VideoTaskDetail,
  catalog: ProviderCatalogResponse,
) {
  const model = catalog.routing_providers?.find((provider) => provider.type.includes("image"))?.models[0]
    ?? catalog.providers.find((provider) => provider.id === task.provider)?.models.find((candidate) => candidate.name === task.model);
  for (const id of ["edit", task.operation, "generate"]) {
    for (const operation of model?.operations ?? []) {
      if (operation.id !== id) continue;
      const referenceField = operation.fields.find(
        (field) =>
          field.target === "provider_options" &&
          field.input_type === "file_list" &&
          (field.key === "image_file_ids" || field.key === "input_reference_file_ids"),
      );
      if (referenceField) return { operation, referenceField };
    }
  }
  throw new Error("This model does not support editing with an image reference.");
}

async function submitImageTaskFromReference(
  task: VideoTaskDetail,
  imageIndex: number,
  prompt: string,
  resolution: string | null,
  catalog: ProviderCatalogResponse,
  gatewayToken: string,
): Promise<VideoTaskResponse> {
  const { operation, referenceField } = resolveImageReferenceOperation(task, catalog);
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
  const providerOptions = sanitizeComposerOptions(task.routing?.intent?.provider_options ?? task.provider_options ?? {});
  delete providerOptions.image_file_ids;
  delete providerOptions.input_reference_file_ids;
  providerOptions[referenceField.key] = [imported.file_id];
  const resolutionField = operation.fields.find((field) => field.key === "resolution");
  const effectiveResolution =
    resolution ??
    (typeof resolutionField?.default === "string" ? resolutionField.default : null);

  return createImageTask(
    {
      provider: "",
      model: "",
      resolution_tier: task.routing?.goal.resolution_tier,
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
      subject_bindings: task.subject_bindings,
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
  });
}

export async function submitHighResolutionCandidate(
  payload: HighResolutionCandidatePayload,
  gatewayToken: string,
): Promise<VideoTaskResponse> {
  if (payload.task.asset_type !== "image" || payload.task.status !== "succeeded") {
    throw new Error("Only completed images can be used to create a high-resolution candidate.");
  }
  const imported = await importTaskImageAsFile(
    payload.task.task_id,
    payload.imageIndex,
    gatewayToken,
  );
  const scene = payload.task.scene_id
    ? null
    : await createScene(
        {
          title: (payload.task.prompt.trim() || "High-resolution image candidate").slice(0, 160),
          description: "",
        },
        gatewayToken,
      );

  const providerOptions = sanitizeComposerOptions(payload.task.routing?.intent?.provider_options ?? payload.task.provider_options);
  delete providerOptions.input_reference_file_ids;
  providerOptions.image_file_ids = [imported.file_id];
  return createImageTask(
    {
      provider: "",
      model: "",
      operation: "edit",
      resolution_tier: "4k",
      scene_id: payload.task.scene_id ?? scene?.scene_id ?? null,
      generation_id: payload.task.scene_id ? payload.task.generation_id : null,
      parent_version_id: payload.task.generation_id ? payload.task.task_id : null,
      prompt: buildHighResolutionCandidatePrompt(payload.task.prompt),
      negative_prompt: payload.task.negative_prompt,
      seed: payload.task.seed,
      resolution: payload.task.routing?.goal.resolution ?? candidateRatio(payload.task.resolution),
      provider_options: providerOptions,
      subject_bindings: payload.task.subject_bindings,
    },
    gatewayToken,
  );
}

function candidateRatio(resolution: string | null): string | null {
  if (!resolution || resolution.includes(":")) return resolution;
  const [width, height] = resolution.split("x").map(Number);
  if (!width || !height) return null;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function buildHighResolutionCandidatePrompt(sourcePrompt: string): string {
  const sections = [
    "Create a high-resolution candidate based on the first supplied image. Treat it as the visual reference and preserve its composition, subject identities, overall style, colors, and important details.",
    "Improve rendering clarity, edge quality, texture coherence, and material detail while keeping the image recognizable. Small visual differences may occur; do not claim or force an exact pixel-for-pixel reproduction. Preserve transparency if the source has it.",
  ];
  if (sourcePrompt.trim()) {
    sections.push(
      `Original brief for context only; the supplied image takes priority: ${sourcePrompt.trim()}`,
    );
  }
  return sections.join("\n\n");
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
