import { useRef } from "react";
import { SYSTEMS } from "../data/website-content";
import { useStaggerEntrance } from "../hooks/useGsap";
import { Cpu, Database, FolderOpen, Blocks, Upload, FileText, Zap, DollarSign } from "lucide-react";

const ICONS = [Cpu, Database, FolderOpen, Blocks, Upload, FileText, Zap, DollarSign];

export function SystemsCarousel() {
  const containerRef = useRef<HTMLDivElement>(null);
  useStaggerEntrance(containerRef, ".system-card");

  return (
    <section className="tw-py-[clamp(100px,14vh,180px)] tw-bg-snow">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        <div className="tw-mb-12 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            Platform
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            8 integrated systems
          </h2>
          <p className="tw-text-[17px] tw-text-slate tw-leading-[1.7] tw-mt-3 tw-max-w-[520px]">
            A complete platform where every system works together seamlessly.
          </p>
        </div>
      </div>

      {/* Horizontal scroll */}
      <div className="tw-pl-6 md:tw-pl-10 tw-pr-0">
        <div
          ref={containerRef}
          className="tw-flex tw-gap-4 tw-overflow-x-auto tw-pb-4 tw-snap-x tw-snap-mandatory"
          style={{ scrollbarWidth: "thin", WebkitOverflowScrolling: "touch" }}
        >
          {SYSTEMS.map((sys, i) => {
            const Icon = ICONS[i % ICONS.length];
            const statKey = Object.keys(sys.stats)[0] as keyof typeof sys.stats;
            return (
              <div
                key={sys.id}
                className="system-card tw-flex-none tw-w-[300px] tw-p-8 tw-rounded-card tw-border tw-border-silver/60 tw-bg-white tw-shadow-sm tw-snap-start hover:tw-shadow-md hover:tw--translate-y-1 tw-transition-all tw-duration-300"
              >
                <div className="tw-w-10 tw-h-10 tw-rounded-xl tw-bg-accent-soft tw-flex tw-items-center tw-justify-center tw-mb-4">
                  <Icon size={20} className="tw-text-accent" />
                </div>
                <h3 className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-2">{sys.name}</h3>
                <p className="tw-text-sm tw-text-slate tw-leading-relaxed tw-mb-4">
                  {sys.highlights[0]}
                </p>
                <span className="tw-inline-flex tw-px-3 tw-py-1 tw-rounded-pill tw-bg-accent-soft tw-text-accent tw-text-xs tw-font-semibold">
                  {sys.stats[statKey]}
                </span>
              </div>
            );
          })}
          {/* Spacer at end for last card visibility */}
          <div className="tw-flex-none tw-w-10" />
        </div>
      </div>
    </section>
  );
}
