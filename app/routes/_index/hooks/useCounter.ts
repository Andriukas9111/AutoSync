import { useState, useEffect, useRef } from "react";

export function useCounter(end: number) {
  const dur = end > 1000 ? 1400 : 1000;
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !ran.current) {
          ran.current = true;
          const t0 = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - t0) / dur, 1);
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -14 * progress);
            setValue(Math.floor(eased * end));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.15 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [end, dur]);

  return { value, ref };
}
