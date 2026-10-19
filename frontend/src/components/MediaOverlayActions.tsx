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
        data-export-state={downloadState}
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
  resize: Omit<ResizeMenuProps, "open" | "onClose" | "onToggle" | "disabled">;
  onCloseResize: () => void;
  onEdit: () => void;
  onAdjustSize: () => void;
  onRegenerate: () => void;
  onGenerateHighResolutionCandidate: () => void;
}

export function MediaOverlayImageActions(props: ImageActionsProps) {
  const { disabled = false, isEditPromptOpen, isResizeOptionsOpen, resize, onCloseResize, onEdit, onAdjustSize, onRegenerate, onGenerateHighResolutionCandidate } = props;
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
        <MediaOverlayResizeMenu {...resize} open={isResizeOptionsOpen} onToggle={onAdjustSize} onClose={onCloseResize} disabled={disabled} />
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
      {error ? <p id="media-overlay-edit-error" className="media-overlay-action-error" role="alert">{error}</p> : null}
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

interface ResizeMenuProps {
  task: VideoTaskDetail;
  catalog?: ProviderCatalogResponse;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  pending: boolean;
  queued: boolean;
  onQueued: () => void;
  disabled: boolean;
  error?: string | null;
  onDismissError: () => void;
  onSubmit: (option: ProviderOperationOption) => void;
}

export function MediaOverlayResizeMenu(props: ResizeMenuProps) {
  const { task, catalog, open, onToggle, onClose, pending, queued, onQueued, disabled, error, onDismissError, onSubmit } = props;
  const { t } = useI18n();
  const feedbackTarget = useContext(MediaOverlayFeedbackContext);
  const menuTarget = feedbackTarget?.closest(".media-overlay-frame");
  const [selectedValue, setSelectedValue] = useState(task.resolution ?? "");
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const callbacks = useRef({ onClose, onQueued });
  callbacks.current = { onClose, onQueued };
  const finish = useCallback(() => callbacks.current.onQueued(), []);
  useFeedbackTimeout(finish, queued, queued);
  useEffect(() => {
    if (!pending && !queued) locked.current = false;
    if (queued || error) {
      callbacks.current.onClose();
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [pending, queued, error]);
  const options = useMemo(() => {
    if (!catalog) return [];
    try {
      return getImageResizeOptions(task, catalog);
    } catch {
      return [];
    }
  }, [task, catalog]);
  const selectedOption = options.find((option) => option.value === selectedValue);
  const blocked = pending || queued || disabled;
  const close = () => {
    callbacks.current.onClose();
    buttonRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const menu = menuRef.current;
    const anchor = buttonRef.current;
    if (!open || !menu || !anchor) return;
    // Render outside the scrolling/translucent toolbar, including in older WebKit.
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const style = getComputedStyle(menu);
      const inset = (edge: string) => Math.max(12, parseFloat(style.getPropertyValue(`--resize-safe-${edge}`)) || 0);
      const topEdge = (viewport?.offsetTop ?? 0) + inset("top");
      const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - inset("bottom");
      const leftEdge = (viewport?.offsetLeft ?? 0) + inset("left");
      const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth) - inset("right");
      menu.style.width = `${Math.min(272, rightEdge - leftEdge)}px`;
      const above = Math.max(0, rect.top - 8 - topEdge);
      const below = Math.max(0, bottomEdge - rect.bottom - 8);
      const desired = Math.min((menu.firstElementChild?.scrollHeight ?? 0) + 14, 360);
      const up = above >= Math.min(desired, 160) || above >= below;
      menu.style.maxHeight = `${Math.min(360, up ? above : below)}px`;
      const height = menu.getBoundingClientRect().height;
      menu.style.left = `${Math.max(leftEdge, Math.min(rect.left, rightEdge - menu.offsetWidth))}px`;
      menu.style.top = `${Math.max(topEdge, up ? rect.top - 8 - height : rect.bottom + 8)}px`;
      menu.dataset.placement = up ? "top" : "bottom";
      menu.style.visibility = "visible";
    };
    position();
    const index = Math.max(0, options.findIndex((option) => option.value === selectedValue));
    setActiveIndex(index);
    menu.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")[index]?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target) && !anchor.contains(event.target)) {
        // Dismissing on the canvas must not also toggle/focus the lightbox.
        if (event.target instanceof Element && !event.target.closest("button,a,input,textarea,select,summary")) {
          event.preventDefault();
          event.stopPropagation();
        }
        close();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    observer.observe(anchor);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, options, menuTarget]);
  const submit = (option: ProviderOperationOption) => {
    if (blocked || locked.current) return;
    locked.current = true;
    setSelectedValue(option.value);
    onSubmit(option);
  };
  if (!options.length) return null;
  const menu = open ? <div ref={menuRef} id="media-overlay-resize-menu" className="media-overlay-resize-menu" role="menu" aria-label={t("works.adjustImageSize")} aria-busy={pending} data-overlay-scroll="allow"
        onKeyDown={(event) => {
          const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
          if (keys.includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
              : (activeIndex + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + options.length) % options.length;
            setActiveIndex(next);
            menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")[next]?.focus();
          } else if (event.key === "Tab") close();
        }}>
        <div className="media-overlay-resize-menu__list" role="none" data-overlay-scroll="allow">
        {options.map((option, index) => {
          const dimensions = option.value.match(/^(\d+)[:x](\d+)$/);
          const width = Number(dimensions?.[1]);
          const height = Number(dimensions?.[2]);
          const scale = dimensions ? 22 / Math.max(width, height) : 0;
          return <button key={option.value} type="button" role="menuitemradio" aria-checked={selectedValue === option.value} aria-disabled={blocked} tabIndex={activeIndex === index ? 0 : -1}
            onFocus={() => setActiveIndex(index)} onClick={() => submit(option)}>
            {pending && selectedValue === option.value ? <CircleNotch size={28} className="media-overlay-export-spinner" aria-hidden="true" /> : dimensions ?
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x={(28 - width * scale) / 2} y={(28 - height * scale) / 2} width={width * scale} height={height * scale} /></svg>
              : <Crop size={28} aria-hidden="true" />}
            <span>{option.value === "auto" ? t("works.resizeAuto") : dimensions ? option.value.replace("x", " × ") : option.label}</span>
            {selectedValue === option.value ? <Check size={16} aria-hidden="true" /> : null}
          </button>;
        })}
        </div>
      </div> : null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="media-overlay-image-action"
        onClick={() => { if (!blocked) onToggle(); }}
        onKeyDown={(event) => {
          if (!blocked && !open && ["ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            onToggle();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "media-overlay-resize-menu" : undefined}
        aria-disabled={blocked}
        aria-busy={pending}
        title={t("works.adjustImageSizeHint")}
      >
        {pending ? <CircleNotch className="media-overlay-export-spinner" size={20} aria-hidden="true" /> : <Crop size={20} aria-hidden="true" />}
        <span className="media-overlay-image-action-label">{t("works.adjustImageSize")}<CaretDown className="media-overlay-image-action-chevron" size={12} aria-hidden="true" /></span>
      </button>
      {menu && menuTarget ? createPortal(menu, menuTarget) : menu}
      {feedbackTarget && !open && (pending || queued || error) ? createPortal(
        <div className="media-overlay-export-toast media-overlay-resize-feedback" role={error ? "alert" : "status"} data-error={!!error} data-overlay-scroll="allow">
          <span>{error ? t("works.resizeImageFailed", { message: error }) : t(queued ? "works.resizeQueued" : "works.editSubmitting")}</span>
          {error && selectedOption ? <button type="button" disabled={blocked} onClick={() => submit(selectedOption)}>{t("works.exportRetry")}</button> : null}
          {error ? <button type="button" aria-label={t("common.close")} onClick={() => {
            onDismissError();
            buttonRef.current?.focus({ preventScroll: true });
          }}><X size={18} aria-hidden="true" /></button> : null}
        </div>, feedbackTarget,
      ) : null}
    </>
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
