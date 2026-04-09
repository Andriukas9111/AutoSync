import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";

export function PlateDemo() {
  return (
    <div className="tw-text-center">
      <h3 className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-1">UK Plate Lookup</h3>
      <p className="tw-text-xs tw-text-slate/60 tw-mb-5">Instant vehicle identification from registration</p>

      {/* UK Plate */}
      <div className="tw-flex tw-justify-center tw-mb-5">
        <div className="uk-plate">
          <div className="uk-plate__flag">
            <svg width="24" height="16" viewBox="0 0 60 40">
              <rect width="60" height="40" fill="#012169" />
              <path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6" />
              <path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3" />
              <path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10" />
              <path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6" />
            </svg>
          </div>
          <div className="uk-plate__text">AL61 EAJ</div>
        </div>
      </div>

      {/* Result card */}
      <div className="tw-rounded-2xl tw-border tw-border-silver/60 tw-p-5 tw-text-left tw-bg-snow">
        <h4 className="tw-font-heading tw-text-[17px] tw-font-bold tw-text-ink tw-mb-1">
          BMW M340I XDRIVE MHEV AUTO
        </h4>
        <p className="tw-text-xs tw-text-slate/50 tw-mb-3.5">
          2022 · ORANGE · HYBRID ELECTRIC · 2998cc
        </p>

        <div className="tw-grid tw-grid-cols-2 tw-gap-2.5">
          {[
            { label: "MOT Status", value: "Valid until Nov 2026", color: "#10B981" },
            { label: "Tax Status", value: "Taxed until Nov 2026", color: "#10B981" },
          ].map((status) => (
            <div key={status.label} className="tw-p-3 tw-rounded-xl tw-border tw-border-silver/40 tw-bg-white">
              <div className="tw-text-[9px] tw-font-semibold tw-text-slate/50 tw-uppercase tw-tracking-[0.06em] tw-mb-0.5">
                {status.label}
              </div>
              <div className="tw-text-sm tw-font-semibold tw-text-ink tw-flex tw-items-center tw-gap-1.5">
                <span className="tw-w-2 tw-h-2 tw-rounded-full" style={{ background: status.color }} />
                {status.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-mt-4 tw-pt-3.5 tw-border-t tw-border-silver/30 tw-text-[10px] tw-text-slate/40">
        <AutoSyncLogo size={12} className="tw-text-slate/40" />
        Powered by AutoSync
      </div>
    </div>
  );
}
