import { useState } from "react";
import { useI18n } from "../i18n";
import { inferTaskAspectRatio } from "../lightbox";
import type { VideoTaskDetail } from "../types";

interface Props {
  task: VideoTaskDetail;
  src?: string;
  statusLabel: string;
  onOpen?: () => void;
  onLoad?: () => void;
}

/** All task states use the requested media frame; only successful tasks may show real media. */
export function SessionImage({ task, src, statusLabel, onOpen, onLoad }: Props) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const mediaUrl = task.status === "succeeded" ? src : undefined;
  const isVideo = task.asset_type === "video";
  const isEmpty = task.status === "failed" || task.status === "canceled";
  const state = loaded ? "loaded" : failed ? "failed" : mediaUrl ? "loading" : task.status;
  const message = failed ? t(isVideo ? "create.sessions.videoLoadFailed" : "create.sessions.imageLoadFailed")
    : isEmpty ? t(isVideo ? "create.sessions.noVideo" : "create.sessions.noImage")
    : mediaUrl ? t("common.loading") : task.status === "succeeded" ? t("works.resourceExpiredHint") : statusLabel;
  const placeholderMessage = task.status === "canceled" ? `${statusLabel} · ${message}` : message;

  return (
    <div className="session-image" data-state={state} data-loaded={loaded} style={{ aspectRatio: inferTaskAspectRatio(task, 4 / 3) }}>
      <div
        className="session-turn-image-placeholder"
        data-state={state}
        role={loaded ? undefined : "status"}
        aria-live={loaded ? undefined : "polite"}
        aria-hidden={loaded || undefined}
      >
        <svg className="session-image-drawing" width="40" height="40" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect className="session-image-stroke session-image-stroke-frame" x="4" y="4" width="24" height="24" rx="2" pathLength="1" />
          <path className="session-image-stroke session-image-stroke-mountain" d="M4 23L12 15L17 20L21 16L28 23" pathLength="1" />
          <circle className="session-image-stroke session-image-stroke-sun" cx="12" cy="10" r="2" pathLength="1" />
        </svg>
        <span>{placeholderMessage}</span>
      </div>
      {mediaUrl && isVideo ? (
        <video className="session-turn-video" src={mediaUrl} controls playsInline preload="metadata"
          aria-label={t("create.sessions.videoResult")}
          onLoadedMetadata={() => { setLoaded(true); onLoad?.(); }}
          onError={() => { setFailed(true); setLoaded(false); }} />
      ) : mediaUrl ? (
        <button
          type="button"
          className="session-turn-image-button"
          disabled={!loaded}
          aria-label={t("create.sessions.openImage")}
          title={t("create.sessions.openImage")}
          onClick={onOpen}
        >
          <img
            src={mediaUrl}
            alt=""
            loading="lazy"
            onLoad={() => {
              setLoaded(true);
              onLoad?.();
            }}
            onError={() => { setFailed(true); setLoaded(false); }}
          />
        </button>
      ) : null}
    </div>
  );
}
