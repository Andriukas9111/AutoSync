import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";
import { Check, X } from "lucide-react";
import { CAR_BRANDS } from "../data/website-content";

export function BadgeDemo() {
  return (
    <div className="tw-text-center">
      <h3 className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-1">Fitment Badge</h3>
      <p className="tw-text-xs tw-text-slate/60 tw-mb-4">Real-time compatibility on every product page</p>

      {/* Fits badge */}
      <div className="tw-flex tw-items-center tw-justify-center tw-gap-2.5 tw-p-4 tw-rounded-xl tw-bg-green-500/5 tw-text-green-600 tw-border tw-border-green-500/10 tw-text-[15px] tw-font-semibold tw-mb-2.5">
        <Check size={20} strokeWidth={2.5} />
        Fits your 2022 BMW 3 Series
      </div>

      {/* Doesn't fit badge */}
      <div className="tw-flex tw-items-center tw-justify-center tw-gap-2.5 tw-p-4 tw-rounded-xl tw-bg-red-500/5 tw-text-red-600 tw-border tw-border-red-500/10 tw-text-[15px] tw-font-semibold tw-mb-4">
        <X size={20} strokeWidth={2.5} />
        May not fit your vehicle
      </div>

      {/* Vehicle cards */}
      <div className="tw-grid tw-grid-cols-2 tw-gap-2.5">
        {[
          { make: "BMW", name: "3 Series", spec: "M340i · 382 HP", fuel: "Petrol", idx: 0 },
          { make: "Audi", name: "A4", spec: "2.0 TFSI · 261 HP", fuel: "Petrol", idx: 1 },
        ].map((v) => (
          <div key={v.name} className="tw-p-4 tw-border tw-border-silver/60 tw-rounded-2xl tw-text-left hover:tw-border-steel/80 hover:tw-shadow-sm tw-transition-all tw-duration-200">
            <div className="tw-text-[10px] tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.05em] tw-flex tw-items-center tw-gap-1.5 tw-mb-1">
              <img src={CAR_BRANDS[v.idx].logo} alt="" className="tw-w-4 tw-h-4 tw-object-contain" />
              {v.make}
            </div>
            <h4 className="tw-font-heading tw-text-base tw-font-bold tw-text-ink tw-mb-1.5">{v.name}</h4>
            <div className="tw-flex tw-gap-1">
              <span className="tw-px-2.5 tw-py-0.5 tw-rounded-pill tw-text-[10px] tw-font-semibold tw-bg-accent-soft tw-text-accent">
                {v.spec}
              </span>
              <span className="tw-px-2.5 tw-py-0.5 tw-rounded-pill tw-text-[10px] tw-font-semibold tw-bg-ghost tw-text-slate/60">
                {v.fuel}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-mt-4 tw-pt-3.5 tw-border-t tw-border-silver/30 tw-text-[10px] tw-text-slate/40">
        <AutoSyncLogo size={12} className="tw-text-slate/40" />
        Powered by AutoSync
      </div>
    </div>
  );
}
