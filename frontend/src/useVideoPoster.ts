import { useEffect, useState } from "react";

const VIDEO_POSTER_CACHE = new Map<string, string | null>();

function captureVideoPoster(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      resolve(null);
      return;
    }

    const video = document.createElement("video");
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(null), 5000);

    function finish(value: string | null) {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve(value);
    }

    function drawFrame() {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        finish(null);
      }
    }

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.addEventListener("error", () => finish(null), { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        const duration =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const targetTime =
          duration > 0
            ? Math.min(Math.max(duration * 0.15, 0.4), Math.max(duration - 0.1, 0))
            : 0;

        if (targetTime <= 0.05) {
          if (video.readyState >= 2) {
            drawFrame();
          } else {
            video.addEventListener("loadeddata", drawFrame, { once: true });
          }
          return;
        }

        video.addEventListener("seeked", drawFrame, { once: true });
        try {
          video.currentTime = targetTime;
        } catch {
          if (video.readyState >= 2) {
            drawFrame();
          } else {
            video.addEventListener("loadeddata", drawFrame, { once: true });
          }
        }
      },
      { once: true },
    );

    video.src = src;
    video.load();
  });
}

export function useVideoPosterUrl(src: string | null | undefined): string | null {
  const normalizedSrc = src?.trim() ?? "";
  const [posterUrl, setPosterUrl] = useState<string | null>(() =>
    normalizedSrc ? VIDEO_POSTER_CACHE.get(normalizedSrc) ?? null : null,
  );

  useEffect(() => {
    if (!normalizedSrc) {
      setPosterUrl(null);
      return;
    }

    const cached = VIDEO_POSTER_CACHE.get(normalizedSrc);
    if (cached !== undefined) {
      setPosterUrl(cached);
      return;
    }

    let active = true;
    setPosterUrl(null);
    captureVideoPoster(normalizedSrc)
      .then((poster) => {
        VIDEO_POSTER_CACHE.set(normalizedSrc, poster);
        if (active) {
          setPosterUrl(poster);
        }
      })
      .catch(() => {
        VIDEO_POSTER_CACHE.set(normalizedSrc, null);
        if (active) {
          setPosterUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [normalizedSrc]);

  return posterUrl;
}
