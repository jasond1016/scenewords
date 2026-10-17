import type { VideoTaskDetail } from "./types";

export async function prepareMediaFile(url: string, task: VideoTaskDetail, signal: AbortSignal): Promise<File> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new File([blob], buildSharedFileName(task, blob.type), { type: blob.type });
}

/** A browser download request, not confirmation that a file was saved to Photos or disk. */
export function startMediaDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Give Safari time to consume the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function shareMedia(
  url: string,
  title: string,
  file: File | null,
  onHandoff: () => void,
): Promise<"shared" | "copied" | "canceled"> {
  const absoluteUrl = new URL(url, window.location.href).href;
  if (typeof navigator.share === "function") {
    const data: ShareData = file && navigator.canShare?.({ files: [file] })
      ? { files: [file], title }
      : { url: absoluteUrl, title };
    if (!navigator.canShare || navigator.canShare(data)) {
      try {
        const result = navigator.share(data);
        // The browser owns the native sheet now; its Promise settles at different times across OSes.
        onHandoff();
        await result;
        return "shared";
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return "canceled";
        // A permissions/activation/transport failure is not a successful link-copy fallback.
        throw error;
      }
    }
  }
  await navigator.clipboard.writeText(absoluteUrl);
  return "copied";
}

function buildSharedFileName(task: VideoTaskDetail, contentType?: string): string {
  const base = `${task.provider || "scenewords"}_${task.task_id.slice(0, 8)}`;
  const normalizedType = contentType?.toLowerCase() ?? "";
  if (normalizedType.includes("png")) return `${base}.png`;
  if (normalizedType.includes("webp")) return `${base}.webp`;
  if (normalizedType.includes("gif")) return `${base}.gif`;
  if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return `${base}.jpg`;
  if (normalizedType.includes("quicktime")) return `${base}.mov`;
  if (normalizedType.includes("webm")) return `${base}.webm`;
  if (normalizedType.includes("mp4")) return `${base}.mp4`;
  return task.asset_type === "image" ? `${base}.jpg` : `${base}.mp4`;
}
