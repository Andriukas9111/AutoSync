import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";
import { Search } from "lucide-react";

const WHEEL_SPECS = [
  { label: "PCD (Bolt Pattern)", value: "5×120", unit: "mm" },
  { label: "Diameter", value: "19", unit: "inch" },
  { label: "Width", value: "8.5", unit: "J" },
  { label: "Offset", value: "ET35", unit: "mm" },
];

export function WheelDemo() {
  return (
    <div>
      <h3 className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-1">Wheel Finder</h3>
      <p className="tw-text-xs tw-text-slate/60 tw-mb-4">Search by bolt pattern, diameter, width, offset</p>

      <div className="tw-grid tw-grid-cols-2 tw-gap-2.5 tw-mb-3.5">
        {WHEEL_SPECS.map((spec) => (
          <div key={spec.label} className="tw-p-3.5 tw-rounded-xl tw-border tw-border-silver/60 tw-bg-white">
            <div className="tw-text-[10px] tw-font-semibold tw-text-slate/50 tw-uppercase tw-tracking-[0.05em] tw-mb-1.5">
              {spec.label}
            </div>
            <div className="tw-font-heading tw-text-xl tw-font-bold tw-text-ink">
              {spec.value}
              <span className="tw-text-xs tw-text-slate/50 tw-font-normal tw-ml-1">{spec.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="tw-w-full tw-py-3.5 tw-rounded-xl tw-bg-accent tw-text-white tw-text-sm tw-font-semibold tw-flex tw-items-center tw-justify-center tw-gap-2 hover:tw-bg-accent-deep tw-transition-colors">
        <Search size={16} />
        Find Matching Wheels
      </button>

      <div className="tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-mt-4 tw-pt-3.5 tw-border-t tw-border-silver/30 tw-text-[10px] tw-text-slate/40">
        <AutoSyncLogo size={12} className="tw-text-slate/40" />
        Powered by AutoSync
      </div>
    </div>
  );
}
