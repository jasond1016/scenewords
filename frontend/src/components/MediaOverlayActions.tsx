import { ArrowClockwise, ArrowRight, CaretDown, Check, CircleNotch, Crop, DownloadSimple, PencilSimple, ShareNetwork, Sparkle, X } from "@phosphor-icons/react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { getImageResizeOptions } from "../overlayTaskActions";
import { prepareMediaFile, shareMedia, startMediaDownload } from "../mediaExport";
import { MediaOverlayFeedbackContext } from "./MediaOverlayFrame";
import { useFeedbackTimeout } from "../useActionFeedback";
import type { ProviderCatalogResponse, ProviderOperationOption, VideoTaskDetail } from "../types";

interface ExportActionsProps {
  task: VideoTaskDetail;
  downloadUrl?: string | null;
}

type ExportFeedback = { key: string; retry?: boolean };

export function MediaOverlayExportActions({ task, downloadUrl }: ExportActionsProps) {
  const { t } = useI18n();
  const feedbackTarget = useContext(MediaOverlayFeedbackContext);
  const [downloadState, setDownloadState] = useState<"idle" | "pending" | "success">("idle");
  const [isSharing, setIsSharing] = useState(false);
  const [downloadToast, setDownloadToast] = useState<ExportFeedback | null>(null);
  const [shareToast, setShareToast] = useState<ExportFeedback | null>(null);
  // aria-disabled preserves keyboard focus; these locks reject repeated activation immediately.
  const busy = useRef({ download: false, share: false });
  const fileRef = useRef<File | null | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const downloadSpinner = useDelayedBusy(downloadState === "pending");
  const shareSpinner = useDelayedBusy(isSharing);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    return () => controller.abort();
  }, []);

  const clearDownloadToast = useCallback(() => setDownloadToast(null), []);
  const clearShareToast = useCallback(() => setShareToast(null), []);
  const clearDownloadSuccess = useCallback(() => {
    setDownloadState("idle");
    setDownloadToast(null);
  }, []);
  useFeedbackTimeout(clearShareToast, shareToast, !!shareToast && !shareToast.retry);
  useFeedbackTimeout(clearDownloadSuccess, downloadToast, downloadState === "success");

  const handleDownload = async () => {
    const signal = request.current?.signal;
    if (!downloadUrl || !signal || busy.current.download) return;
    busy.current.download = true;
    setDownloadState("pending");
    setDownloadToast(null);
    try {
      const file = fileRef.current ?? await prepareMediaFile(downloadUrl, task, signal);
      if (signal.aborted) return;
      fileRef.current = file;
      startMediaDownload(file);
      setDownloadState("success");
      setDownloadToast({ key: "works.downloadStarted" });
    } catch {
      if (!signal.aborted) {
        setDownloadState("idle");
        setDownloadToast({ key: "works.downloadFailed", retry: true });
      }
    } finally {
      busy.current.download = false;
    }
  };

  const handleShare = async () => {
    const signal = request.current?.signal;
    if (!downloadUrl || !signal || busy.current.share) return;
    busy.current.share = true;
    setIsSharing(true);
    setShareToast(null);
    try {
      if (fileRef.current === undefined && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
        try {
          fileRef.current = await prepareMediaFile(downloadUrl, task, signal);
        } catch {
          // A missing/CORS-blocked file can still be shared as a URL. Native share failures cannot.
          if (signal.aborted) return;
          fileRef.current = null;
        }
      }
      if (signal.aborted) return;
      const outcome = await shareMedia(downloadUrl, task.prompt || t("works.share"), fileRef.current ?? null, () => {
        if (!signal.aborted) setIsSharing(false);
      });
      if (!signal.aborted && outcome === "copied") {
        setShareToast({ key: "works.linkCopied" });
      }
    } catch {
      if (!signal.aborted) setShareToast({ key: "works.shareFailed", retry: true });
    } finally {
      busy.current.share = false;
      if (!signal.aborted) setIsSharing(false);
    }
  };

  if (!downloadUrl) {
    return null;
  }

  return (
    <div className="media-overlay-export-actions" role="toolbar" aria-label={t("works.exportActions")}>
      <button
        ref={downloadButton}
        type="button"
        className="media-overlay-icon-button"
        onClick={() => void handleDownload()}
        aria-disabled={downloadState === "pending"}
        aria-busy={downloadState === "pending"}
        aria-label={t(downloadState === "pending" ? "works.downloading" : downloadState === "success" ? "works.downloadStarted" : "works.download")}
        title={t("works.download")}
      >
        {downloadState === "pending" && downloadSpinner ? <CircleNotch className="media-overlay-export-spinner" size={22} aria-hidden="true" />
          : downloadState === "success" ? <Check size={22} aria-hidden="true" /> : <DownloadSimple size={22} weight="regular" aria-hidden="true" />}
      </button>
      <button
        ref={shareButton}
        type="button"
        className="media-overlay-icon-button"
        onClick={() => void handleShare()}
        aria-disabled={isSharing}
        aria-busy={isSharing}
        aria-label={isSharing ? t("works.sharing") : t("works.share")}
        title={t("works.share")}
      >
        {isSharing && shareSpinner ? <CircleNotch className="media-overlay-export-spinner" size={22} aria-hidden="true" /> : <ShareNetwork size={22} weight="regular" aria-hidden="true" />}
      </button>
      {[{ toast: downloadToast, action: "download" }, { toast: shareToast, action: "share" }].map(({ toast, action }) => toast && feedbackTarget ? createPortal(
        <div className="media-overlay-export-toast" data-error={!!toast.retry} data-overlay-scroll="allow" role={toast.retry ? "alert" : "status"}>
          <span id={`media-overlay-${action}-message`}>{t(toast.key)}</span>
          {toast.retry ? <button type="button" aria-describedby={`media-overlay-${action}-message`} onClick={() => {
            if (action === "download") {
              downloadButton.current?.focus();
              void handleDownload();
            } else {
              shareButton.current?.focus();
              void handleShare();
            }
          }}>{t("works.exportRetry")}</button> : null}
          {toast.retry ? <button type="button" aria-label={t("common.close")} onClick={() => {
            const target = action === "download" ? downloadButton : shareButton;
            if (action === "download") clearDownloadToast();
            else clearShareToast();
            target.current?.focus();
          }}><X size={18} aria-hidden="true" /></button> : null}
        </div>, feedbackTarget, action,
      ) : null)}
    </div>
  );
}

