import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * IntersectionObserver-based scroll entry animation.
 * Returns a ref to attach to the element and a `visible` boolean.
 * Once visible, stays visible (no exit animation).
 */
export function useScrollEntry<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit,
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.08,
        ...options,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, options]);

  return [ref, visible];
}

/**
 * Wrapper component for fade-slide-up entry animation.
 * Uses custom spring-like cubic-bezier for premium feel.
 */
export function ScrollReveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const [ref, visible] = useScrollEntry<HTMLDivElement>();

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 700ms cubic-bezier(0.32, 0.72, 0, 1) ${delay}ms, transform 700ms cubic-bezier(0.32, 0.72, 0, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
