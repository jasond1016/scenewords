import type { Slide } from "yet-another-react-lightbox";
import type { VideoTaskDetail } from "./types";
import {
  extractImageUrls,
  extractVideoUrl,
} from "./utils";

export type LightboxKind = "image" | "video" | "failed";

export interface LightboxMediaItem {
  key: string;
  taskId: string;
  url: string;
  kind: LightboxKind;
}

export interface FailedSlide {
  type: "failed";
  taskId: string;
  width: number;
  height: number;
}

declare module "yet-another-react-lightbox" {
  interface SlideTypes {
    failed: FailedSlide;
  }
}

export type AppLightboxSlide = Slide | FailedSlide;
export type MediaOrientation = "landscape" | "portrait" | "square";

const LANDSCAPE_FALLBACK_DIMENSIONS = { width: 1600, height: 900 };
const PORTRAIT_FALLBACK_DIMENSIONS = { width: 900, height: 1600 };
const RATIO_FALLBACK_MAX_DIMENSION = 1600;

export function buildLightboxItems(
  tasks: VideoTaskDetail[],
  kind: "image" | "video",
): LightboxMediaItem[] {
  const items: LightboxMediaItem[] = [];
  for (const task of tasks) {
    if (kind === "image") {
      if (task.asset_type !== "image") {
        continue;
      }
      if (task.status === "failed") {
        items.push({
          key: `${task.task_id}_failed`,
          taskId: task.task_id,
          url: "",
          kind: "failed",
        });
        continue;
      }
      const urls = extractImageUrls(task);
      urls.forEach((url, index) => {
        items.push({
          key: `${task.task_id}_img_${index}_${url}`,
          taskId: task.task_id,
          url,
          kind: "image",
        });
      });
      continue;
    }

    if (task.asset_type !== "video") {
      continue;
    }
    if (task.status === "failed") {
      items.push({
        key: `${task.task_id}_failed`,
        taskId: task.task_id,
        url: "",
        kind: "failed",
      });
      continue;
    }
    const url = extractVideoUrl(task);
    if (!url) {
      continue;
    }
    items.push({
      key: `${task.task_id}_video_${url}`,
      taskId: task.task_id,
      url,
      kind: "video",
    });
  }
  return items;
}

export function resolveInitialLightboxState(
  taskId: string,
  tasks: VideoTaskDetail[],
  imageItems: LightboxMediaItem[],
  videoItems: LightboxMediaItem[],
): { kind: "image" | "video"; index: number } | null {
  const targetTask = tasks.find((task) => task.task_id === taskId);
  if (!targetTask) {
    return null;
  }
  if (targetTask.asset_type === "video") {
    const index = videoItems.findIndex((item) => item.taskId === taskId);
    return index >= 0 ? { kind: "video", index } : null;
  }
  const index = imageItems.findIndex((item) => item.taskId === taskId);
  return index >= 0 ? { kind: "image", index } : null;
}

export function mapLightboxItemsToSlides(
  items: readonly LightboxMediaItem[],
  taskById: ReadonlyMap<string, VideoTaskDetail>,
): AppLightboxSlide[] {
  return items.map((item) => {
    const task = taskById.get(item.taskId);
    const isPortraitMode = task ? inferTaskPortrait(task) : false;
    const dimensions = task ? resolveMediaDimensions(task, isPortraitMode) : fallbackDimensions(isPortraitMode);

    if (item.kind === "failed") {
      return {
        type: "failed",
        taskId: item.taskId,
        width: dimensions.width,
        height: dimensions.height,
      };
    }

    if (item.kind === "video") {
      const poster = task ? extractVideoPoster(task) ?? extractImageUrls(task)[0] ?? undefined : undefined;
      return {
        type: "video",
        width: dimensions.width,
        height: dimensions.height,
        poster,
        autoPlay: true,
        controls: true,
        loop: true,
        playsInline: true,
        preload: "metadata",
        sources: [
          {
            src: item.url,
            type: inferVideoMimeType(item.url),
          },
        ],
      };
    }

    return {
      src: item.url,
      alt: item.taskId,
      width: dimensions.width,
      height: dimensions.height,
      imageFit: "contain",
    };
  });
}

