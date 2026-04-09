import { useState } from "react";
import { FAQ_ITEMS } from "../data/website-content";

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" className="py-[clamp(100px,14vh,180px)]">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="text-center mb-14">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">FAQ</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">Frequently asked questions</h2>
        </div>
        <div className="max-w-[720px] mx-auto">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border-b border-silver/40">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex justify-between items-center py-6 text-left gap-4 cursor-pointer group">
                <span className="font-heading text-[17px] font-semibold text-ink group-hover:text-accent transition-colors">{item.question}</span>
                <span className={`text-[22px] text-slate/40 shrink-0 transition-transform font-light ${open === i ? "rotate-45 text-accent" : ""}`}>+</span>
              </button>
              {open === i && <div className="text-[15px] text-slate leading-[1.75] pb-6 animate-fade-in">{item.answer}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
