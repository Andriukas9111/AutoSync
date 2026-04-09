import { TESTIMONIALS } from "../data/website-content";

export function Testimonials() {
  return (
    <section className="py-[clamp(100px,14vh,180px)] bg-snow">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="text-center mb-14">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">Testimonials</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">What retailers say</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="p-9 rounded-card border border-silver/60 bg-white shadow-card hover:shadow-float hover:-translate-y-1 transition-all duration-300">
              <div className="text-lg tracking-[3px] mb-4 text-amber">{"★".repeat(t.stars)}</div>
              <p className="text-base text-carbon leading-[1.75] mb-6">{t.quote}</p>
              <div className="font-heading text-base font-bold text-ink">{t.name}</div>
              <div className="text-[13px] text-slate/60 mt-0.5">{t.role}, {t.company}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