export function extractVideoPoster(task: VideoTaskDetail): string | null {
  const result = task.result;
  if (!result || typeof result !== "object") {
    return null;
  }
  const candidates = [
    "local_thumbnail_url",
    "thumbnail_url",
    "local_poster_url",
    "poster_url",
    "cover_url",
    "preview_image_url",
    "first_frame_url",
  ];
  for (const key of candidates) {
    const value = (result as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function inferTaskPortrait(task: VideoTaskDetail): boolean {
  return inferTaskOrientation(task) === "portrait";
}

export function inferTaskOrientation(task: VideoTaskDetail): MediaOrientation {
  const ratio = parseResolutionRatio(task.resolution);
  if (ratio != null) {
    return toOrientation(ratio);
  }
  const providerWidth = readNumber(task.provider_options ?? {}, "width");
  const providerHeight = readNumber(task.provider_options ?? {}, "height");
  if (providerWidth != null && providerHeight != null && providerWidth > 0) {
    return toOrientation(providerWidth / providerHeight);
  }
  const providerRatio = readAspectRatio(task.provider_options ?? {}, "aspect_ratio");
  if (providerRatio != null) {
    return toOrientation(providerRatio);
  }
  return "landscape";
}

function resolveMediaDimensions(
  task: VideoTaskDetail,
  isPortraitMode: boolean,
): { width: number; height: number } {
  const providerWidth = readNumber(task.provider_options ?? {}, "width");
  const providerHeight = readNumber(task.provider_options ?? {}, "height");
  if (providerWidth != null && providerHeight != null && providerWidth > 0 && providerHeight > 0) {
    return { width: providerWidth, height: providerHeight };
  }

  const resolutionDimensions = parseResolutionDimensions(task.resolution);
  if (resolutionDimensions) {
    return resolutionDimensions;
  }

  return fallbackDimensions(isPortraitMode);
}

function fallbackDimensions(isPortraitMode: boolean): { width: number; height: number } {
  return isPortraitMode ? PORTRAIT_FALLBACK_DIMENSIONS : LANDSCAPE_FALLBACK_DIMENSIONS;
}

function parseResolutionDimensions(
  value: string | null,
): { width: number; height: number } | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const rawWidth = Number(match[1]);
  const rawHeight = Number(match[2]);
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return null;
  }
  if (rawWidth >= 128 && rawHeight >= 128) {
    return { width: rawWidth, height: rawHeight };
  }

  const scale = RATIO_FALLBACK_MAX_DIMENSION / Math.max(rawWidth, rawHeight);
  return {
    width: Math.max(1, Math.round(rawWidth * scale)),
    height: Math.max(1, Math.round(rawHeight * scale)),
  };
}

function parseResolutionRatio(value: string | null): number | null {
  const dimensions = parseResolutionDimensions(value);
  if (dimensions) {
    return dimensions.width / dimensions.height;
  }

  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("portrait") || normalized.includes("vertical")) {
    return 9 / 16;
  }
  if (normalized.includes("landscape") || normalized.includes("horizontal")) {
    return 16 / 9;
  }
  return null;
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

function readAspectRatio(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const ratio = parseResolutionRatio(value);
  return ratio != null && ratio > 0 ? ratio : null;
}

function inferVideoMimeType(url: string): string {
  const normalized = url.split("?")[0]?.toLowerCase() ?? "";
  if (normalized.endsWith(".webm")) {
    return "video/webm";
  }
  if (normalized.endsWith(".mov")) {
    return "video/quicktime";
  }
  if (normalized.endsWith(".ogv") || normalized.endsWith(".ogg")) {
    return "video/ogg";
  }
  if (normalized.endsWith(".m3u8")) {
    return "application/x-mpegURL";
  }
  return "video/mp4";
}

function toOrientation(ratio: number): MediaOrientation {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "landscape";
  }
  if (Math.abs(ratio - 1) < 0.001) {
    return "square";
  }
  return ratio < 1 ? "portrait" : "landscape";
}
