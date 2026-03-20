import { useMemo } from "react";
import Lightbox from "yet-another-react-lightbox";
import Inline from "yet-another-react-lightbox/plugins/inline";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import {
  mapLightboxItemsToSlides,
  type AppLightboxSlide,
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
        video={{
          autoPlay: true,
          controls: true,
          loop: true,
          playsInline: true,
          preload: "metadata",
        }}
        zoom={{
          maxZoomPixelRatio: 4,
          zoomInMultiplier: 2,
          doubleClickMaxStops: 2,
          pinchZoomV4: true,
          scrollToZoom: true,
        }}
        render={{
          slide: ({ slide }) => (isFailedSlide(slide) ? <FailedSlideCard label={t("jobs.generationFailed")} /> : undefined),
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

function FailedSlideCard(props: { label: string }) {
  return (
    <div className="app-lightbox-stage__failed flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--c-text-secondary)]">
      <WarningCircle size={48} weight="thin" />
      <p className="m-0 text-sm font-medium">{props.label}</p>
    </div>
  );
}
