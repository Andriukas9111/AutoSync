import { useState, useEffect } from "react";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { NAVIGATION } from "../data/website-content";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`tw-fixed tw-top-0 tw-left-0 tw-right-0 tw-z-50 tw-h-[72px] tw-flex tw-items-center tw-transition-all tw-duration-300 ${
        scrolled
          ? "tw-bg-white/90 tw-backdrop-blur-xl tw-border-b tw-border-silver/60"
          : "tw-bg-transparent"
      }`}
    >
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10 tw-w-full tw-flex tw-items-center tw-justify-between">
        {/* Logo */}
        <a href="#" className="tw-flex tw-items-center tw-gap-2.5 tw-text-ink hover:tw-opacity-80 tw-transition-opacity">
          <AutoSyncLogo size={28} />
          <span className="tw-font-heading tw-text-[22px] tw-font-extrabold tw-tracking-[-0.03em]">
            AutoSync
          </span>
        </a>

        {/* Links — hidden on mobile */}
        <div className="tw-hidden md:tw-flex tw-items-center tw-gap-7">
          {NAVIGATION.mainLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="tw-text-sm tw-font-medium tw-text-slate hover:tw-text-ink tw-transition-colors tw-duration-150"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <a
          href={NAVIGATION.ctaButton.href}
          className="tw-px-5 tw-py-2.5 tw-bg-ink tw-text-white tw-rounded-pill tw-text-[13px] tw-font-semibold hover:tw-bg-void tw-transition-all tw-duration-200 hover:tw--translate-y-0.5"
        >
          {NAVIGATION.ctaButton.label}
        </a>
      </div>
    </nav>
  );
}
