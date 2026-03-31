import { useEffect, useState } from "react";
import {
  ImageSquare,
  VideoCamera,
  WarningCircle,
} from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { extractVideoPoster, inferTaskPortrait } from "../lightbox";
import type { VideoTaskDetail } from "../types";
import {
  extractImageUrls,
  extractVideoUrl,
} from "../utils";
import { useVideoPosterUrl } from "../useVideoPoster";

type StatusTone = "warn" | "ok" | "danger" | "muted";

interface Props {
  task: VideoTaskDetail;
  onClick: () => void;
  timestampLabel: string;
  providerLabel: string;
  className: string;
  selected?: boolean;
  aspectClassName?: string;
  promptClassName?: string;
  metaClassName?: string;
  statusBadge?: {
    label: string;
    tone: StatusTone;
  } | null;
}

export function TaskPreviewCard(props: Props) {
  const {
    task,
    onClick,
    timestampLabel,
    providerLabel,
    className,
    selected = false,
    aspectClassName,
    promptClassName = "m-0 line-clamp-3 text-xs font-semibold leading-relaxed text-[var(--c-text)]",
    metaClassName = "flex items-center justify-between gap-2 text-[10px] text-[var(--c-text-tertiary)]",
    statusBadge = null,
  } = props;

  const selectedClassName = selected ? " media-card-selected" : "";

  return (
    <button
      type="button"
      className={`${className}${selectedClassName}`}
      onClick={onClick}
    >
      <TaskPreviewMedia
        task={task}
        aspectClassName={aspectClassName}
        statusBadge={statusBadge}
      />

      <div className="mt-2.5 flex flex-col gap-1 px-1 pb-1 text-left">
        <p className={promptClassName}>{task.prompt?.trim() || "—"}</p>
        <div className={metaClassName}>
          <span className="truncate">{providerLabel}</span>
          <span className="shrink-0">{timestampLabel}</span>
        </div>
      </div>
    </button>
  );
}

function TaskPreviewMedia({
  task,
  aspectClassName,
  statusBadge,
}: {
  task: VideoTaskDetail;
  aspectClassName?: string;
  statusBadge?: {
    label: string;
    tone: StatusTone;
  } | null;
}) {
  const { t } = useI18n();
  const [hasError, setHasError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const thumb = extractImageUrls(task)[0] ?? null;
  const videoUrl = task.asset_type === "video" ? extractVideoUrl(task) : null;
  const videoPoster = task.asset_type === "video" ? extractVideoPoster(task) ?? thumb : null;
  const generatedPosterUrl = useVideoPosterUrl(!videoPoster && videoUrl ? videoUrl : null);
  const resolvedPosterUrl = videoPoster ?? generatedPosterUrl ?? thumb ?? null;
  const [isVideoReady, setIsVideoReady] = useState<boolean>(() =>
    task.asset_type === "video" ? Boolean(resolvedPosterUrl) : true,
  );
  const mediaWrapClass =
    aspectClassName ?? (inferTaskPortrait(task) ? "aspect-[3/4]" : "aspect-video");
  const isVideoTask = task.asset_type === "video";

  useEffect(() => {
    if (!isVideoTask) {
      return;
    }
    setIsVideoReady(Boolean(resolvedPosterUrl));
  }, [isVideoTask, resolvedPosterUrl, videoUrl]);

  const showFailureState =
    task.status === "failed" || (hasError && task.status !== "queued" && task.status !== "running");

  if (showFailureState || (!thumb && !videoUrl)) {
    return (
      <div
        className={`relative ${mediaWrapClass} w-full overflow-hidden rounded-xl border border-border ${
          showFailureState ? "bg-error-bg text-error-text" : "bg-canvas text-[var(--c-text-tertiary)]"
        }`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
          {showFailureState ? (
            <>
              <WarningCircle size={22} weight="regular" />
              <span className="font-medium">{t("works.generationFailed")}</span>
            </>
          ) : (
            <span className="font-medium">
              {task.asset_type === "image" ? t("works.kindImage") : t("works.kindVideo")}
            </span>
          )}
        </div>
        {statusBadge ? (
          <div className="absolute left-3 top-3">
            <span className={`tag ${toneToTagClass(statusBadge.tone)}`}>{statusBadge.label}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (isVideoTask) {
    return (
      <div
        className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-xl border border-border bg-canvas`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <video
          className="h-full w-full object-cover"
          src={videoUrl ?? undefined}
          poster={resolvedPosterUrl ?? undefined}
          muted
          playsInline
          preload={isHovered ? "metadata" : "none"}
          autoPlay={isHovered}
          loop
          onLoadedData={() => setIsVideoReady(true)}
          onCanPlay={() => setIsVideoReady(true)}
          onError={() => setHasError(true)}
        />
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
            isVideoReady ? "opacity-0" : "opacity-100"
          }`}
        >
          {resolvedPosterUrl ? (
            <img
              src={resolvedPosterUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-[#F4F4F5] via-[#E4E4E7] to-[#D4D4D8]" />
              <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            </>
          )}
        </div>
        {statusBadge ? (
          <div className="absolute left-3 top-3">
            <span className={`tag ${toneToTagClass(statusBadge.tone)}`}>{statusBadge.label}</span>
          </div>
        ) : null}
        <div className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white shadow-[var(--shadow-sm)]">
          <VideoCamera size={14} weight="fill" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative ${mediaWrapClass} w-full overflow-hidden rounded-xl border border-border bg-canvas`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <img
        className="h-full w-full object-cover"
        src={thumb}
        alt={task.task_id}
        loading="lazy"
        onError={() => setHasError(true)}
      />
      {statusBadge ? (
        <div className="absolute left-3 top-3">
          <span className={`tag ${toneToTagClass(statusBadge.tone)}`}>{statusBadge.label}</span>
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white shadow-[var(--shadow-sm)]">
        <ImageSquare size={14} weight="fill" />
      </div>
    </div>
  );
}

function toneToTagClass(tone: StatusTone): string {
  if (tone === "ok") {
    return "tag-success";
  }
  if (tone === "warn") {
    return "tag-warning";
  }
  if (tone === "danger") {
    return "tag-error";
  }
  return "tag-neutral";
}
