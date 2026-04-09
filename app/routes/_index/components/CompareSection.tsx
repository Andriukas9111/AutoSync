import { COMPARE_FEATURES } from "../data/website-content";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";

const Chk = <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#0099FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Xm = <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/></svg>;

export function CompareSection() {
  return (
    <section id="compare" className="py-[clamp(100px,14vh,180px)]">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="text-center mb-14">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">Comparison</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">Why stores choose AutoSync</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start max-w-[900px] mx-auto">
          <div className="rounded-card border-2 border-accent bg-white p-9 shadow-heavy" style={{ boxShadow: "0 20px 50px rgba(0,0,0,.08), 0 0 40px rgba(0,153,255,.12)" }}>
            <div className="font-heading text-[22px] font-bold text-ink mb-5 flex items-center gap-2.5"><AutoSyncLogo size={20} className="text-accent" /> AutoSync</div>
            <div className="flex flex-col gap-3">
              {COMPARE_FEATURES.map(f => <div key={f.key} className="flex items-center gap-2.5 text-sm text-carbon">{Chk} {f.label}</div>)}
              <div className="flex items-center gap-2.5 text-sm text-carbon">{Chk} <strong>7</strong> storefront widgets</div>
              <div className="flex items-center gap-2.5 text-sm text-carbon">{Chk} Self-service setup in minutes</div>
            </div>
            <div className="text-[13px] text-slate mt-4 pt-4 border-t border-silver/40">Starting <strong className="text-ink">Free</strong> — up to $299/mo</div>
          </div>
          <div className="rounded-card border border-silver/60 bg-snow p-9">
            <div className="font-heading text-[22px] font-bold text-ink mb-5">Other Solutions</div>
            <div className="flex flex-col gap-3">
              {["No pre-loaded database","No auto extraction","No smart collections","No UK plate lookup","No wheel finder","No vehicle spec pages","1-2 widgets only","Requires support for setup"].map(s=><div key={s} className="flex items-center gap-2.5 text-sm text-slate/60">{Xm} {s}</div>)}
            </div>
            <div className="text-[13px] text-slate mt-4 pt-4 border-t border-silver/40">Starting at <strong className="text-ink">$250/mo</strong> (Convermax)</div>
          </div>
        </div>
      </div>
    </section>
  );
}