function useDelayedBusy(pending: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return visible;
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
  error?: string | null;
}) {
  const { value, onChange, onSubmit, pending, error } = props;
  const { t } = useI18n();
  return (
    <form id="media-overlay-edit-form" className="media-overlay-edit-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}>
      <label htmlFor="media-overlay-edit-instruction">{t("works.editInstruction")}</label>
      <textarea
        id="media-overlay-edit-instruction"
        aria-describedby={error ? "media-overlay-edit-hint media-overlay-edit-error" : "media-overlay-edit-hint"}
        aria-invalid={!!error}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("works.editInstructionPlaceholder")}
        rows={3}
        autoFocus
        disabled={pending}
      />
      {error ? <p id="media-overlay-edit-error" className="media-overlay-resize-options__error" role="alert">{error}</p> : null}
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
            <div className={`media-overlay-resize-options__list${isRatio ? " media-overlay-resize-options__list--ratios" : ""}`}>
              {options.map((option) => {
                const ratio = isRatio ? option.value.split(":").map(Number) : null;
                const scale = ratio ? 24 / Math.max(...ratio) : 0;
                return (
                  <label key={option.value}>
                    <input
                      type="radio"
                      className={isRatio ? "sr-only" : undefined}
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
}) {
  const { t } = useI18n();
  const { pending, queued, error, kind } = props;
  if (!pending && !queued && !error) return null;
  return (
    <div className="media-overlay-generation-feedback" role={error ? "alert" : "status"} aria-live="polite">
      <span>{error ? t(`works.${kind}Failed`, { message: error }) : t(`works.${kind}${pending ? "Submitting" : "Queued"}`)}</span>
    </div>
  );
}
