import { ArrowClockwise, ArrowRight, CaretDown, Crop, DownloadSimple, PencilSimple, ShareNetwork, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { getImageResizeOptions } from "../overlayTaskActions";
import type { ProviderCatalogResponse, ProviderOperationOption, VideoTaskDetail } from "../types";

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
  isEditPromptOpen: boolean;
  isResizeOptionsOpen: boolean;
  onEdit: () => void;
  onAdjustSize: () => void;
  onRegenerate: () => void;
  onGenerateHighResolutionCandidate: () => void;
}

export function MediaOverlayImageActions(props: ImageActionsProps) {
  const { disabled = false, isEditPromptOpen, isResizeOptionsOpen, onEdit, onAdjustSize, onRegenerate, onGenerateHighResolutionCandidate } = props;
  const { t } = useI18n();

  return (
    <div className="media-overlay-image-tools">
      <div className="media-overlay-image-actions" role="toolbar" aria-label={t("works.imageActions")}>
        <button
          type="button"
          className="media-overlay-image-action"
          onClick={onEdit}
          disabled={disabled}
          title={t("works.editImageHint")}
          aria-expanded={isEditPromptOpen}
          aria-controls={isEditPromptOpen ? "media-overlay-edit-form" : undefined}
        >
          <PencilSimple size={20} weight="regular" />
          <span className="media-overlay-image-action-label">
            {t("works.editImage")}
            <CaretDown className="media-overlay-image-action-chevron" size={12} weight="regular" aria-hidden="true" />
          </span>
        </button>
        <button
          type="button"
          className="media-overlay-image-action"
          onClick={onAdjustSize}
          disabled={disabled}
          title={t("works.adjustImageSizeHint")}
          aria-expanded={isResizeOptionsOpen}
          aria-controls={isResizeOptionsOpen ? "media-overlay-resize-options" : undefined}
        >
          <Crop size={20} weight="regular" />
          <span className="media-overlay-image-action-label">
            {t("works.adjustImageSize")}
            <CaretDown className="media-overlay-image-action-chevron" size={12} weight="regular" aria-hidden="true" />
          </span>
        </button>
        <button
          type="button"
          className="media-overlay-image-action"
          onClick={onRegenerate}
          disabled={disabled}
          title={t("works.regenerateHint")}
        >
          <ArrowClockwise size={20} weight="regular" />
          <span>{t("works.regenerate")}</span>
        </button>
        <button
          type="button"
          className="media-overlay-image-action"
          onClick={onGenerateHighResolutionCandidate}
          disabled={disabled}
          title={t("works.generateHighResolutionCandidateHint")}
        >
          <Sparkle size={20} weight="regular" />
          <span>{t("works.highResolutionCandidateShort")}</span>
        </button>
      </div>
    </div>
  );
}

