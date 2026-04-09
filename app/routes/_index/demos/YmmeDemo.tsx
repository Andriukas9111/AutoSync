import { useState } from "react";
import { CAR_BRANDS } from "../data/website-content";
import { AutoSyncLogo } from "../components/icons/AutoSyncLogo";

export function YmmeDemo() {
  const [sel, setSel] = useState(0);
  return (
    <div>
      <div className="demo__title">Select Your Vehicle</div>
      <div className="demo__sub">Choose a make to find compatible parts</div>
      <div className="brands-grid">
        {CAR_BRANDS.slice(0,10).map((b,i) => <div key={i} className={`brand-tile ${sel===i?"brand-tile--on":""}`} onClick={()=>setSel(i)}><img src={b.logo} alt={b.name} className="w-[26px] h-[26px] object-contain"/><span>{b.name}</span></div>)}
      </div>
      <div className="cascade">
        <div className="cascade__step cascade__step--on"><span>{CAR_BRANDS[sel].name}</span><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg></div>
        <div className="cascade__step cascade__step--on"><span>3 Series</span></div>
        <div className="cascade__step cascade__step--on"><span>2022</span></div>
        <div className="cascade__step"><span style={{color:"var(--gray)"}}>Engine...</span></div>
      </div>
      <button className="search-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Find Compatible Parts</button>
      <div className="demo__footer"><AutoSyncLogo size={12} /> Powered by AutoSync</div>
    </div>
  );
}
