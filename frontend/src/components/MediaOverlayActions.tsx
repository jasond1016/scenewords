import { Crop, DownloadSimple, PencilSimple, ShareNetwork, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { VideoTaskDetail } from "../types";

interface ExportActionsProps {
  task: VideoTaskDetail;
  downloadUrl?: string | null;
}

export function MediaOverlayExportActions({ task, downloadUrl }: ExportActionsProps) {
  const { t } = useI18n();
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareError) {
      return;
    }
    const timeoutId = window.setTimeout(() => setShareError(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [shareError]);

  const handleShare = async () => {
    if (!downloadUrl || typeof navigator === "undefined") {
      return;
    }
    if (typeof navigator.share !== "function") {
      setShareError(
        typeof window !== "undefined" && window.isSecureContext === false
          ? t("works.shareRequiresHttps")
          : t("works.shareUnavailable"),
      );
      return;
    }

    setIsSharing(true);
    setShareError(null);
    try {
      let shared = false;
      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const file = new File([blob], buildSharedFileName(task, blob.type), {
          type: blob.type || undefined,
        });
        const canShareFiles =
          typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
        if (canShareFiles) {
          await navigator.share({ files: [file], title: task.prompt || t("works.share") });
          shared = true;
        }
      } catch (error) {
        if (isShareCanceled(error)) {
          throw error;
        }
        // Fall back to sharing the result URL when file sharing is unavailable.
      }

      if (!shared) {
        await navigator.share({ title: task.prompt || t("works.share"), url: downloadUrl });
      }
    } catch (error) {
      if (isShareCanceled(error)) {
        return;
      }
      setShareError(t("works.shareFailed"));
    } finally {
      setIsSharing(false);
    }
  };

  if (!downloadUrl) {
    return null;
  }

  return (
    <div className="media-overlay-export-actions" role="toolbar" aria-label={t("works.exportActions")}>
      <a
        href={downloadUrl}
        download
        className="media-overlay-icon-button"
        aria-label={t("works.download")}
        title={t("works.download")}
      >
        <DownloadSimple size={22} weight="regular" />
      </a>
      <button
        type="button"
        className="media-overlay-icon-button"
        onClick={() => void handleShare()}
        disabled={isSharing}
        aria-label={isSharing ? t("works.sharing") : t("works.share")}
        title={t("works.share")}
      >
        <ShareNetwork size={22} weight="regular" />
      </button>
      {shareError ? (
        <span className="media-overlay-share-error" role="status">
          <span>{shareError}</span>
          <button
            type="button"
            className="media-overlay-share-error-dismiss"
            aria-label={t("common.close")}
            onClick={() => setShareError(null)}
          >
            <X size={16} weight="regular" />
          </button>
        </span>
      ) : null}
    </div>
  );
}

function isShareCanceled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

interface ImageActionsProps {
  disabled?: boolean;
  onEdit: () => void;
  onAdjustSize: () => void;
  onGenerateFinal: () => void;
}

export function MediaOverlayImageActions(props: ImageActionsProps) {
  const { disabled = false, onEdit, onAdjustSize, onGenerateFinal } = props;
  const { t } = useI18n();

  return (
    <div className="media-overlay-image-actions" role="toolbar" aria-label={t("works.imageActions")}>
      <button
        type="button"
        className="media-overlay-image-action"
        onClick={onEdit}
        disabled={disabled}
        title={t("works.editImageHint")}
      >
        <span className="media-overlay-icon-button">
          <PencilSimple size={22} weight="regular" />
        </span>
        <span>{t("works.editImage")}</span>
      </button>
      <button
        type="button"
        className="media-overlay-image-action"
        onClick={onAdjustSize}
        disabled={disabled}
        title={t("works.adjustImageSizeHint")}
      >
        <span className="media-overlay-icon-button">
          <Crop size={22} weight="regular" />
        </span>
        <span>{t("works.adjustImageSize")}</span>
      </button>
      <button
        type="button"
        className="media-overlay-image-action media-overlay-image-action--primary"
        onClick={onGenerateFinal}
        disabled={disabled}
        title={t("works.generateFinalHint")}
      >
        <span className="media-overlay-icon-button">
          <Sparkle size={22} weight="regular" />
        </span>
        <span>{t("works.generateFinal")}</span>
      </button>
    </div>
  );
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
