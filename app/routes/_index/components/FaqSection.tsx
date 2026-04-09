import { useState } from "react";
import { FAQ_ITEMS } from "../data/website-content";

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="tw-py-[clamp(100px,14vh,180px)]">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        <div className="tw-text-center tw-mb-14 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            FAQ
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            Frequently asked questions
          </h2>
        </div>

        <div className="tw-max-w-[720px] tw-mx-auto">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="tw-border-b tw-border-silver/40">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="tw-w-full tw-flex tw-justify-between tw-items-center tw-py-6 tw-text-left tw-gap-4 tw-cursor-pointer tw-group"
              >
                <span className="tw-font-heading tw-text-[17px] tw-font-semibold tw-text-ink group-hover:tw-text-accent tw-transition-colors">
                  {item.question}
                </span>
                <span
                  className={`tw-text-[22px] tw-text-slate/40 tw-shrink-0 tw-transition-transform tw-duration-200 tw-font-light ${
                    open === i ? "tw-rotate-45 tw-text-accent" : ""
                  }`}
                >
                  +
                </span>
              </button>
              {open === i && (
                <div className="tw-text-[15px] tw-text-slate tw-leading-[1.75] tw-pb-6 tw-animate-fade-in">
                  {item.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
