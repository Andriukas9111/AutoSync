import { useState } from "react";
import { YmmeDemo } from "../demos/YmmeDemo";
import { PlateDemo } from "../demos/PlateDemo";
import { VinDemo } from "../demos/VinDemo";
import { WheelDemo } from "../demos/WheelDemo";
import { BadgeDemo } from "../demos/BadgeDemo";

const TABS = [
  { id: "ymme", label: "YMME Search", C: YmmeDemo },
  { id: "plate", label: "Plate Lookup", C: PlateDemo },
  { id: "vin", label: "VIN Decode", C: VinDemo },
  { id: "wheel", label: "Wheel Finder", C: WheelDemo },
  { id: "badge", label: "Fitment Badge", C: BadgeDemo },
];

export function WidgetShowcase() {
  const [active, setActive] = useState("ymme");
  const ActiveC = TABS.find(t => t.id === active)?.C || YmmeDemo;

  return (
    <section id="features" className="py-[clamp(100px,14vh,180px)]">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="text-center mb-14">
          <div className="text-xs font-semibold text-accent uppercase tracking-[0.1em] mb-4">Storefront Widgets</div>
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] leading-[1.08] text-ink">7 widgets your store needs</h2>
          <p className="text-[17px] text-slate leading-[1.7] mt-3 max-w-[520px] mx-auto">Native Shopify blocks. Drag and drop into any Online Store 2.0 theme.</p>
        </div>
        <div className="max-w-[1000px] mx-auto">
          {/* Tabs */}
          <div className="flex gap-1 justify-center mb-8 flex-wrap">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`px-5 py-2.5 rounded-pill text-[13px] font-semibold cursor-pointer transition-all border ${
                  active === t.id
                    ? "bg-ink text-white border-ink"
                    : "bg-transparent text-slate border-transparent hover:bg-ghost hover:text-carbon"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Product frame — NO flex-1 on chrome bar */}
          <div className="tilt-showcase rounded-card border border-silver/60 overflow-hidden bg-white shadow-heavy">
            <div className="flex items-center gap-[7px] px-4 py-3 bg-snow border-b border-silver/40">
              <span className="w-[11px] h-[11px] rounded-full chrome-dot-red" />
              <span className="w-[11px] h-[11px] rounded-full chrome-dot-yellow" />
              <span className="w-[11px] h-[11px] rounded-full chrome-dot-green" />
              <span className="mx-auto px-4 py-1 rounded-full bg-white border border-silver/40 text-[10px] text-slate/40 text-center">yourstore.myshopify.com</span>
            </div>
            {/* Demo content — render all, show active via display */}
            <div className="p-7" style={{ minHeight: 360 }}>
              <ActiveC />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
