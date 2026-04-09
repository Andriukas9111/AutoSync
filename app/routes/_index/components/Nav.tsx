import { useState, useEffect } from "react";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { NAVIGATION } from "../data/website-content";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const fn = () => setScrolled(window.scrollY > 40); window.addEventListener("scroll", fn, { passive: true }); return () => window.removeEventListener("scroll", fn); }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 h-[72px] flex items-center transition-all duration-300 ${scrolled ? "bg-white/90 backdrop-blur-xl border-b border-silver/60" : "bg-transparent"}`}>
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 w-full flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5 text-ink font-heading text-[22px] font-extrabold tracking-[-0.03em] hover:opacity-80 transition-opacity">
          <AutoSyncLogo size={28} /> AutoSync
        </a>
        <div className="hidden md:flex items-center gap-7">
          {NAVIGATION.mainLinks.map(l => <a key={l.label} href={l.href} className="text-sm font-medium text-slate hover:text-ink transition-colors">{l.label}</a>)}
        </div>
        <a href={NAVIGATION.ctaButton.href} className="px-5 py-2.5 bg-ink text-white rounded-pill text-[13px] font-semibold hover:bg-void transition-all hover:-translate-y-0.5">
          {NAVIGATION.ctaButton.label}
        </a>
      </div>
    </nav>
  );
}