export function MediaOverlayEditComposer(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const { value, onChange, onSubmit, pending } = props;
  const { t } = useI18n();
  return (
    <form id="media-overlay-edit-form" className="media-overlay-edit-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}>
      <label htmlFor="media-overlay-edit-instruction">{t("works.editInstruction")}</label>
      <textarea
        id="media-overlay-edit-instruction"
        aria-describedby="media-overlay-edit-hint"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("works.editInstructionPlaceholder")}
        rows={3}
        autoFocus
        disabled={pending}
      />
      <div className="media-overlay-edit-form__actions">
        <span id="media-overlay-edit-hint">{t("works.editOnlyCurrentImage")}</span>
        <button type="submit" disabled={pending || !value.trim()}>
          {pending ? t("works.editSubmitting") : t("works.submitEdit")}
          <ArrowRight size={18} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

export function MediaOverlayResizeComposer(props: {
  task: VideoTaskDetail;
  catalog?: ProviderCatalogResponse;
  loading: boolean;
  catalogError: boolean;
  onReload: () => void;
  pending: boolean;
  disabled: boolean;
  error?: string | null;
  onSubmit: (option: ProviderOperationOption) => void;
}) {
  const { task, catalog, loading, catalogError, onReload, pending, disabled, error, onSubmit } = props;
  const { t } = useI18n();
  const [selectedValue, setSelectedValue] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    const stack = form?.parentElement;
    if (!form || !stack) return;
    const revealPanel = () => {
      const style = getComputedStyle(form);
      const contentHeight = form.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      form.dataset.compact = String(stack.clientHeight < contentHeight);
      if (stack.scrollHeight > stack.clientHeight) stack.scrollTop = stack.scrollHeight;
    };
    const observer = new ResizeObserver(revealPanel);
    observer.observe(form);
    observer.observe(stack);
    revealPanel();
    return () => observer.disconnect();
  }, []);
  const options = useMemo(() => {
    if (!catalog) return [];
    try {
      return getImageResizeOptions(task, catalog).filter((option) => option.value !== "auto");
    } catch {
      return [];
    }
  }, [task, catalog]);
  const isRatio = options.length > 0 && options.every((option) => /^\d+:\d+$/.test(option.value));
  const model = catalog?.providers.find((provider) => provider.id === task.provider)
    ?.models.find((candidate) => candidate.name === task.model);
  const selectedOption = options.find((option) => option.value === selectedValue);
  const blocked = pending || disabled || loading || catalogError || !catalog;

  return (
    <form
      ref={formRef}
      id="media-overlay-resize-options"
      className="media-overlay-edit-form media-overlay-resize-options"
      aria-busy={pending || loading}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && selectedOption) onSubmit(selectedOption);
      }}
    >
      <div className="media-overlay-resize-options__header">
        <strong id="media-overlay-resize-title">{t(options.length ? isRatio ? "works.resizeChooseRatio" : "works.resizeChooseSize" : "works.adjustImageSize")}</strong>
        <p className="media-overlay-resize-options__model">{t("works.resizeModel", { model: model?.display_name ?? task.model })}</p>
      </div>
      <div
        className="media-overlay-resize-options__body"
        data-overlay-scroll="allow"
        tabIndex={0}
        role="region"
        aria-labelledby="media-overlay-resize-title"
      >
        <fieldset disabled={blocked} aria-labelledby="media-overlay-resize-title" aria-describedby="media-overlay-resize-hint">
          {catalogError ? (
            <p className="media-overlay-resize-options__error" role="alert">{t("works.editOptionsUnavailable")}</p>
          ) : loading ? (
            <p className="media-overlay-resize-options__empty" role="status">{t("works.editOptionsLoading")}</p>
          ) : options.length ? (
            <div className="media-overlay-resize-options__list">
              {options.map((option) => {
                const ratio = isRatio ? option.value.split(":").map(Number) : null;
                const scale = ratio ? 24 / Math.max(...ratio) : 0;
                return (
                  <label key={option.value}>
                    <input
                      type="radio"
                      name="media-overlay-resize-choice"
                      value={option.value}
                      checked={selectedValue === option.value}
                      onChange={() => setSelectedValue(option.value)}
                    />
                    {ratio ? (
                      <svg className="media-overlay-resize-options__ratio" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
                        <rect x={(32 - ratio[0] * scale) / 2} y={(32 - ratio[1] * scale) / 2} width={ratio[0] * scale} height={ratio[1] * scale} />
                      </svg>
                    ) : null}
                    <span>{isRatio ? option.value : /^\d+x\d+$/.test(option.value) ? option.value.replace("x", " × ") : option.label}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="media-overlay-resize-options__empty" role="status">{t("works.noResizeOptions")}</p>
          )}
        </fieldset>
      </div>
      <div className="media-overlay-resize-options__footer">
        {catalogError ? (
          <button type="button" className="media-overlay-resize-options__reload" onClick={onReload} disabled={pending || disabled || loading}>
            {t("works.resizeReloadOptions")}
          </button>
        ) : null}
        {error ? <p className="media-overlay-resize-options__error" role="alert" data-overlay-scroll="allow" tabIndex={0}>{t("works.resizeImageFailed", { message: error })}</p> : null}
        <div className="media-overlay-edit-form__actions">
          <span id="media-overlay-resize-hint">{t("works.resizeUsesCurrentImage")}</span>
          <button type="submit" disabled={blocked || !selectedOption}>
            {pending ? t("works.editSubmitting") : t("works.resizeSubmit")}
            <ArrowRight size={18} weight="regular" aria-hidden="true" />
          </button>
        </div>
      </div>
      {pending ? <span className="sr-only" role="status">{t("works.editSubmitting")}</span> : null}
    </form>
  );
}

export function MediaOverlayGenerationFeedback(props: {
  pending: boolean;
  queued: boolean;
  error?: string | null;
  kind: "regenerate" | "highResolutionCandidate";
  onViewTask: () => void;
}) {
  const { t } = useI18n();
  const { pending, queued, error, kind, onViewTask } = props;
  if (!pending && !queued && !error) return null;
  return (
    <div className="media-overlay-generation-feedback" role={error ? "alert" : "status"} aria-live="polite">
      <span>{error ? t(`works.${kind}Failed`, { message: error }) : t(`works.${kind}${pending ? "Submitting" : "Queued"}`)}</span>
      {queued && !pending && !error ? (
        <button type="button" onClick={onViewTask}>{t("works.viewTask")}</button>
      ) : null}
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
