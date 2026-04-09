import { SYSTEMS } from "../data/website-content";

export function SystemsCarousel() {
  return (
    <section className="py-[clamp(100px,14vh,180px)] bg-snow">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="mb-12">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">Platform</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">8 integrated systems</h2>
          <p className="text-[17px] text-slate leading-[1.7] mt-3 max-w-[520px]">A complete platform where every system works together.</p>
        </div>
      </div>
      <div style={{ paddingLeft: "clamp(24px, 5vw, 80px)" }}>
        <div className="flex gap-4 overflow-x-auto pb-4 scroll-snap-x">
          {SYSTEMS.map(sys => {
            const k = Object.keys(sys.stats)[0] as keyof typeof sys.stats;
            return (
              <div key={sys.id} className="snap-start shrink-0 w-[300px] p-8 rounded-card border border-silver/60 bg-white shadow-card hover:shadow-float hover:-translate-y-1 transition-all duration-300">
                <div className="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center mb-4 text-accent">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
                <h3 className="font-heading text-lg font-bold text-ink mb-2">{sys.name}</h3>
                <p className="text-sm text-slate leading-relaxed mb-4">{sys.highlights[0]}</p>
                <span className="inline-flex px-3 py-1 rounded-pill bg-accent-soft text-accent text-xs font-semibold">{sys.stats[k]}</span>
              </div>
            );
          })}
          <div className="shrink-0 w-10" />
        </div>
      </div>
    </section>
  );
}
