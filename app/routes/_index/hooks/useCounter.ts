import { useState, useEffect, useRef } from "react";

/** Animated number counter that starts when element scrolls into view */
export function useCounter(end: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const t0 = performance.now();

          const tick = (now: number) => {
            const progress = Math.min((now - t0) / duration, 1);
            // Exponential ease-out for satisfying deceleration
            const eased = 1 - Math.pow(2, -14 * progress);
            setValue(Math.floor(eased * end));
            if (progress < 1) requestAnimationFrame(tick);
          };

          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return { value, ref };
}
