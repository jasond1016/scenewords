import type { VideoTaskDetail } from "./types";

export function toDraft(task: VideoTaskDetail) {
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
    sceneId: task.scene_id,
    generationId: task.generation_id,
    parentVersionId: task.generation_id ? task.task_id : null,
  };
}

export function buildTaskRequestPayload(task: VideoTaskDetail) {
  return {
    provider: task.provider,
    model: task.model,
    operation: task.operation ?? "generate",
    scene_id: task.scene_id,
    generation_id: task.generation_id,
    parent_version_id: task.parent_version_id,
    prompt: task.prompt,
    negative_prompt: task.negative_prompt,
    duration_sec: task.duration_sec,
    resolution: task.resolution,
    fps: task.fps,
    seed: task.seed,
    provider_options: task.provider_options ?? {},
  };
}

export function formatRawDebugPayload(task: VideoTaskDetail): string {
  if (task.status === "failed" && task.error) {
    const rawError = task.error.raw_error;
    if (rawError !== undefined) {
      return JSON.stringify(rawError, null, 2);
    }
    return JSON.stringify(task.error, null, 2);
  }
  return JSON.stringify(task.result, null, 2);
}

export async function copyText(text: string): Promise<void> {
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
