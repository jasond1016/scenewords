import { useEffect, useMemo, useRef, useState } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 300;

interface Point {
  x: number;
  y: number;
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
}

interface GestureState {
  scale: number;
  tx: number;
  ty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function mapToCenterRelativePoint(container: HTMLDivElement, point: Point): Point {
  const rect = container.getBoundingClientRect();
  return {
    x: point.x - (rect.left + rect.width / 2),
    y: point.y - (rect.top + rect.height / 2),
  };
}

function applyZoomAroundFocalPoint(
  gesture: GestureState,
  focalPoint: Point,
  requestedScale: number,
): GestureState {
  const nextScale = clamp(requestedScale, MIN_SCALE, MAX_SCALE);
  if (Math.abs(nextScale - gesture.scale) < 0.0001) {
    return gesture;
  }
  if (nextScale <= MIN_SCALE) {
    return { scale: MIN_SCALE, tx: 0, ty: 0 };
  }
  const ratio = nextScale / gesture.scale;
  return {
    scale: nextScale,
    tx: focalPoint.x - ratio * (focalPoint.x - gesture.tx),
    ty: focalPoint.y - ratio * (focalPoint.y - gesture.ty),
  };
}

function clampTranslation(
  container: HTMLDivElement | null,
  image: HTMLImageElement | null,
  gesture: GestureState,
): GestureState {
  if (!container || !image) {
    return gesture;
  }
  if (gesture.scale <= MIN_SCALE) {
    return { scale: MIN_SCALE, tx: 0, ty: 0 };
  }
  const viewportWidth = container.clientWidth;
  const viewportHeight = container.clientHeight;
  const imageWidth = image.offsetWidth;
  const imageHeight = image.offsetHeight;
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return gesture;
  }
  const maxX = Math.max(0, (imageWidth * gesture.scale - viewportWidth) / 2);
  const maxY = Math.max(0, (imageHeight * gesture.scale - viewportHeight) / 2);
  return {
    ...gesture,
    tx: clamp(gesture.tx, -maxX, maxX),
    ty: clamp(gesture.ty, -maxY, maxY),
  };
}

