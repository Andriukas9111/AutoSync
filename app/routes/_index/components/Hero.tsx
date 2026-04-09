import { useRef, useEffect, useState } from "react";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { BRAND } from "../data/website-content";
import { useCounter } from "../hooks/useCounter";
import { use3DTilt } from "../hooks/useGsap";

function HeroStat({ end, label }: { end: number; label: string }) {
  const { value, ref } = useCounter(end);
  return (
    <div ref={ref}>
      <div className="tw-font-heading tw-text-[28px] tw-font-extrabold tw-tracking-[-0.02em] tw-text-ink">
        {value.toLocaleString()}+
      </div>
      <div className="tw-text-[11px] tw-font-medium tw-text-slate/60 tw-uppercase tw-tracking-[0.06em]">
        {label}
      </div>
    </div>
  );
}

function MiniDashboard() {
  return (
    <div className="tw-p-5 tw-text-xs">
      {/* Header */}
      <div className="tw-flex tw-justify-between tw-items-center tw-mb-4">
        <div className="tw-flex tw-items-center tw-gap-2">
          <AutoSyncLogo size={14} className="tw-text-ink" />
          <span className="tw-font-heading tw-text-sm tw-font-bold tw-text-ink">Dashboard</span>
        </div>
        <span className="tw-text-[10px] tw-text-green-500 tw-font-medium tw-flex tw-items-center tw-gap-1">
          <span className="tw-w-1.5 tw-h-1.5 tw-rounded-full tw-bg-green-500" />
          Live
        </span>
      </div>

      {/* Stats */}
      <div className="tw-grid tw-grid-cols-3 tw-gap-2 tw-mb-4">
        {[["2,844", "Products"], ["5,827", "Fitments"], ["44%", "Coverage"]].map(([val, label]) => (
          <div key={label} className="tw-p-3 tw-rounded-xl tw-border tw-border-silver/60 tw-text-center">
            <div className="tw-font-heading tw-text-lg tw-font-extrabold tw-tracking-[-0.02em] tw-text-ink">{val}</div>
            <div className="tw-text-[9px] tw-text-slate/50 tw-uppercase tw-tracking-[0.04em]">{label}</div>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="tw-text-[10px] tw-font-semibold tw-text-slate/50 tw-uppercase tw-tracking-[0.06em] tw-mb-1.5">
        Fitment Coverage
      </div>
      <div className="tw-h-1.5 tw-bg-ghost tw-rounded-full tw-overflow-hidden tw-mb-1">
        <div className="tw-h-full tw-rounded-full tw-bg-gradient-to-r tw-from-accent tw-to-purple" style={{ width: "44%" }} />
      </div>
      <div className="tw-flex tw-justify-between tw-text-[10px] tw-text-slate/40">
        <span>1,593 Review</span>
        <span>1,251 Mapped</span>
      </div>
    </div>
  );
}

export function Hero({ stats }: { stats: { makes: number; models: number; engines: number } }) {
  const productRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  use3DTilt(productRef, { rotateX: 5, rotateY: -4 });

  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const delay = (ms: number) => ({ transitionDelay: `${ms}ms` });

  return (
    <section className="tw-relative tw-pt-[160px] tw-pb-24 tw-overflow-hidden">
      {/* Background: lavender gradient */}
      <div
        className="tw-absolute tw-inset-0"
        style={{
          background: "linear-gradient(160deg, #EEE8FF 0%, #F5F0FF 35%, #FFFFFF 70%)",
        }}
      />
      {/* Dot grid overlay */}
      <div
        className="tw-absolute tw-inset-0 tw-opacity-40 tw-pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          maskImage: "radial-gradient(ellipse 55% 45% at 35% 35%, black 10%, transparent 55%)",
          WebkitMaskImage: "radial-gradient(ellipse 55% 45% at 35% 35%, black 10%, transparent 55%)",
        }}
      />

      {/* Content: SPLIT LAYOUT */}
      <div className="tw-relative tw-z-10 tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        <div className="tw-grid tw-grid-cols-1 lg:tw-grid-cols-2 tw-gap-16 tw-items-center">

          {/* LEFT: Text */}
          <div className="tw-max-w-[560px] lg:tw-max-w-none">
            {/* Animated pill badge */}
            <div
              className={`tw-inline-flex tw-items-center tw-gap-2 tw-px-5 tw-py-2 tw-rounded-pill tw-bg-white/70 tw-border tw-border-silver/60 tw-text-[13px] tw-font-semibold tw-text-carbon tw-mb-7 tw-transition-all tw-duration-700 ${
                entered ? "tw-opacity-100 tw-translate-y-0" : "tw-opacity-0 tw-translate-y-5"
              }`}
              style={delay(0)}
            >
              <span
                className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-accent"
                style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
              />
              Vehicle Fitment Intelligence
            </div>

            {/* H1 */}
            <h1
              className={`tw-font-heading tw-text-[clamp(40px,5.5vw,58px)] tw-font-extrabold tw-tracking-[-0.04em] tw-leading-[1.05] tw-text-ink tw-mb-5 tw-transition-all tw-duration-700 ${
                entered ? "tw-opacity-100 tw-translate-y-0" : "tw-opacity-0 tw-translate-y-5"
              }`}
              style={delay(100)}
            >
              Vehicle fitment{" "}
              <span className="tw-text-accent">intelligence</span>
              {" "}for Shopify
            </h1>

            {/* Subtitle */}
            <p
              className={`tw-text-[17px] tw-text-slate tw-leading-[1.7] tw-mb-8 tw-transition-all tw-duration-700 ${
                entered ? "tw-opacity-100 tw-translate-y-0" : "tw-opacity-0 tw-translate-y-5"
              }`}
              style={delay(200)}
            >
              {BRAND.description}
            </p>

            {/* CTAs */}
            <div
              className={`tw-flex tw-gap-3 tw-flex-wrap tw-mb-10 tw-transition-all tw-duration-700 ${
                entered ? "tw-opacity-100 tw-translate-y-0" : "tw-opacity-0 tw-translate-y-5"
              }`}
              style={delay(300)}
            >
              <a
                href="#get-started"
                className="tw-px-9 tw-py-4 tw-bg-ink tw-text-white tw-rounded-pill tw-text-base tw-font-semibold hover:tw-bg-void tw-transition-all tw-duration-200 hover:tw--translate-y-0.5 hover:tw-shadow-lg"
              >
                Start Free Trial
              </a>
              <a
                href="#features"
                className="tw-px-9 tw-py-4 tw-bg-transparent tw-text-carbon tw-rounded-pill tw-text-base tw-font-medium tw-border-[1.5px] tw-border-steel/60 hover:tw-border-ink hover:tw-text-ink tw-transition-all tw-duration-200"
              >
                See How It Works
              </a>
            </div>

            {/* Stats inline */}
            <div
              className={`tw-flex tw-gap-8 tw-flex-wrap tw-transition-all tw-duration-700 ${
                entered ? "tw-opacity-100 tw-translate-y-0" : "tw-opacity-0 tw-translate-y-5"
              }`}
              style={delay(400)}
            >
              <HeroStat end={stats.makes} label="Makes" />
              <HeroStat end={stats.models} label="Models" />
              <HeroStat end={stats.engines} label="Engines" />
            </div>
          </div>

          {/* RIGHT: Product Frame with 3D tilt */}
          <div className="tw-relative lg:tw-block">
            {/* Blue glow behind */}
            <div
              className="tw-absolute tw-top-[10%] tw-left-[10%] tw-w-[80%] tw-h-[80%] tw-pointer-events-none"
              style={{
                background: "radial-gradient(circle, rgba(0,153,255,0.1) 0%, transparent 60%)",
                filter: "blur(40px)",
              }}
            />

            {/* Product frame */}
            <div
              ref={productRef}
              className={`perspective-container tw-relative tw-z-10 tw-rounded-card tw-border tw-border-silver/60 tw-overflow-hidden tw-bg-white tw-shadow-xl tw-transition-all tw-duration-1000 ${
                entered ? "tw-opacity-100 tw-scale-100" : "tw-opacity-0 tw-scale-95"
              }`}
              style={{
                ...delay(300),
                transformStyle: "preserve-3d",
              }}
            >
              {/* Chrome bar */}
              <div className="tw-flex tw-gap-[7px] tw-px-4 tw-py-3 tw-bg-snow tw-border-b tw-border-silver/40">
                <span className="chrome-dot" />
                <span className="chrome-dot" />
                <span className="chrome-dot" />
              </div>

              <MiniDashboard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
