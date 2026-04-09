import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";

export function PlateDemo() {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="demo__title">UK Plate Lookup</div>
      <div className="demo__sub">Instant vehicle identification from registration</div>
      <div style={{ display:"flex",justifyContent:"center",marginBottom:20 }}>
        <div className="uk-plate">
          <div className="uk-plate__flag"><svg width="24" height="16" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3"/><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10"/><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6"/></svg></div>
          <div className="uk-plate__text">AL61 EAJ</div>
        </div>
      </div>
      <div className="plate-result">
        <h4>BMW M340I XDRIVE MHEV AUTO</h4>
        <p>2022 · ORANGE · HYBRID ELECTRIC · 2998cc</p>
        <div className="plate-statuses">
          {[{l:"MOT Status",v:"Valid until Nov 2026"},{l:"Tax Status",v:"Taxed until Nov 2026"}].map(s=>
            <div key={s.l} className="plate-status"><div className="plate-status__label">{s.l}</div><div className="plate-status__val"><span className="plate-status__dot" style={{background:"#10B981"}}/>{s.v}</div></div>
          )}
        </div>
      </div>
      <div className="demo__footer"><AutoSyncLogo size={12}/> Powered by AutoSync</div>
    </div>
  );
}