export function ZoomableImage(props: ZoomableImageProps) {
  const { src, alt, className } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [gesture, setGesture] = useState<GestureState>({ scale: MIN_SCALE, tx: 0, ty: 0 });
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const pinchStartRef = useRef<{
    distance: number;
    midpoint: Point;
    origin: GestureState;
  } | null>(null);
  const panAnchorRef = useRef<{
    pointerId: number;
    startPoint: Point;
    origin: GestureState;
  } | null>(null);
  const tapRef = useRef<{ at: number; point: Point } | null>(null);
  const suppressDoubleClickUntilRef = useRef(0);

  const canPan = gesture.scale > MIN_SCALE + 0.001;

  const resetGesture = () => {
    setGesture({ scale: MIN_SCALE, tx: 0, ty: 0 });
    pointersRef.current.clear();
    pinchStartRef.current = null;
    panAnchorRef.current = null;
    tapRef.current = null;
  };

  useEffect(() => {
    resetGesture();
  }, [src]);

  useEffect(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) {
      return;
    }

    const recalc = () => {
      setGesture((current) => clampTranslation(container, image, current));
    };

    const resizeObserver = new ResizeObserver(recalc);
    resizeObserver.observe(container);
    resizeObserver.observe(image);
    window.addEventListener("resize", recalc);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, []);

  const commitGesture = (next: GestureState) => {
    setGesture(() => clampTranslation(containerRef.current, imageRef.current, next));
  };

  const toggleDoubleTapZoom = (clientPoint: Point) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const focalPoint = mapToCenterRelativePoint(container, clientPoint);
    if (gesture.scale <= 1.01) {
      commitGesture(applyZoomAroundFocalPoint(gesture, focalPoint, 2));
      return;
    }
    commitGesture({ scale: MIN_SCALE, tx: 0, ty: 0 });
  };

  const transformStyle = useMemo(
    () => ({
      transform: `translate3d(${gesture.tx}px, ${gesture.ty}px, 0) scale(${gesture.scale})`,
      transformOrigin: "center center",
      willChange: "transform",
      cursor: canPan ? "grab" : "zoom-in",
    }),
    [canPan, gesture.scale, gesture.tx, gesture.ty],
  );

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const focalPoint = mapToCenterRelativePoint(container, { x: event.clientX, y: event.clientY });
    const factor = Math.exp(-event.deltaY * 0.0015);
    commitGesture(applyZoomAroundFocalPoint(gesture, focalPoint, gesture.scale * factor));
  };

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);

    if (event.pointerType === "touch") {
      const previousTap = tapRef.current;
      const now = Date.now();
      if (
        pointersRef.current.size === 1 &&
        previousTap &&
        now - previousTap.at <= DOUBLE_TAP_MS &&
        distance(previousTap.point, point) < 24
      ) {
        suppressDoubleClickUntilRef.current = now + 500;
        toggleDoubleTapZoom(point);
        tapRef.current = null;
        return;
      } else if (pointersRef.current.size === 1) {
        tapRef.current = { at: now, point };
      }
    }

    if (pointersRef.current.size >= 2) {
      const points = Array.from(pointersRef.current.values());
      const first = points[0];
      const second = points[1];
      pinchStartRef.current = {
        distance: Math.max(1, distance(first, second)),
        midpoint: midpoint(first, second),
        origin: gesture,
      };
      panAnchorRef.current = null;
      return;
    }

    if (gesture.scale > MIN_SCALE + 0.001) {
      panAnchorRef.current = {
        pointerId: event.pointerId,
        startPoint: point,
        origin: gesture,
      };
    }
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);

    if (pointersRef.current.size >= 2) {
      const points = Array.from(pointersRef.current.values());
      const first = points[0];
      const second = points[1];
      const start = pinchStartRef.current;
      if (!start) {
        return;
      }
      const currentDistance = Math.max(1, distance(first, second));
      const scaleFactor = currentDistance / start.distance;
      const requestedScale = start.origin.scale * scaleFactor;

      const currentMidpoint = midpoint(first, second);
      const moveDelta = {
        x: currentMidpoint.x - start.midpoint.x,
        y: currentMidpoint.y - start.midpoint.y,
      };
      const baseGesture: GestureState = {
        scale: start.origin.scale,
        tx: start.origin.tx + moveDelta.x,
        ty: start.origin.ty + moveDelta.y,
      };
      const focalPoint = mapToCenterRelativePoint(container, currentMidpoint);
      commitGesture(applyZoomAroundFocalPoint(baseGesture, focalPoint, requestedScale));
      return;
    }

    const panAnchor = panAnchorRef.current;
    if (!panAnchor || panAnchor.pointerId !== event.pointerId || !canPan) {
      return;
    }
    event.preventDefault();
    const delta = {
      x: point.x - panAnchor.startPoint.x,
      y: point.y - panAnchor.startPoint.y,
    };
    commitGesture({
      scale: panAnchor.origin.scale,
      tx: panAnchor.origin.tx + delta.x,
      ty: panAnchor.origin.ty + delta.y,
    });
  };

  const finishPointer = (pointerId: number, point?: Point) => {
    pointersRef.current.delete(pointerId);
    if (point) {
      tapRef.current = { at: Date.now(), point };
    }
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    const panAnchor = panAnchorRef.current;
    if (panAnchor?.pointerId === pointerId) {
      panAnchorRef.current = null;
    }
    if (pointersRef.current.size === 1 && gesture.scale > MIN_SCALE + 0.001) {
      const [remainingId, remainingPoint] = Array.from(pointersRef.current.entries())[0];
      panAnchorRef.current = {
        pointerId: remainingId,
        startPoint: remainingPoint,
        origin: gesture,
      };
    }
  };

  const onPointerUp: React.PointerEventHandler<HTMLDivElement> = (event) => {
    finishPointer(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onPointerCancel: React.PointerEventHandler<HTMLDivElement> = (event) => {
    finishPointer(event.pointerId);
  };

  const onDoubleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (Date.now() < suppressDoubleClickUntilRef.current) {
      return;
    }
    event.preventDefault();
    toggleDoubleTapZoom({ x: event.clientX, y: event.clientY });
  };

  const onImageLoad = () => {
    setGesture((current) => clampTranslation(containerRef.current, imageRef.current, current));
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      data-overlay-gesture="allow"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      style={{ touchAction: "none" }}
    >
      <img
        ref={imageRef}
        className={className}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={onImageLoad}
        style={transformStyle}
      />
    </div>
  );
}
