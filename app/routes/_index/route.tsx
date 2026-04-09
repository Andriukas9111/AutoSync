import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useEffect, useState } from "react";
import { useScrollReveal } from "./hooks/useGsap";

// Components
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { TrustMarquee } from "./components/TrustMarquee";
import { WidgetShowcase } from "./components/WidgetShowcase";
import { SystemsCarousel } from "./components/SystemsCarousel";
import { HowItWorks } from "./components/HowItWorks";
import { StatsDark } from "./components/StatsDark";
import { PricingSection } from "./components/PricingSection";
import { CompareSection } from "./components/CompareSection";
import { Testimonials } from "./components/Testimonials";
import { FaqSection } from "./components/FaqSection";
import { CtaBanner } from "./components/CtaBanner";
import { LoginForm } from "./components/LoginForm";
import { Footer } from "./components/Footer";

// Styles
import "./landing.css";

/**
 * Loader — fetches live YMME stats from Supabase.
 * Redirects to /app if shop param is present (Shopify install flow).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const [m, mo, e, s] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
  ]);

  return {
    showForm: Boolean(login),
    stats: {
      makes: m.count ?? 0,
      models: mo.count ?? 0,
      engines: e.count ?? 0,
      specs: s.count ?? 0,
    },
  };
};

/**
 * Landing Page — AutoSync Marketing Website
 *
 * Architecture:
 * - Each section is a separate React component
 * - All content from data/website-content.ts
 * - Tailwind CSS with tw- prefix (scoped to _index/)
 * - GSAP ScrollTrigger for scroll animations
 * - Lucide React for SVG icons
 */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [showBtt, setShowBtt] = useState(false);

  // GSAP section reveals
  useScrollReveal(".gsap-reveal", { stagger: 0.1, y: 30 });

  // Back-to-top visibility
  useEffect(() => {
    const onScroll = () => setShowBtt(window.scrollY > 700);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="tw-min-h-screen tw-bg-white tw-font-body tw-text-ink tw-antialiased tw-overflow-x-hidden">
      {/* 1. Navigation */}
      <Nav />

      {/* 2. Hero — Split layout: text left, 3D product frame right */}
      <Hero stats={stats} />

      {/* 3. Trust — Infinite marquee of car brand logos */}
      <TrustMarquee />

      {/* 4. Widget Showcase — Tabbed product frame (Dub.co style) */}
      <WidgetShowcase />

      {/* 5. Systems — Horizontal scroll carousel */}
      <SystemsCarousel />

      {/* 6. How It Works — Vertical timeline with GSAP line draw */}
      <HowItWorks />

      {/* 7. Dark Stats — Full-width inverted section with counters */}
      <StatsDark stats={stats} />

      {/* 8. Pricing — 3 cards + expandable to 6 */}
      <PricingSection />

      {/* 9. Comparison — Side-by-side us vs them */}
      <CompareSection />

      {/* 10. Testimonials */}
      <Testimonials />

      {/* 11. FAQ — Clean accordion */}
      <FaqSection />

      {/* 12. CTA Banner — Gradient with dot grid */}
      <CtaBanner />

      {/* 13. Login Form */}
      <LoginForm showForm={showForm} />

      {/* 14. Footer */}
      <Footer />

      {/* Back to top */}
      {showBtt && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="tw-fixed tw-bottom-9 tw-right-9 tw-w-[52px] tw-h-[52px] tw-rounded-full tw-bg-white tw-border tw-border-silver/60 tw-text-slate tw-flex tw-items-center tw-justify-center tw-cursor-pointer tw-z-50 tw-shadow-sm hover:tw-border-accent hover:tw-text-accent hover:tw-shadow-md tw-transition-all tw-duration-200"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
