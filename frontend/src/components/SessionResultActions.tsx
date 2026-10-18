import { ArrowClockwise, CaretLeft, Check, CircleNotch, Crop, DotsThree, DownloadSimple, Info, PencilSimple, Sparkle, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useOverlayScrollLock } from "../useMediaOverlay";

export type SessionImageAction = "edit" | "resize" | "highResolutionCandidate";

export function SessionResultActions(props: {
  images: string[];
  disabled: boolean;
  onDetails: () => void;
  onDelete: () => void;
  onCancel?: () => void;
  onDownload?: (imageIndex: number) => void;
  onRegenerate?: () => void;
  regeneratePending?: boolean;
  regenerateQueued?: boolean;
  downloadPending?: boolean;
  morePending?: boolean;
  onAdjustDescription?: () => void;
  reasonId?: string;
  reasonExpanded?: boolean;
  onToggleReason?: () => void;
  imageActions: SessionImageAction[];
  onImageAction?: (action: SessionImageAction, imageIndex: number) => void;
}) {
  const { images, disabled, onDetails, onDelete, onCancel, onDownload, onRegenerate, regeneratePending, regenerateQueued,
    downloadPending, morePending, onAdjustDescription, reasonId, reasonExpanded, onToggleReason, imageActions, onImageAction } = props;
  const { t } = useI18n();
  const downloadLabel = t(downloadPending ? "works.downloading" : "works.download");
  const regenerateLabel = t(regeneratePending ? "create.failure.submitting" : regenerateQueued ? "works.retryQueuedSticky" : "create.failure.regenerate");
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [imageAction, setImageAction] = useState<SessionImageAction | "download" | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [position, setPosition] = useState({ top: 0, right: 12 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setImageAction(null);
    const opener = openerRef.current;
    (opener && !opener.disabled ? opener : triggerRef.current)?.focus();
  };
  useOverlayScrollLock(open && compact);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = (openerRef.current ?? triggerRef.current)?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (trigger && panel) {
        setPosition({
          top: Math.max(12, trigger.top - panel.height - 8),
          right: Math.min(Math.max(12, window.innerWidth - trigger.right), Math.max(12, window.innerWidth - panel.width - 12)),
        });
      }
    };
    update();
    panelRef.current?.focus();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, imageAction, compact]);

  const runImageAction = (action: SessionImageAction | "download", index: number) => {
    close();
    if (action === "download") onDownload?.(index);
    else onImageAction?.(action, index);
  };
  const chooseImageAction = (action: SessionImageAction | "download") => {
    if (images.length > 1) {
      setImageAction(action);
      setOpen(true);
    } else {
      runImageAction(action, 0);
    }
  };

  return (
    <>
      {onDownload ? (
        <button type="button" className="session-result-more" aria-label={downloadLabel} title={downloadLabel}
          data-tooltip={downloadLabel} disabled={disabled} aria-busy={downloadPending || undefined}
          aria-haspopup={images.length > 1 ? "dialog" : undefined}
          aria-expanded={images.length > 1 ? open && imageAction === "download" : undefined}
          aria-controls={open && imageAction === "download" ? dialogId : undefined}
          onClick={(event) => { openerRef.current = event.currentTarget; chooseImageAction("download"); }}>
          {downloadPending ? <CircleNotch size={20} className="animate-spin" /> : <DownloadSimple size={20} />}
        </button>
      ) : null}
      {onRegenerate ? (
        <button type="button" className="session-result-more" aria-label={regenerateLabel}
          title={regenerateLabel} data-tooltip={regenerateLabel}
          disabled={disabled || regenerateQueued} aria-busy={regeneratePending || undefined} onClick={onRegenerate}>
          {regeneratePending ? <CircleNotch size={20} className="animate-spin" /> : regenerateQueued ? <Check size={20} /> : <ArrowClockwise size={20} />}
        </button>
      ) : null}
      {onAdjustDescription ? (
        <button type="button" className="session-result-more" aria-label={t("create.failure.adjustDescription")}
          title={t("create.failure.adjustDescription")} data-tooltip={t("create.failure.adjustDescription")}
          disabled={disabled} onClick={onAdjustDescription}><PencilSimple size={20} /></button>
      ) : null}
      {onToggleReason ? (
        <button type="button" className="session-result-more" aria-label={t(reasonExpanded ? "create.failure.hideReason" : "create.failure.viewReason")}
          title={t(reasonExpanded ? "create.failure.hideReason" : "create.failure.viewReason")}
          data-tooltip={t(reasonExpanded ? "create.failure.hideReason" : "create.failure.viewReason")}
          aria-expanded={reasonExpanded} aria-controls={reasonId} onClick={onToggleReason}><WarningCircle size={20} /></button>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className="session-result-more"
        aria-label={t("create.sessions.resultActions")}
        title={t("create.sessions.resultActions")}
        data-tooltip={t("create.sessions.resultActions")}
        aria-haspopup="dialog"
        aria-expanded={open && imageAction !== "download"}
        aria-controls={open && imageAction !== "download" ? dialogId : undefined}
        aria-busy={morePending || undefined}
        disabled={disabled}
        onClick={(event) => { openerRef.current = event.currentTarget; setImageAction(null); setOpen(true); }}
      >
        {morePending ? <CircleNotch size={20} className="animate-spin" /> : <DotsThree size={20} weight="regular" />}
      </button>
      {open ? createPortal(
        <div className={`session-result-menu-layer ${compact ? "session-result-menu-layer--compact" : ""}`}>
          <button type="button" className="session-result-menu-backdrop" aria-label={t("common.close")} tabIndex={-1} onClick={close} />
          <div
            id={dialogId}
            ref={panelRef}
            className="session-result-menu"
            style={compact ? undefined : position}
            role="dialog"
            aria-modal="true"
            aria-label={t(imageAction ? "create.sessions.chooseImage" : "create.sessions.resultActions")}
            tabIndex={-1}
            data-overlay-scroll="allow"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
              if (event.key === "Tab") {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                event.preventDefault();
                const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
                  : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            <div className="session-result-menu-heading">
              {imageAction ? (
                <button type="button" className="session-result-more" aria-label={t("works.back")} onClick={() => setImageAction(null)}>
                  <CaretLeft size={20} weight="regular" />
                </button>
              ) : null}
              <strong>{t(imageAction ? "create.sessions.chooseImage" : "create.sessions.resultActions")}</strong>
              <button type="button" className="session-result-more" aria-label={t("common.close")} onClick={close}>
                <X size={18} weight="regular" />
              </button>
            </div>
            {imageAction ? (
              <>
                <p className="session-result-menu-description">{t(imageAction === "download" ? "create.sessions.chooseDownloadHint" : imageAction === "highResolutionCandidate" ? "create.sessions.chooseHighResolutionImageHint" : "create.sessions.chooseImageHint")}</p>
                <div className="session-result-image-picker">
                  {images.map((url, index) => (
                    <button type="button" key={url} onClick={() => {
                      runImageAction(imageAction, index);
                    }}>
                      <img src={url} alt="" />
                      <span>{t("create.sessions.imageNumber", { number: index + 1 })}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button type="button" className="session-result-menu-item" onClick={() => { close(); onDetails(); }}>
                  <Info size={20} weight="regular" /><span>{t("works.details")}</span>
                </button>
                {onImageAction && imageActions.includes("edit") ? (
                <button type="button" className="session-result-menu-item" onClick={() => chooseImageAction("edit")}>
                  <PencilSimple size={20} weight="regular" /><span>{t("works.editImage")}</span>
                </button>
                ) : null}
                {onImageAction && imageActions.includes("resize") ? (
                <button type="button" className="session-result-menu-item" onClick={() => chooseImageAction("resize")}>
                  <Crop size={20} weight="regular" /><span>{t("works.adjustImageSize")}</span>
                </button>
                ) : null}
                {onImageAction && imageActions.includes("highResolutionCandidate") ? <button type="button" className="session-result-menu-item" onClick={() => chooseImageAction("highResolutionCandidate")}>
                  <Sparkle size={20} weight="regular" />
                  <span>{t("works.generateHighResolutionCandidate")}<small>{t("create.sessions.highResolutionHint")}</small></span>
                </button> : null}
                {onCancel ? <button type="button" className="session-result-menu-item" onClick={() => { close(); onCancel(); }}>
                  <X size={20} weight="regular" /><span>{t("works.cancelInProgress")}</span>
                </button> : null}
                <div className="session-result-menu-divider" role="separator" />
                <button type="button" className="session-result-menu-item" onClick={() => { close(); onDelete(); }}>
                  <Trash size={20} weight="regular" /><span>{t("works.delete")}</span>
                </button>
              </>
            )}
          </div>
        </div>, document.body,
      ) : null}
    </>
  );
}
