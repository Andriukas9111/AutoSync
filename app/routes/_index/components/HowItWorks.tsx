import { useRef } from "react";
import { PIPELINE_STEPS } from "../data/website-content";
import { useTimelineDraw, useScrollReveal } from "../hooks/useGsap";

export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  useTimelineDraw(lineRef, containerRef);

  return (
    <section id="how-it-works" className="py-[clamp(100px,14vh,180px)]">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="text-center mb-14">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">How It Works</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">From install to sales in 4 steps</h2>
        </div>
        <div ref={containerRef} className="relative max-w-[700px] mx-auto pl-24">
          <div className="timeline-line-track left-10 top-0 bottom-0" />
          <div ref={lineRef} className="timeline-line-fill left-10 top-0 bottom-0" />
          {PIPELINE_STEPS.map((s, i) => (
            <div key={i} className="relative pb-16 last:pb-0">
              <div className="absolute -left-24 top-0 w-[72px] h-[72px] rounded-full bg-white border-2 border-silver/60 flex items-center justify-center shadow-card z-1">
                <span className="font-heading text-2xl font-extrabold text-accent">{s.number}</span>
              </div>
              <div className="pt-1">
                <h3 className="font-heading text-[22px] font-bold text-ink mb-2">{s.title}</h3>
                <p className="text-[15px] text-slate leading-relaxed">{s.description}</p>
                {s.duration && <span className="inline-flex mt-3 px-3 py-1 rounded-pill bg-snow border border-silver/40 text-xs font-medium text-slate/60">{s.duration}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
