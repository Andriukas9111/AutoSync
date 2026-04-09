import { useEffect, useRef } from "react";

let gsapModule: typeof import("gsap") | null = null;
let ScrollTriggerModule: any = null;
let registered = false;

async function loadGsap() {
  if (typeof window === "undefined") return null;
  if (gsapModule) return gsapModule.default;

  gsapModule = await import("gsap");
  ScrollTriggerModule = (await import("gsap/ScrollTrigger")).default;

  if (!registered) {
    gsapModule.default.registerPlugin(ScrollTriggerModule);
    registered = true;
  }

  return gsapModule.default;
}

/** GSAP ScrollTrigger reveal — fades elements up on scroll */
export function useScrollReveal(selector: string, options?: { stagger?: number; y?: number; duration?: number }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let ctx: any;

    loadGsap().then((gsap) => {
      if (!gsap) return;
      ctx = gsap.context(() => {
        gsap.utils.toArray<HTMLElement>(selector).forEach((el, i) => {
          gsap.fromTo(el,
            { opacity: 0, y: options?.y ?? 40 },
            {
              opacity: 1, y: 0,
              duration: options?.duration ?? 0.8,
              delay: (options?.stagger ?? 0.1) * i,
              ease: "power3.out",
              scrollTrigger: { trigger: el, start: "top 85%", toggleActions: "play none none none" },
            }
          );
        });
      });
    });

    return () => { ctx?.revert(); };
  }, [selector]);
}

/** GSAP parallax effect — element moves slower/faster than scroll */
export function useParallax(selector: string, speed: number = 0.3) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let ctx: any;

    loadGsap().then((gsap) => {
      if (!gsap) return;
      ctx = gsap.context(() => {
        gsap.to(selector, {
          yPercent: speed * 100,
          ease: "none",
          scrollTrigger: { trigger: selector, start: "top bottom", end: "bottom top", scrub: true },
        });
      });
    });

    return () => { ctx?.revert(); };
  }, [selector, speed]);
}

/** GSAP 3D tilt on scroll — rotates element as it enters viewport */
export function use3DTilt(ref: React.RefObject<HTMLElement | null>, options?: { rotateX?: number; rotateY?: number }) {
  useEffect(() => {
    if (typeof window === "undefined" || !ref.current) return;
    let ctx: any;

    loadGsap().then((gsap) => {
      if (!gsap || !ref.current) return;
      ctx = gsap.context(() => {
        gsap.fromTo(ref.current,
          { rotateX: options?.rotateX ?? 6, rotateY: options?.rotateY ?? -4, scale: 0.95 },
          {
            rotateX: 0, rotateY: 0, scale: 1,
            duration: 1.2,
            ease: "power2.out",
            scrollTrigger: { trigger: ref.current, start: "top 80%", end: "center center", scrub: 1 },
          }
        );
      });
    });

    return () => { ctx?.revert(); };
  }, [ref]);
}

/** GSAP staggered entrance — elements appear one after another */
export function useStaggerEntrance(containerRef: React.RefObject<HTMLElement | null>, childSelector: string) {
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;
    let ctx: any;

    loadGsap().then((gsap) => {
      if (!gsap || !containerRef.current) return;
      ctx = gsap.context(() => {
        gsap.fromTo(childSelector,
          { opacity: 0, y: 30 },
          {
            opacity: 1, y: 0,
            duration: 0.6,
            stagger: 0.08,
            ease: "power3.out",
            scrollTrigger: { trigger: containerRef.current, start: "top 80%" },
          }
        );
      }, containerRef);
    });

    return () => { ctx?.revert(); };
  }, [containerRef, childSelector]);
}

/** GSAP timeline line draw — animates a vertical line on scroll */
export function useTimelineDraw(lineRef: React.RefObject<HTMLElement | null>, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof window === "undefined" || !lineRef.current || !containerRef.current) return;
    let ctx: any;

    loadGsap().then((gsap) => {
      if (!gsap || !lineRef.current || !containerRef.current) return;
      ctx = gsap.context(() => {
        gsap.fromTo(lineRef.current,
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: "none",
            scrollTrigger: { trigger: containerRef.current, start: "top 70%", end: "bottom 70%", scrub: 1 },
          }
        );
      });
    });

    return () => { ctx?.revert(); };
  }, [lineRef, containerRef]);
}

export { loadGsap };
