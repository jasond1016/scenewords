import { ArrowClockwise, CaretLeft, Crop, DotsThree, PencilSimple, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useOverlayScrollLock } from "../useMediaOverlay";

export type SessionImageAction = "edit" | "resize" | "highResolutionCandidate";

export function SessionResultActions(props: {
  images: string[];
  disabled: boolean;
  onRegenerate: () => void;
  onImageAction: (action: SessionImageAction, imageIndex: number) => void;
}) {
  const { images, disabled, onRegenerate, onImageAction } = props;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [imageAction, setImageAction] = useState<SessionImageAction | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [position, setPosition] = useState({ top: 0, right: 12 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setImageAction(null);
    triggerRef.current?.focus();
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
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (trigger && panel) {
        setPosition({
          top: Math.max(12, trigger.top - panel.height - 8),
          right: Math.max(12, window.innerWidth - trigger.right),
        });
      }
    };
    update();
    panelRef.current?.focus();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, imageAction, compact]);

  const chooseImageAction = (action: SessionImageAction) => {
    if (images.length > 1) {
      setImageAction(action);
    } else {
      close();
      onImageAction(action, 0);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="session-result-more"
        aria-label={t("create.sessions.resultActions")}
        title={t("create.sessions.resultActions")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <DotsThree size={24} weight="regular" />
      </button>
      {open ? createPortal(
        <div className={`session-result-menu-layer ${compact ? "session-result-menu-layer--compact" : ""}`}>
          <button type="button" className="session-result-menu-backdrop" aria-label={t("common.close")} tabIndex={-1} onClick={close} />
          <div
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
                <p className="session-result-menu-description">{t(imageAction === "highResolutionCandidate" ? "create.sessions.chooseHighResolutionImageHint" : "create.sessions.chooseImageHint")}</p>
                <div className="session-result-image-picker">
                  {images.map((url, index) => (
                    <button type="button" key={url} onClick={() => {
                      close();
                      onImageAction(imageAction, index);
                    }}>
                      <img src={url} alt="" />
                      <span>{t("create.sessions.imageNumber", { number: index + 1 })}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button type="button" className="session-result-menu-item" onClick={() => chooseImageAction("edit")}>
                  <PencilSimple size={20} weight="regular" /><span>{t("works.editImage")}…</span>
                </button>
                <button type="button" className="session-result-menu-item" onClick={() => chooseImageAction("resize")}>
                  <Crop size={20} weight="regular" /><span>{t("works.adjustImageSize")}…</span>
                </button>
                <div className="session-result-menu-divider" role="separator" />
                <button type="button" className="session-result-menu-item" onClick={() => { close(); onRegenerate(); }}>
                  <ArrowClockwise size={20} weight="regular" />
                  <span>{t("works.regenerate")}<small>{t("create.sessions.regenerateRequest")}</small></span>
                </button>
                <button type="button" className="session-result-menu-item" onClick={() => chooseImageAction("highResolutionCandidate")}>
                  <Sparkle size={20} weight="regular" />
                  <span>{t("works.generateHighResolutionCandidate")}<small>{t("create.sessions.highResolutionHint")}</small></span>
                </button>
              </>
            )}
          </div>
        </div>, document.body,
      ) : null}
    </>
  );
}
