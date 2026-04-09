import { useRef } from "react";
import { PIPELINE_STEPS } from "../data/website-content";
import { useTimelineDraw, useScrollReveal } from "../hooks/useGsap";

export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useTimelineDraw(lineRef, containerRef);
  useScrollReveal(".timeline-step", { stagger: 0.15, y: 30 });

  return (
    <section id="how-it-works" className="tw-py-[clamp(100px,14vh,180px)]">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        {/* Header */}
        <div className="tw-text-center tw-mb-14 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            How It Works
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            From install to sales in 4 steps
          </h2>
        </div>

        {/* Vertical timeline */}
        <div ref={containerRef} className="tw-relative tw-max-w-[700px] tw-mx-auto tw-pl-20 md:tw-pl-24">
          {/* Line track (gray) */}
          <div className="tw-absolute tw-left-8 md:tw-left-10 tw-top-0 tw-bottom-0 tw-w-[2px] tw-bg-silver/60" />
          {/* Line fill (animated blue→purple) */}
          <div
            ref={lineRef}
            className="tw-absolute tw-left-8 md:tw-left-10 tw-top-0 tw-bottom-0 tw-w-[2px] tw-origin-top"
            style={{
              background: "linear-gradient(180deg, #0099FF, #6B52D9)",
              transformOrigin: "top center",
              transform: "scaleY(0)",
            }}
          />

          {/* Steps */}
          {PIPELINE_STEPS.map((step, i) => (
            <div
              key={i}
              className="timeline-step tw-relative tw-pb-16 last:tw-pb-0"
            >
              {/* Number circle */}
              <div className="tw-absolute tw--left-20 md:tw--left-24 tw-top-0 tw-w-16 tw-h-16 md:tw-w-[72px] md:tw-h-[72px] tw-rounded-full tw-bg-white tw-border-2 tw-border-silver/60 tw-flex tw-items-center tw-justify-center tw-shadow-sm tw-z-10">
                <span className="tw-font-heading tw-text-xl md:tw-text-2xl tw-font-extrabold tw-text-accent">
                  {step.number}
                </span>
              </div>

              {/* Content */}
              <div className="tw-pt-1">
                <h3 className="tw-font-heading tw-text-xl md:tw-text-[22px] tw-font-bold tw-text-ink tw-mb-2">
                  {step.title}
                </h3>
                <p className="tw-text-[15px] tw-text-slate tw-leading-relaxed">
                  {step.description}
                </p>
                {step.duration && (
                  <span className="tw-inline-flex tw-mt-3 tw-px-3 tw-py-1 tw-rounded-pill tw-bg-snow tw-border tw-border-silver/40 tw-text-xs tw-font-medium tw-text-slate/60">
                    {step.duration}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
