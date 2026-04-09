import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";

const VIN_DATA = [
  ["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Body", "Sedan"], ["Drive", "RWD"],
  ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Trans", "Auto"], ["Origin", "Germany"], ["Trim", "528i"],
];

export function VinDemo() {
  return (
    <div className="tw-text-center">
      <h3 className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-1">VIN Decode</h3>
      <p className="tw-text-xs tw-text-slate/60 tw-mb-4">17-character VIN decoded worldwide</p>

      {/* VIN input row */}
      <div className="tw-flex tw-gap-2 tw-mb-3.5 tw-items-center">
        <span className="tw-px-3 tw-py-1.5 tw-bg-accent-soft tw-text-accent tw-text-[10px] tw-font-bold tw-rounded-lg tw-tracking-[0.05em]">
          VIN
        </span>
        <div className="tw-flex-1 tw-flex tw-items-center tw-border tw-border-silver/60 tw-rounded-xl tw-px-3.5 tw-h-[46px]">
          <input
            value="WBAPH5C55BA123456"
            readOnly
            className="tw-flex-1 tw-border-none tw-outline-none tw-bg-transparent tw-font-mono tw-text-sm tw-text-ink tw-tracking-[2px]"
          />
          <span className="tw-text-[10px] tw-text-green-500 tw-font-semibold tw-font-mono">17/17</span>
        </div>
        <button className="tw-px-5 tw-py-2.5 tw-bg-accent tw-text-white tw-rounded-xl tw-text-[13px] tw-font-semibold hover:tw-bg-accent-deep tw-transition-colors">
          Decode
        </button>
      </div>

      {/* Vehicle name */}
      <div className="tw-font-heading tw-text-lg tw-font-bold tw-text-ink tw-mb-3">
        2011 BMW 5 Series 528i
      </div>

      {/* Spec grid */}
      <div className="tw-grid tw-grid-cols-5 tw-border tw-border-silver/60 tw-rounded-xl tw-overflow-hidden">
        {VIN_DATA.map(([key, val], i) => (
          <div
            key={key}
            className={`tw-p-3 ${
              i % 5 !== 4 ? "tw-border-r tw-border-silver/40" : ""
            } ${
              i < 5 ? "tw-border-b tw-border-silver/40" : ""
            }`}
          >
            <div className="tw-text-[9px] tw-font-semibold tw-text-slate/50 tw-uppercase tw-tracking-[0.05em] tw-mb-0.5">
              {key}
            </div>
            <div className="tw-text-sm tw-font-semibold tw-text-ink">{val}</div>
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
