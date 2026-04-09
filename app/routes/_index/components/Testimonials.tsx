import { TESTIMONIALS } from "../data/website-content";

export function Testimonials() {
  return (
    <section className="tw-py-[clamp(100px,14vh,180px)] tw-bg-snow">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        <div className="tw-text-center tw-mb-14 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            Testimonials
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            What retailers say
          </h2>
        </div>

        <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-5">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="tw-p-9 tw-rounded-card tw-border tw-border-silver/60 tw-bg-white tw-shadow-sm hover:tw-shadow-md hover:tw--translate-y-1 tw-transition-all tw-duration-300"
            >
              <div className="tw-text-lg tw-tracking-[3px] tw-mb-4 tw-text-amber-400">
                {"★".repeat(t.stars)}
              </div>
              <p className="tw-text-base tw-text-carbon tw-leading-[1.75] tw-mb-6">
                {t.quote}
              </p>
              <div>
                <div className="tw-font-heading tw-text-base tw-font-bold tw-text-ink">{t.name}</div>
                <div className="tw-text-[13px] tw-text-slate/60 tw-mt-0.5">
                  {t.role}, {t.company}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
