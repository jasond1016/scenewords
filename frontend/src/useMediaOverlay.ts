import { useEffect, useLayoutEffect, useState } from "react";

export function readFavoriteTaskIds(storageKey: string): string[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function useCompactOverlayInfo(isOpen: boolean) {
  const [isInfoHidden, setIsInfoHidden] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsInfoHidden(false);
      return;
    }
    const prefersCompactInfo =
      typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
    setIsInfoHidden(prefersCompactInfo);
  }, [isOpen]);

  return { isInfoHidden, setIsInfoHidden };
}

export function useEscapeToClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);
}

export function useOverlayScrollLock(isOpen: boolean) {
  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevRootOverscrollBehavior = root.style.overscrollBehavior;
    const prevBodyOverscrollBehavior = body.style.overscrollBehavior;
    const allowScrollSelector = "[data-overlay-scroll='allow']";
    const allowGestureSelector = "[data-overlay-gesture='allow']";

    let lastTouchY: number | null = null;

    const findAllowedContainers = (target: EventTarget | null): HTMLElement[] => {
      if (!(target instanceof Element)) {
        return [];
      }

      const containers: HTMLElement[] = [];
      let current: Element | null = target;
      while (current) {
        if (current.matches(allowScrollSelector) && current instanceof HTMLElement) {
          containers.push(current);
        }
        current = current.parentElement;
      }
      return containers;
    };

    const isGestureTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) {
        return false;
      }
      return Boolean(target.closest(allowGestureSelector));
    };

    const canScrollContainer = (container: HTMLElement, deltaY: number): boolean => {
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      if (maxScrollTop <= 0) {
        return false;
      }
      const atTop = container.scrollTop <= 0;
      const atBottom = container.scrollTop >= maxScrollTop - 1;
      if (deltaY < 0 && atTop) {
        return false;
      }
      if (deltaY > 0 && atBottom) {
        return false;
      }
      return true;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!event.touches.length) {
        lastTouchY = null;
        return;
      }
      lastTouchY = event.touches[0].clientY;
    };
    const onTouchEnd = () => {
      lastTouchY = null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (isGestureTarget(event.target)) {
        return;
      }
      const containers = findAllowedContainers(event.target);
      if (!containers.length) {
        event.preventDefault();
        return;
      }
      const currentY = event.touches[0]?.clientY ?? lastTouchY ?? 0;
      const deltaY = currentY - (lastTouchY ?? currentY);
      lastTouchY = currentY;
      const intendedScrollDelta = -deltaY;
      const scrollContainer = containers.find((container) =>
        canScrollContainer(container, intendedScrollDelta),
      );
      if (!scrollContainer) {
        event.preventDefault();
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (isGestureTarget(event.target)) {
        return;
      }
      const containers = findAllowedContainers(event.target);
      if (!containers.length) {
        event.preventDefault();
        return;
      }
      const scrollContainer = containers.find((container) =>
        canScrollContainer(container, event.deltaY),
      );
      if (!scrollContainer) {
        event.preventDefault();
      }
    };

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "contain";
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("wheel", onWheel, true);
      root.style.overflow = prevRootOverflow;
      body.style.overflow = prevBodyOverflow;
      root.style.overscrollBehavior = prevRootOverscrollBehavior;
      body.style.overscrollBehavior = prevBodyOverscrollBehavior;
    };
  }, [isOpen]);
}
