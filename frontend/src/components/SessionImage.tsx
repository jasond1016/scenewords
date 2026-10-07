import { useState } from "react";
import { useI18n } from "../i18n";

interface Props {
  src?: string;
  running: boolean;
  statusLabel: string;
  onOpen?: () => void;
  onLoad?: () => void;
}

/** Keep the waiting card in place until the result image has actually loaded. */
export function SessionImage({ src, running, statusLabel, onOpen, onLoad }: Props) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="session-image" data-loaded={loaded}>
      <div
        className="session-turn-image-placeholder"
        data-state={loaded ? "loaded" : failed ? "failed" : src ? "loading" : running ? "running" : "queued"}
        role={loaded ? undefined : "status"}
        aria-live={loaded ? undefined : "polite"}
        aria-hidden={loaded || undefined}
      >
        <svg className="session-image-drawing" width="40" height="40" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect className="session-image-stroke session-image-stroke-frame" x="4" y="4" width="24" height="24" rx="2" pathLength="1" />
          <path className="session-image-stroke session-image-stroke-mountain" d="M4 23L12 15L17 20L21 16L28 23" pathLength="1" />
          <circle className="session-image-stroke session-image-stroke-sun" cx="12" cy="10" r="2" pathLength="1" />
        </svg>
        <span>{failed ? t("create.sessions.imageLoadFailed") : src ? t("common.loading") : statusLabel}</span>
      </div>
      {src && (
        <button
          type="button"
          className="session-turn-image-button"
          disabled={!loaded}
          aria-label={t("create.sessions.openImage")}
          title={t("create.sessions.openImage")}
          onClick={onOpen}
        >
          <img
            src={src}
            alt=""
            loading="lazy"
            onLoad={() => {
              setLoaded(true);
              onLoad?.();
            }}
            onError={() => setFailed(true)}
          />
        </button>
      )}
    </div>
  );
}
