import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { BRAND } from "../data/website-content";
import { useCounter } from "../hooks/useCounter";

function HeroStat({ end, label }: { end: number; label: string }) {
  const { value, ref } = useCounter(end);
  return <div ref={ref}><div className="font-heading text-[28px] font-extrabold tracking-[-0.02em] text-ink">{value.toLocaleString()}+</div><div className="text-[11px] font-medium text-slate/60 uppercase tracking-[0.06em]">{label}</div></div>;
}

function MiniDashboard() {
  return (
    <div className="p-5 text-xs">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 font-heading text-sm font-bold text-ink"><AutoSyncLogo size={14} /> Dashboard</div>
        <span className="text-[10px] text-green font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green" /> Live</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        {[["2,844","Products"],["5,827","Fitments"],["44%","Coverage"]].map(([v,l])=>
          <div key={l} className="p-3 rounded-xl border border-silver/60 text-center"><b className="block font-heading text-lg font-extrabold tracking-[-0.02em]">{v}</b><small className="text-[9px] text-slate/50 uppercase tracking-[0.04em]">{l}</small></div>
        )}
      </div>
      <div className="text-[10px] font-semibold text-slate/50 uppercase tracking-[0.06em] mb-1.5">Fitment Coverage</div>
      <div className="h-1.5 bg-ghost rounded-full overflow-hidden mb-1"><div className="h-full rounded-full gradient-fill" style={{ width: "44%" }} /></div>
      <div className="flex justify-between text-[10px] text-slate/40"><span>1,593 Review</span><span>1,251 Mapped</span></div>
    </div>
  );
}

export function Hero({ stats }: { stats: { makes: number; models: number; engines: number } }) {
  // NO useState for entrance — use pure CSS animation to avoid hydration mismatch
  return (
    <section className="relative pt-[160px] pb-24 overflow-hidden gradient-hero">
      <div className="absolute inset-0 opacity-40 pointer-events-none dot-grid dot-mask-hero" />
      <div className="relative z-2 max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="hero-enter" style={{ animationDelay: "0ms" }}>
              <span className="inline-flex items-center gap-2 px-5 py-2 rounded-pill bg-white/70 border border-silver/60 text-[13px] font-semibold text-carbon mb-7">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" /> Vehicle Fitment Intelligence
              </span>
            </div>
            <h1 className="hero-enter font-heading text-[clamp(40px,5.5vw,58px)] font-extrabold tracking-[-0.04em] leading-[1.05] text-ink mb-5" style={{ animationDelay: "100ms" }}>
              Vehicle fitment <span className="text-accent">intelligence</span> for Shopify
            </h1>
            <p className="hero-enter text-[17px] text-slate leading-[1.7] mb-8" style={{ animationDelay: "200ms" }}>{BRAND.description}</p>
            <div className="hero-enter flex gap-3 flex-wrap mb-10" style={{ animationDelay: "300ms" }}>
              <a href="#get-started" className="inline-flex items-center px-9 py-4 bg-ink text-white rounded-pill text-base font-semibold hover:bg-void transition-all hover:-translate-y-0.5 hover:shadow-heavy">Start Free Trial</a>
              <a href="#features" className="inline-flex items-center px-9 py-4 bg-transparent text-carbon rounded-pill text-base font-medium border-[1.5px] border-steel/60 hover:border-ink hover:text-ink transition-all">See How It Works</a>
            </div>
            <div className="hero-enter flex gap-8 flex-wrap" style={{ animationDelay: "400ms" }}>
              <HeroStat end={stats.makes} label="Makes" />
              <HeroStat end={stats.models} label="Models" />
              <HeroStat end={stats.engines} label="Engines" />
            </div>
          </div>
          <div className="relative hidden lg:block">
            <div className="absolute top-[10%] left-[10%] w-[80%] h-[80%] pointer-events-none glow-accent" />
            <div className="hero-enter tilt-frame relative z-1 rounded-card border border-silver/60 overflow-hidden bg-white shadow-ultra" style={{ animationDelay: "300ms" }}>
              <div className="flex gap-[7px] px-4 py-3 bg-snow border-b border-silver/40">
                <span className="w-[11px] h-[11px] rounded-full chrome-dot-red" />
                <span className="w-[11px] h-[11px] rounded-full chrome-dot-yellow" />
                <span className="w-[11px] h-[11px] rounded-full chrome-dot-green" />
              </div>
              <MiniDashboard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
