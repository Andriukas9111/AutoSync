import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";
const DATA = [["Year","2011"],["Make","BMW"],["Model","5 Series"],["Body","Sedan"],["Drive","RWD"],["Engine","3.0L I6"],["Fuel","Gasoline"],["Trans","Auto"],["Origin","Germany"],["Trim","528i"]];

export function VinDemo() {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="demo__title">VIN Decode</div>
      <div className="demo__sub">17-character VIN decoded worldwide</div>
      <div className="vin-row">
        <span className="vin-badge">VIN</span>
        <div className="vin-field"><input value="WBAPH5C55BA123456" readOnly /><span className="vin-field__counter">17/17</span></div>
        <button className="btn btn--accent-sm">Decode</button>
      </div>
      <div style={{fontFamily:"var(--heading)",fontSize:18,fontWeight:700,marginBottom:10}}>2011 BMW 5 Series 528i</div>
      <div className="vin-grid">
        {DATA.map(([k,v],i)=><div key={i} className="vin-cell"><div className="vin-cell__key">{k}</div><div className="vin-cell__val">{v}</div></div>)}
      </div>
      <div className="demo__footer"><AutoSyncLogo size={12}/> Powered by AutoSync</div>
    </div>
  );
}
