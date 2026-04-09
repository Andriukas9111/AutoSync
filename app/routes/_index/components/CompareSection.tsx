import { COMPARE_FEATURES } from "../data/website-content";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { Check, X } from "lucide-react";

export function CompareSection() {
  return (
    <section id="compare" className="tw-py-[clamp(100px,14vh,180px)]">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        {/* Header */}
        <div className="tw-text-center tw-mb-14 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            Comparison
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            Why stores choose AutoSync
          </h2>
        </div>

        {/* Side by side */}
        <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-6 tw-items-start tw-max-w-[900px] tw-mx-auto">
          {/* US */}
          <div className="tw-rounded-card tw-border-2 tw-border-accent tw-bg-white tw-p-9 tw-shadow-lg tw-shadow-accent/10">
            <div className="tw-font-heading tw-text-[22px] tw-font-bold tw-text-ink tw-mb-5 tw-flex tw-items-center tw-gap-2.5">
              <AutoSyncLogo size={20} className="tw-text-accent" />
              AutoSync
            </div>
            <div className="tw-flex tw-flex-col tw-gap-3">
              {COMPARE_FEATURES.map((f) => (
                <div key={f.key} className="tw-flex tw-items-center tw-gap-2.5 tw-text-sm tw-text-carbon">
                  <Check size={16} className="tw-text-accent tw-shrink-0" />
                  {f.label}
                </div>
              ))}
              <div className="tw-flex tw-items-center tw-gap-2.5 tw-text-sm tw-text-carbon">
                <Check size={16} className="tw-text-accent tw-shrink-0" />
                <strong>7</strong> storefront widgets
              </div>
              <div className="tw-flex tw-items-center tw-gap-2.5 tw-text-sm tw-text-carbon">
                <Check size={16} className="tw-text-accent tw-shrink-0" />
                Self-service setup in minutes
              </div>
            </div>
            <div className="tw-text-[13px] tw-text-slate tw-mt-4 tw-pt-4 tw-border-t tw-border-silver/40">
              Starting <strong className="tw-text-ink">Free</strong> — up to $299/mo
            </div>
          </div>

          {/* THEM */}
          <div className="tw-rounded-card tw-border tw-border-silver/60 tw-bg-snow tw-p-9">
            <div className="tw-font-heading tw-text-[22px] tw-font-bold tw-text-ink tw-mb-5">
              Other Solutions
            </div>
            <div className="tw-flex tw-flex-col tw-gap-3">
              {[
                "No pre-loaded database",
                "No auto extraction",
                "No smart collections",
                "No UK plate lookup",
                "No wheel finder",
                "No vehicle spec pages",
                "1-2 widgets only",
                "Requires support for setup",
              ].map((item) => (
                <div key={item} className="tw-flex tw-items-center tw-gap-2.5 tw-text-sm tw-text-slate/60">
                  <X size={16} className="tw-text-red-400 tw-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
            <div className="tw-text-[13px] tw-text-slate tw-mt-4 tw-pt-4 tw-border-t tw-border-silver/40">
              Starting at <strong className="tw-text-ink">$250/mo</strong> (Convermax)
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
