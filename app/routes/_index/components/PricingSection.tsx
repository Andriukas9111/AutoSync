import { useState } from "react";
import { PRICING_TIERS } from "../data/website-content";
import { Check, ChevronDown } from "lucide-react";

export function PricingSection() {
  const [showAll, setShowAll] = useState(false);
  const visibleTiers = showAll ? PRICING_TIERS : PRICING_TIERS.slice(0, 3);

  return (
    <section id="pricing" className="tw-py-[clamp(100px,14vh,180px)] tw-bg-snow">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        {/* Header */}
        <div className="tw-text-center tw-mb-14 gsap-reveal">
          <div className="tw-text-xs tw-font-semibold tw-text-accent tw-uppercase tw-tracking-[0.1em] tw-mb-4">
            Pricing
          </div>
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-leading-[1.08] tw-text-ink">
            Simple, transparent pricing
          </h2>
          <p className="tw-text-[17px] tw-text-slate tw-leading-[1.7] tw-mt-3 tw-max-w-[520px] tw-mx-auto">
            Start free. Scale as you grow. 14-day trial on all paid plans.
          </p>
        </div>

        {/* Cards */}
        <div className={`tw-grid tw-gap-5 ${showAll ? "tw-grid-cols-1 md:tw-grid-cols-2 lg:tw-grid-cols-3" : "tw-grid-cols-1 md:tw-grid-cols-3"}`}>
          {visibleTiers.map((tier, i) => (
            <div
              key={tier.name}
              className={`tw-p-10 tw-rounded-card tw-border tw-bg-white tw-relative tw-shadow-sm hover:tw-shadow-lg hover:tw--translate-y-1.5 tw-transition-all tw-duration-300 ${
                tier.popular
                  ? "tw-border-accent tw-shadow-lg tw-shadow-accent/10"
                  : "tw-border-silver/60"
              }`}
            >
              {tier.popular && (
                <div className="tw-absolute tw--top-3.5 tw-left-1/2 tw--translate-x-1/2 tw-px-5 tw-py-1.5 tw-rounded-pill tw-bg-accent tw-text-white tw-text-xs tw-font-bold tw-uppercase tw-tracking-[0.04em]">
                  Most Popular
                </div>
              )}

              <div className="tw-font-heading tw-text-xl tw-font-bold tw-text-ink tw-mb-2">{tier.name}</div>

              <div className="tw-mb-5">
                {tier.price === 0 ? (
                  <span className="tw-font-heading tw-text-[52px] tw-font-extrabold tw-tracking-[-0.04em] tw-text-ink">Free</span>
                ) : (
                  <>
                    <span className="tw-font-heading tw-text-[52px] tw-font-extrabold tw-tracking-[-0.04em] tw-text-ink">
                      ${tier.price}
                    </span>
                    <span className="tw-text-base tw-text-slate tw-ml-1">/mo</span>
                  </>
                )}
              </div>

              <div className="tw-mb-6">
                <div className="tw-text-sm tw-text-slate tw-py-1">
                  <strong className="tw-text-ink tw-font-semibold">
                    {typeof tier.limits.products === "number" ? tier.limits.products.toLocaleString() : tier.limits.products}
                  </strong> products
                </div>
                <div className="tw-text-sm tw-text-slate tw-py-1">
                  <strong className="tw-text-ink tw-font-semibold">
                    {typeof tier.limits.fitments === "number" ? tier.limits.fitments.toLocaleString() : tier.limits.fitments}
                  </strong> fitments
                </div>
              </div>

              <ul className="tw-mb-7">
                {tier.features.map((feat) => (
                  <li key={feat} className="tw-text-sm tw-text-carbon tw-py-1.5 tw-flex tw-items-center tw-gap-2.5">
                    <Check size={16} className="tw-text-accent tw-shrink-0" />
                    {feat}
                  </li>
                ))}
              </ul>

              <a
                href="#get-started"
                className={`tw-block tw-text-center tw-py-3 tw-rounded-pill tw-text-sm tw-font-semibold tw-transition-all tw-duration-200 ${
                  tier.popular
                    ? "tw-bg-accent tw-text-white hover:tw-bg-accent-deep"
                    : "tw-bg-transparent tw-text-carbon tw-border tw-border-steel/60 hover:tw-border-ink hover:tw-text-ink"
                }`}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>

        {/* Show all plans */}
        {!showAll && (
          <div className="tw-text-center tw-mt-8">
            <button
              onClick={() => setShowAll(true)}
              className="tw-inline-flex tw-items-center tw-gap-2 tw-px-6 tw-py-3 tw-rounded-pill tw-border tw-border-steel/60 tw-text-sm tw-font-semibold tw-text-carbon hover:tw-border-ink hover:tw-text-ink tw-transition-all tw-cursor-pointer"
            >
              View all 6 plans
              <ChevronDown size={16} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
