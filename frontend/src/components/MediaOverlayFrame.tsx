import { ArrowsInSimple, ArrowsOutSimple, Info, X } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import {
  createContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

export const MediaOverlayFeedbackContext = createContext<HTMLElement | null>(null);

interface Props {
  onClose: () => void;
  media: ReactNode;
  sidebar?: ReactNode;
  topActions?: ReactNode;
  bottomActions?: ReactNode;
  isImage?: boolean;
  initialDetailsOpen?: boolean;
  closeLabel: string;
  detailsLabel: string;
  closeDetailsLabel: string;
  mediaToggleLabel: string;
}

export function MediaOverlayFrame(props: Props) {
  const { t } = useI18n();
  const {
    onClose,
    media,
    sidebar,
    topActions,
    bottomActions,
    isImage = false,
    closeLabel,
    detailsLabel,
    closeDetailsLabel,
    mediaToggleLabel,
  } = props;
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [isDetailsOpen, setIsDetailsOpen] = useState(props.initialDetailsOpen ?? false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [areActionsVisible, setAreActionsVisible] = useState(true);
  const [feedbackTarget, setFeedbackTarget] = useState<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isPullingDownRef = useRef(false);
  const closeAfterPullTimerRef = useRef<number | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout || !feedbackTarget) return;
    const actions = layout.querySelector<HTMLElement>(".media-overlay-bottom-actions");
    const details = layout.querySelector<HTMLElement>(".media-overlay-sidebar");
    const main = layout.querySelector<HTMLElement>(".media-overlay-main")!;
    const positionFeedback = () => {
      const bounds = layout.getBoundingClientRect();
      const media = main.getBoundingClientRect();
      const viewport = window.visualViewport;
      let anchor = Math.min(bounds.bottom, viewport ? viewport.height + viewport.offsetTop : innerHeight) - 16;
      for (const obstacle of [actions, isMobileViewport ? details : null]) {
        if (!obstacle || getComputedStyle(obstacle).display === "none" || getComputedStyle(obstacle).visibility === "hidden") continue;
        anchor = Math.min(anchor, obstacle.getBoundingClientRect().top - 12);
      }
      const close = layout.querySelector<HTMLElement>(".media-overlay-close")!;
      const top = Math.max(close.getBoundingClientRect().bottom + 12, anchor - feedbackTarget.offsetHeight);
      feedbackTarget.style.top = `${top - bounds.top}px`;
      feedbackTarget.style.left = `${media.left - bounds.left + 12}px`;
      feedbackTarget.style.width = `${Math.max(0, media.width - 24)}px`;
    };
    const observer = new ResizeObserver(positionFeedback);
    for (const element of [layout, main, actions, details, feedbackTarget]) {
      if (element) observer.observe(element);
    }
    positionFeedback();
    window.visualViewport?.addEventListener("resize", positionFeedback);
    window.visualViewport?.addEventListener("scroll", positionFeedback);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", positionFeedback);
      window.visualViewport?.removeEventListener("scroll", positionFeedback);
    };
  }, [feedbackTarget, isMobileViewport, isDetailsOpen, isDetailsExpanded, areActionsVisible]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const layout = layoutRef.current;
    if (!viewport || !layout) return;
    const updateViewport = () => {
      layout.style.setProperty("--overlay-viewport-height", `${viewport.height}px`);
      layout.style.setProperty("--overlay-keyboard-offset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
      setIsDetailsOpen(false);
      setIsDetailsExpanded(false);
      setAreActionsVisible(true);
    };
    mediaQuery.addEventListener("change", handleViewportChange);
    return () => {
      mediaQuery.removeEventListener("change", handleViewportChange);
      if (closeAfterPullTimerRef.current !== null) {
        window.clearTimeout(closeAfterPullTimerRef.current);
      }
    };
  }, []);

  const handleMediaClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button,a,input,textarea,select,summary,details,video")) {
      return;
    }
    if (isImage && isMobileViewport) {
      setAreActionsVisible((visible) => !visible);
    }
  };

  const handleMediaKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (isImage && isMobileViewport) {
      setAreActionsVisible((visible) => !visible);
    }
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const target = event.target;
    const touch = event.touches[0];
    if (
      !touch ||
      event.touches.length !== 1 ||
      (target instanceof Element &&
        target.closest("button,a,input,textarea,select,summary,details,video,[data-overlay-scroll=\"allow\"]"))
    ) {
      touchStartRef.current = null;
      isPullingDownRef.current = false;
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    isPullingDownRef.current = false;
    if (closeAfterPullTimerRef.current !== null) {
      window.clearTimeout(closeAfterPullTimerRef.current);
      closeAfterPullTimerRef.current = null;
    }
    if (layoutRef.current) {
      layoutRef.current.style.transition = "none";
    }
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || event.touches.length !== 1 || !touch) {
      return;
    }

    const deltaX = Math.abs(touch.clientX - start.x);
    const deltaY = touch.clientY - start.y;
    if (!isPullingDownRef.current) {
      if (deltaY < 10 || deltaY < deltaX * 1.25) {
        return;
      }
      isPullingDownRef.current = true;
    }

    const layout = layoutRef.current;
    if (!layout) {
      return;
    }
    const pullDistance = Math.max(0, deltaY);
    layout.style.transform = `translate3d(0, ${pullDistance}px, 0)`;
    layout.style.opacity = `${Math.max(0.45, 1 - pullDistance / 180)}`;
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const wasPullingDown = isPullingDownRef.current;
    touchStartRef.current = null;
    isPullingDownRef.current = false;
    const touch = event.changedTouches[0];
    if (!start || !touch || !wasPullingDown) {
      return;
    }
    const deltaY = touch.clientY - start.y;
    const deltaX = Math.abs(touch.clientX - start.x);
    const layout = layoutRef.current;
    const animation = getPullAnimation();
    if (deltaY >= 90 && deltaY >= deltaX * 1.25) {
      if (!layout) {
        onClose();
        return;
      }
      layout.style.transition = animation.transition;
      layout.style.transform = `translate3d(0, ${window.innerHeight}px, 0)`;
      layout.style.opacity = "0";
      closeAfterPullTimerRef.current = window.setTimeout(() => {
        closeAfterPullTimerRef.current = null;
        onClose();
      }, animation.duration);
      return;
    }

    if (layout) {
      layout.style.transition = animation.transition;
      layout.style.transform = "translate3d(0, 0, 0)";
      layout.style.opacity = "1";
    }
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
    isPullingDownRef.current = false;
    const layout = layoutRef.current;
    if (layout) {
      layout.style.transition = getPullAnimation().transition;
      layout.style.transform = "translate3d(0, 0, 0)";
      layout.style.opacity = "1";
    }
  };

  return (
    <MediaOverlayFeedbackContext.Provider value={feedbackTarget}>
    <div
      className="media-overlay-frame fixed inset-0 z-50 h-dvh"
      role="dialog"
      aria-modal="true"
      onTouchStartCapture={handleTouchStart}
      onTouchMoveCapture={handleTouchMove}
      onTouchEndCapture={handleTouchEnd}
      onTouchCancelCapture={handleTouchCancel}
    >
      <div
        ref={layoutRef}
        className={`media-overlay-layout relative grid h-full w-full min-w-0 grid-cols-1 ${
          sidebar && isDetailsOpen ? "media-overlay-layout--with-sidebar" : ""
        }`}
        style={
          sidebar && isDetailsOpen && !isMobileViewport
            ? { gridTemplateColumns: "minmax(0, 1fr) 360px" }
            : undefined
        }
        data-details-open={isDetailsOpen}
        data-details-expanded={isDetailsExpanded}
        data-mobile-viewport={isMobileViewport}
        data-actions-visible={areActionsVisible || !isMobileViewport}
        data-android-device={isAndroidDevice}
      >
        <div className="media-overlay-main relative flex min-w-0 flex-1 flex-col">
          <div
            className="media-overlay-canvas relative flex min-h-0 flex-1 items-center justify-center bg-transparent"
            onClick={handleMediaClick}
            onKeyDown={handleMediaKeyDown}
            role={isImage ? "group" : undefined}
            tabIndex={isImage ? 0 : undefined}
            aria-label={isImage ? mediaToggleLabel : undefined}
          >
            <div className="media-overlay-media flex h-full w-full items-center justify-center">
              {media}
            </div>
          </div>
        </div>
        {sidebar ? (
          <aside className="media-overlay-sidebar min-h-0 overflow-hidden">
            <div className="media-overlay-sidebar-header">
              <strong>{detailsLabel}</strong>
              {isMobileViewport ? <button type="button" className="media-detail-icon"
                aria-label={t(isDetailsExpanded ? "works.detail.compactPanel" : "works.detail.expandPanel")}
                aria-expanded={isDetailsExpanded} onClick={() => setIsDetailsExpanded((expanded) => !expanded)}>
                {isDetailsExpanded ? <ArrowsInSimple size={18} weight="regular" /> : <ArrowsOutSimple size={18} weight="regular" />}
              </button> : null}
              <button
                type="button"
                className="media-detail-icon"
                aria-label={closeDetailsLabel}
                onClick={() => setIsDetailsOpen(false)}
              >
                <X size={16} weight="regular" />
              </button>
            </div>
            <div className="media-overlay-sidebar-scroll" data-overlay-scroll="allow" tabIndex={0} aria-label={detailsLabel}>
              {sidebar}
            </div>
          </aside>
        ) : null}
        {sidebar ? (
          <button
            type="button"
            className="media-overlay-icon-button media-overlay-details-toggle"
            aria-expanded={isDetailsOpen}
            aria-label={detailsLabel}
            title={detailsLabel}
            onClick={() => setIsDetailsOpen((open) => !open)}
          >
            <Info size={22} weight="regular" />
          </button>
        ) : null}
        <button
          type="button"
          className="media-overlay-icon-button media-overlay-close"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <X size={22} weight="regular" />
        </button>
        {topActions ? <div className="media-overlay-top-actions">{topActions}</div> : null}
        {bottomActions ? <div className="media-overlay-bottom-actions" data-overlay-scroll="allow">{bottomActions}</div> : null}
        <div ref={setFeedbackTarget} className="media-overlay-feedback" aria-live="polite" aria-atomic="true" />
      </div>
    </div>
    </MediaOverlayFeedbackContext.Provider>
  );
}

function getPullAnimation() {
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
  return {
    duration,
    transition:
      duration === 0
        ? "none"
        : `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${duration}ms ease`,
  };
}
