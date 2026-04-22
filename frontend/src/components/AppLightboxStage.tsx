import { useEffect, useMemo, useRef } from "react";
import Lightbox from "yet-another-react-lightbox";
import Inline from "yet-another-react-lightbox/plugins/inline";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import {
  mapLightboxItemsToSlides,
  type AppLightboxSlide,
  type ExpiredSlide,
  type FailedSlide,
  type LightboxMediaItem,
} from "../lightbox";
import type { VideoTaskDetail } from "../types";

interface Props {
  items: readonly LightboxMediaItem[];
  index: number;
  taskById: ReadonlyMap<string, VideoTaskDetail>;
  onIndexChange: (index: number) => void;
}

const PLUGINS = [Inline, Video, Zoom];
const NOOP = () => {};

export function AppLightboxStage(props: Props) {
  const { items, index, taskById, onIndexChange } = props;
  const { t } = useI18n();
  const slides = useMemo(() => mapLightboxItemsToSlides(items, taskById), [items, taskById]);

  if (!slides.length) {
    return null;
  }

  const safeIndex = Math.min(Math.max(index, 0), slides.length - 1);

  return (
    <div className="app-lightbox-stage h-full w-full" data-overlay-gesture="allow">
      <Lightbox
        open
        close={NOOP}
        index={safeIndex}
        slides={slides}
        plugins={PLUGINS}
        className="app-lightbox-stage__root"
        noScroll={{ disabled: true }}
        inline={{ className: "app-lightbox-stage__inline" }}
        carousel={{
          finite: false,
          preload: 1,
          padding: 0,
          spacing: "18px",
          imageFit: "contain",
        }}
        animation={{
          fade: 180,
          swipe: 260,
          navigation: 260,
          easing: {
            fade: "ease",
            swipe: "cubic-bezier(0.22, 1, 0.36, 1)",
            navigation: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
          zoom: 220,
        }}
        controller={{
          closeOnBackdropClick: false,
          closeOnPullDown: false,
          closeOnPullUp: false,
        }}
        toolbar={{ buttons: [] }}
        zoom={{
          maxZoomPixelRatio: 4,
          zoomInMultiplier: 2,
          doubleClickMaxStops: 2,
          pinchZoomV4: true,
          scrollToZoom: true,
        }}
        render={{
          slide: ({ slide, offset }) => {
            if (isFailedSlide(slide)) {
              return <PlaceholderSlideCard label={t("works.generationFailed")} />;
            }
            if (isExpiredSlide(slide)) {
              return <PlaceholderSlideCard label={t("works.resourceExpired")} />;
            }
            if (isVideoSlide(slide)) {
              return <ManagedVideoSlide slide={slide} isActive={offset === 0} />;
            }
            return undefined;
          },
          buttonPrev: () => null,
          buttonNext: () => null,
          buttonClose: () => null,
        }}
        styles={{
          root: {
            width: "100%",
            height: "100%",
          },
          container: {
            backgroundColor: "transparent",
          },
          slide: {
            padding: 0,
          },
        }}
        on={{
          view: ({ index: nextIndex }) => {
            if (nextIndex !== safeIndex) {
              onIndexChange(nextIndex);
            }
          },
        }}
      />
    </div>
  );
}

function isFailedSlide(slide: AppLightboxSlide): slide is FailedSlide {
  return slide.type === "failed";
}

function isExpiredSlide(slide: AppLightboxSlide): slide is ExpiredSlide {
  return slide.type === "expired";
}

function isVideoSlide(slide: AppLightboxSlide): slide is Extract<AppLightboxSlide, { type: "video" }> {
  return slide.type === "video";
}

function ManagedVideoSlide(props: {
  slide: Extract<AppLightboxSlide, { type: "video" }>;
  isActive: boolean;
}) {
  const { slide, isActive } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) {
      return;
    }
    if (isActive) {
      void node.play().catch(() => undefined);
      return;
    }
    releaseVideoNode(node);
  }, [isActive, slide.sources]);

  useEffect(() => {
    return () => {
      releaseVideoNode(videoRef.current);
    };
  }, []);

  if (!isActive) {
    return <VideoPosterFrame poster={slide.poster} />;
  }

  const source = slide.sources[0];
  if (!source) {
    return <VideoPosterFrame poster={slide.poster} />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <video
        ref={videoRef}
        key={source.src}
        className="h-full max-h-full w-full max-w-full object-contain"
        controls
        loop
        playsInline
        preload="metadata"
        poster={slide.poster}
      >
        <source src={source.src} type={source.type} />
      </video>
    </div>
  );
}

function VideoPosterFrame(props: { poster?: string }) {
  if (props.poster) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <img
          src={props.poster}
          alt=""
          className="h-full max-h-full w-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  return <PlaceholderSlideCard />;
}

function releaseVideoNode(node: HTMLVideoElement | null) {
  if (!node) {
    return;
  }
  node.pause();
  node.removeAttribute("src");
  const sourceNodes = node.querySelectorAll("source");
  sourceNodes.forEach((sourceNode) => {
    sourceNode.removeAttribute("src");
  });
  node.load();
}

function PlaceholderSlideCard(props: { label?: string }) {
  return (
    <div className="app-lightbox-stage__failed flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--c-text-secondary)]">
      <WarningCircle size={48} weight="thin" />
      {props.label ? <p className="m-0 text-sm font-medium">{props.label}</p> : null}
    </div>
  );
}
