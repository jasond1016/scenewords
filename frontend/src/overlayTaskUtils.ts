import type { VideoTaskDetail } from "./types";

export function toDraft(
  task: VideoTaskDetail,
  options: { sourceFileId?: string } = {},
) {
  const sourceFileId = options.sourceFileId?.trim() || null;
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
    providerOptions: sourceFileId
      ? { ...(task.provider_options ?? {}), image_file_ids: [sourceFileId] }
      : task.provider_options ?? {},
    sceneId: task.scene_id,
    generationId: task.generation_id,
    parentVersionId: task.generation_id ? task.task_id : null,
    subjectIds: task.subject_bindings.map((binding) => binding.subject_id),
    editBaseFileId: sourceFileId,
    modificationInstruction: "",
  };
}

export function buildVersionEditPrompt(originalPrompt: string, instruction: string): string {
  return [
    "Edit the supplied image while preserving all unspecified subjects, identities, objects, location details, composition, and style.",
    "Original scene request:",
    originalPrompt.trim(),
    "Modification request:",
    instruction.trim(),
  ].join("\n");
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
