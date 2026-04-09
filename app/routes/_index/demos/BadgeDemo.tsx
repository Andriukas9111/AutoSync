import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";
import { CAR_BRANDS } from "../data/website-content";

export function BadgeDemo() {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="demo__title">Fitment Badge</div>
      <div className="demo__sub">Real-time compatibility on every product page</div>
      <div className="fit-badge fit-badge--yes"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round"/></svg> Fits your 2022 BMW 3 Series</div>
      <div className="fit-badge fit-badge--no"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/></svg> May not fit your vehicle</div>
      <div className="vehicle-cards">
        {[{m:"BMW",n:"3 Series",e:"M340i · 382 HP",i:0},{m:"Audi",n:"A4",e:"2.0 TFSI · 261 HP",i:1}].map(v=>
          <div key={v.n} className="vehicle-card">
            <div className="vehicle-card__make"><img src={CAR_BRANDS[v.i].logo} alt="" className="w-4 h-4 object-contain"/>{v.m}</div>
            <h4>{v.n}</h4>
            <div className="vehicle-card__tags"><span className="vehicle-card__tag vehicle-card__tag--accent">{v.e}</span><span className="vehicle-card__tag">Petrol</span></div>
          </div>
        )}
      </div>
      <div className="demo__footer"><AutoSyncLogo size={12}/> Powered by AutoSync</div>
    </div>
  );
}
