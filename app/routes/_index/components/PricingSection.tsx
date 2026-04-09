import { useState } from "react";
import { PRICING_TIERS } from "../data/website-content";

export function PricingSection() {
  const [showAll, setShowAll] = useState(false);
  const tiers = showAll ? PRICING_TIERS : PRICING_TIERS.slice(0, 3);

  return (
    <section id="pricing" className="py-[clamp(100px,14vh,180px)] bg-snow">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="text-center mb-14">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">Pricing</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">Simple, transparent pricing</h2>
          <p className="text-[17px] text-slate leading-[1.7] mt-3 max-w-[520px] mx-auto">Start free. Scale as you grow. 14-day trial on all paid plans.</p>
        </div>
        <div className={`grid gap-5 ${showAll ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 md:grid-cols-3"}`}>
          {tiers.map(p => (
            <div key={p.name} className={`p-10 rounded-card border bg-white relative shadow-card hover:shadow-heavy hover:-translate-y-1.5 transition-all duration-300 ${p.popular ? "border-accent shadow-heavy" : "border-silver/60"}`}>
              {p.popular && <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-5 py-1.5 rounded-pill bg-accent text-white text-xs font-bold uppercase tracking-[0.04em]">Most Popular</div>}
              <div className="font-heading text-xl font-bold text-ink mb-2">{p.name}</div>
              <div className="mb-5">{p.price === 0 ? <span className="font-heading text-[52px] font-extrabold tracking-[-0.04em] text-ink">Free</span> : <><span className="font-heading text-[52px] font-extrabold tracking-[-0.04em] text-ink">${p.price}</span><span className="text-base text-slate ml-1">/mo</span></>}</div>
              <div className="mb-6"><div className="text-sm text-slate py-1"><strong className="text-ink font-semibold">{typeof p.limits.products==="number"?p.limits.products.toLocaleString():p.limits.products}</strong> products</div><div className="text-sm text-slate py-1"><strong className="text-ink font-semibold">{typeof p.limits.fitments==="number"?p.limits.fitments.toLocaleString():p.limits.fitments}</strong> fitments</div></div>
              <ul className="mb-7">{p.features.map(f=><li key={f} className="text-sm text-carbon py-1.5 flex items-center gap-2.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#0099FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>{f}</li>)}</ul>
              <a href="#get-started" className={`block text-center py-3 rounded-pill text-sm font-semibold transition-all ${p.popular ? "bg-accent text-white hover:bg-accent-deep" : "bg-transparent text-carbon border border-steel/60 hover:border-ink hover:text-ink"}`}>{p.cta}</a>
            </div>
          ))}
        </div>
        {!showAll && <div className="text-center mt-8"><button onClick={()=>setShowAll(true)} className="inline-flex items-center gap-2 px-6 py-3 rounded-pill border border-steel/60 text-sm font-semibold text-carbon hover:border-ink hover:text-ink transition-all cursor-pointer">View all 6 plans <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg></button></div>}
      </div>
    </section>
  );
}
