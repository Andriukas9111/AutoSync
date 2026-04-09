import { useState, useRef } from "react";
import { YmmeDemo } from "../demos/YmmeDemo";
import { PlateDemo } from "../demos/PlateDemo";
import { VinDemo } from "../demos/VinDemo";
import { WheelDemo } from "../demos/WheelDemo";
import { BadgeDemo } from "../demos/BadgeDemo";
import { use3DTilt } from "../hooks/useGsap";

const TABS = [
  { id: "ymme", label: "YMME Search", Component: YmmeDemo },
  { id: "plate", label: "Plate Lookup", Component: PlateDemo },
  { id: "vin", label: "VIN Decode", Component: VinDemo },
  { id: "wheel", label: "Wheel Finder", Component: WheelDemo },
  { id: "badge", label: "Fitment Badge", Component: BadgeDemo },
] as const;

export function WidgetShowcase() {
  const [active, setActive] = useState<string>("ymme");
  const frameRef = useRef<HTMLDivElement>(null);
  use3DTilt(frameRef, { rotateX: 2, rotateY: 0 });

  const ActiveComponent = TABS.find((t) => t.id === active)?.Component || YmmeDemo;

  return (
    <section id="features" className="tw-py-[clamp(100px,14vh,180px)]">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        {/* Header */}
        <div className="tw-text-center tw-mb-14 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            Storefront Widgets
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            7 widgets your store needs
          </h2>
          <p className="tw-text-[17px] tw-text-slate tw-leading-[1.7] tw-mt-3 tw-max-w-[520px] tw-mx-auto">
            Native Shopify blocks. Drag and drop into any Online Store 2.0 theme. No code changes.
          </p>
        </div>

        {/* Showcase */}
        <div className="tw-max-w-[1000px] tw-mx-auto">
          {/* Tabs */}
          <div className="tw-flex tw-gap-1 tw-justify-center tw-mb-8 tw-flex-wrap">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`tw-px-5 tw-py-2.5 tw-rounded-pill tw-text-[13px] tw-font-semibold tw-cursor-pointer tw-transition-all tw-duration-200 tw-border ${
                  active === tab.id
                    ? "tw-bg-ink tw-text-white tw-border-ink"
                    : "tw-bg-transparent tw-text-slate tw-border-transparent hover:tw-bg-ghost hover:tw-text-carbon"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Product frame */}
          <div
            ref={frameRef}
            className="perspective-container tw-rounded-card tw-border tw-border-silver/60 tw-overflow-hidden tw-bg-white tw-shadow-lg"
          >
            {/* Chrome bar */}
            <div className="tw-flex tw-gap-[7px] tw-px-4 tw-py-3 tw-bg-snow tw-border-b tw-border-silver/40">
              <span className="chrome-dot" />
              <span className="chrome-dot" />
              <span className="chrome-dot" />
              <div className="tw-flex-1 tw-flex tw-justify-center">
                <div className="tw-px-4 tw-py-1 tw-rounded-full tw-bg-white tw-border tw-border-silver/40 tw-text-[10px] tw-text-slate/40 tw-w-[200px] tw-text-center">
                  yourstore.myshopify.com
                </div>
              </div>
            </div>

            {/* Demo content */}
            <div className="tw-p-7 tw-min-h-[360px]" key={active}>
              <div className="tw-animate-fade-in">
                <ActiveComponent />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
