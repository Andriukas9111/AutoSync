import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";
const SPECS = [{l:"PCD (Bolt Pattern)",v:"5×120",u:"mm"},{l:"Diameter",v:"19",u:"inch"},{l:"Width",v:"8.5",u:"J"},{l:"Offset",v:"ET35",u:"mm"}];

export function WheelDemo() {
  return (
    <div>
      <div className="demo__title">Wheel Finder</div>
      <div className="demo__sub">Search by bolt pattern, diameter, width, offset</div>
      <div className="wheel-grid">
        {SPECS.map(s=><div key={s.l} className="wheel-field"><div className="wheel-field__label">{s.l}</div><div className="wheel-field__val">{s.v}<span className="wheel-field__unit">{s.u}</span></div></div>)}
      </div>
      <button className="search-btn">Find Matching Wheels</button>
      <div className="demo__footer"><AutoSyncLogo size={12}/> Powered by AutoSync</div>
    </div>
  );
}
