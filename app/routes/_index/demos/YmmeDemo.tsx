import { useState } from "react";
import { CAR_BRANDS } from "../data/website-content";
import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";
import { Search, ChevronDown } from "lucide-react";

export function YmmeDemo() {
  const [selected, setSelected] = useState(0);

  return (
    <div>
      <h3 className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-1">Select Your Vehicle</h3>
      <p className="tw-text-xs tw-text-slate/60 tw-mb-4">Choose a make to find compatible parts</p>

      {/* Brand grid */}
      <div className="tw-grid tw-grid-cols-5 tw-gap-2 tw-mb-4">
        {CAR_BRANDS.slice(0, 10).map((brand, i) => (
          <button
            key={brand.name}
            onClick={() => setSelected(i)}
            className={`tw-aspect-square tw-rounded-xl tw-border tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-p-2 tw-cursor-pointer tw-transition-all tw-duration-200 ${
              selected === i
                ? "tw-border-accent tw-bg-accent-soft"
                : "tw-border-silver/60 hover:tw-border-accent/40"
            }`}
          >
            <img src={brand.logo} alt={brand.name} className="tw-w-6 tw-h-6 tw-object-contain" />
            <span className="tw-text-[8px] tw-font-semibold tw-text-slate/60 tw-uppercase tw-tracking-[0.04em]">
              {brand.name}
            </span>
          </button>
        ))}
      </div>

      {/* Cascade selectors */}
      <div className="tw-flex tw-gap-1.5 tw-mb-3.5">
        {[
          { label: CAR_BRANDS[selected].name, active: true },
          { label: "3 Series", active: true },
          { label: "2022", active: true },
          { label: "Engine...", active: false },
        ].map((step) => (
          <div
            key={step.label}
            className={`tw-flex-1 tw-py-2 tw-px-3 tw-rounded-[10px] tw-border tw-text-[11px] tw-flex tw-items-center tw-justify-between ${
              step.active
                ? "tw-border-accent tw-text-accent tw-bg-accent-soft tw-font-semibold"
                : "tw-border-silver/60 tw-text-slate/50"
            }`}
          >
            <span>{step.label}</span>
            <ChevronDown size={10} />
          </div>
        ))}
      </div>

      {/* Search button */}
      <button className="tw-w-full tw-py-3.5 tw-rounded-xl tw-bg-accent tw-text-white tw-text-sm tw-font-semibold tw-flex tw-items-center tw-justify-center tw-gap-2 hover:tw-bg-accent-deep tw-transition-colors">
        <Search size={16} />
        Find Compatible Parts
      </button>

      <div className="tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-mt-4 tw-pt-3.5 tw-border-t tw-border-silver/30 tw-text-[10px] tw-text-slate/40">
        <AutoSyncLogo size={12} className="tw-text-slate/40" />
        Powered by AutoSync
      </div>
    </div>
  );
}
