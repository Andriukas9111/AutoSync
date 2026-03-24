import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef, useCallback } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Fetch real YMME database stats for the landing page
  const [makesRes, modelsRes, enginesRes, specsRes, tenantsRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
    db.from("tenants").select("id", { count: "exact", head: true }),
  ]);

  return {
    showForm: Boolean(login),
    stats: {
      makes: makesRes.count ?? 0,
      models: modelsRes.count ?? 0,
      engines: enginesRes.count ?? 0,
      specs: specsRes.count ?? 0,
      tenants: tenantsRes.count ?? 0,
    },
  };
};

/* ─── Animated counter hook ─── */
function useCounter(end: number, duration = 2000) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const startTime = performance.now();
          const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.floor(eased * end));
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration]);

  return { value, ref };
}

/* ─── Fade-in on scroll hook ─── */
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.1 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

/* ─── AutoSync Logo SVG ─── */
function AutoSyncLogo({ size = 40 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width={size} height={size}>
      <path fill="#005bd2" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/>
      <path fill="#005bd2" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/>
    </svg>
  );
}

/* ─── SVG Icons (Polaris-style line icons) ─── */
const icons = {
  database: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>,
  zap: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  search: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  tag: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  layers: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  globe: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  shield: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  barChart: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>,
  settings: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  upload: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  checkGreen: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  car: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17h14M5 17a2 2 0 01-2-2v-4l2.67-5.34A2 2 0 017.46 4h9.08a2 2 0 011.79 1.11L21 10.5V15a2 2 0 01-2 2M5 17a2 2 0 002 2h1a2 2 0 002-2M14 17a2 2 0 002 2h1a2 2 0 002-2"/></svg>,
};

/* ─── Pricing Data ─── */
const plans = [
  { name: "Free", price: "$0", period: "", products: "50", fitments: "200", providers: "0", features: ["Manual mapping", "Basic YMME widget", "Community support"], highlight: false },
  { name: "Starter", price: "$19", period: "/mo", products: "500", fitments: "2,500", providers: "1", features: ["Push tags & metafields", "YMME search widget", "Fitment badge", "Email support"], highlight: false },
  { name: "Growth", price: "$49", period: "/mo", products: "5,000", fitments: "25,000", providers: "3", features: ["Auto extraction engine", "All 4 storefront widgets", "Smart collections (Make)", "Bulk operations", "Priority email support"], highlight: true },
  { name: "Professional", price: "$99", period: "/mo", products: "25,000", fitments: "100,000", providers: "5", features: ["API integration", "Custom vehicles", "My Garage feature", "Collections (Make + Model)", "Dedicated support"], highlight: false },
  { name: "Business", price: "$179", period: "/mo", products: "100,000", fitments: "500,000", providers: "15", features: ["FTP import", "Wheel Finder widget", "Priority support", "Advanced analytics", "Custom branding"], highlight: false },
  { name: "Enterprise", price: "$299", period: "/mo", products: "Unlimited", fitments: "Unlimited", providers: "Unlimited", features: ["DVLA plate lookup", "VIN decoder", "Full CSS customisation", "Dedicated account manager", "SLA guarantee"], highlight: false },
];

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */

export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const makes = useCounter(Number(stats.makes), 2000);
  const models = useCounter(Number(stats.models), 2200);
  const engines = useCounter(Number(stats.engines), 2400);
  const specs = useCounter(Number(stats.specs), 2600);

  const fadeWidgets = useFadeIn();
  const fadeFeatures = useFadeIn();
  const fadeHowItWorks = useFadeIn();
  const fadePricing = useFadeIn();
  const fadeCompare = useFadeIn();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  }, []);

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  return (
    <div style={{ fontFamily: font, color: "#0f172a", overflowX: "hidden" as const }}>

      {/* ─── NAVBAR ─── */}
      <nav style={{
        position: "fixed" as const, top: 0, left: 0, right: 0, zIndex: 1000,
        padding: "0 24px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: scrolled ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.2)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.06)" : "1px solid rgba(255,255,255,0.1)",
        transition: "all 0.3s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <AutoSyncLogo size={32} />
          <span style={{ fontSize: 20, fontWeight: 700, color: scrolled ? "#0f172a" : "#fff", transition: "color 0.3s" }}>AutoSync</span>
        </div>

        {/* Desktop nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div style={{ display: "flex", gap: 24 }}>
            {[{ label: "Features", id: "features" }, { label: "Widgets", id: "widgets" }, { label: "Pricing", id: "pricing" }, { label: "Login", id: "login" }].map(item => (
              <button key={item.id} onClick={() => scrollTo(item.id)} style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500,
                color: scrolled ? "#475569" : "rgba(255,255,255,0.85)", transition: "color 0.3s",
                fontFamily: font,
              }}>{item.label}</button>
            ))}
          </div>
          <a href="https://apps.shopify.com" target="_blank" rel="noopener noreferrer" style={{
            background: "#005bd2", color: "#fff", padding: "8px 20px", borderRadius: 8,
            fontSize: 14, fontWeight: 600, textDecoration: "none", transition: "background 0.2s",
          }}>Install Free</a>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)",
        padding: "140px 24px 100px", position: "relative" as const, overflow: "hidden" as const,
        minHeight: 600,
      }}>
        {/* Background decoration */}
        <div style={{
          position: "absolute" as const, top: -200, right: -200, width: 600, height: 600,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(0,91,210,0.15) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute" as const, bottom: -100, left: -100, width: 400, height: 400,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(0,91,210,0.1) 0%, transparent 70%)",
        }} />

        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 60, flexWrap: "wrap" as const, position: "relative" as const, zIndex: 1 }}>
          {/* Left content */}
          <div style={{ flex: "1 1 500px", minWidth: 300 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px",
              background: "rgba(0,91,210,0.2)", borderRadius: 20, marginBottom: 24,
              border: "1px solid rgba(0,91,210,0.3)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
              <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 500 }}>Built for Shopify</span>
            </div>

            <h1 style={{
              fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 800, lineHeight: 1.1,
              color: "#fff", margin: "0 0 20px",
            }}>
              Vehicle Fitment<br />
              <span style={{ color: "#5b9cf5" }}>Intelligence</span> for Shopify
            </h1>

            <p style={{ fontSize: 18, lineHeight: 1.6, color: "rgba(255,255,255,0.7)", margin: "0 0 36px", maxWidth: 520 }}>
              The complete Year/Make/Model/Engine fitment platform. Help your customers find the right parts instantly with intelligent search widgets, automated product mapping, and a database of 29,000+ engines.
            </p>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
              <a href="https://apps.shopify.com" target="_blank" rel="noopener noreferrer" style={{
                background: "#005bd2", color: "#fff", padding: "14px 32px", borderRadius: 8,
                fontSize: 16, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8,
                transition: "transform 0.2s, box-shadow 0.2s",
                boxShadow: "0 4px 14px rgba(0,91,210,0.4)",
              }}>Install Free on Shopify</a>
              <button onClick={() => scrollTo("widgets")} style={{
                background: "rgba(255,255,255,0.1)", color: "#fff", padding: "14px 32px", borderRadius: 8,
                fontSize: 16, fontWeight: 600, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer",
                backdropFilter: "blur(10px)", fontFamily: font, transition: "background 0.2s",
              }}>See Widgets</button>
            </div>
          </div>

          {/* Right — floating widget preview */}
          <div style={{ flex: "1 1 400px", minWidth: 320, display: "flex", justifyContent: "center" }}>
            <div style={{ animation: "float 3s ease-in-out infinite" }}>
              {/* Mini YMME widget preview */}
              <div style={{
                background: "#fff", borderRadius: 12, padding: 24, width: 340,
                boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <AutoSyncLogo size={20} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Find Parts For Your Vehicle</span>
                </div>
                {/* Fake dropdowns */}
                {[
                  { label: "Make", value: "BMW", icon: "https://www.carlogos.org/car-logos/bmw-logo.png" },
                  { label: "Model", value: "3 Series" },
                  { label: "Year", value: "2022" },
                  { label: "Engine", value: "M340i 382 Hp" },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0",
                    marginBottom: 8, background: "#f8fafc",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {item.icon && <img src={item.icon} alt="" style={{ width: 18, height: 18, objectFit: "contain" as const }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                      <span style={{ fontSize: 13, color: "#64748b" }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{item.value}</span>
                  </div>
                ))}
                <button style={{
                  width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                  background: "#005bd2", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  marginTop: 4,
                }}>Find Parts</button>
                <div style={{ textAlign: "center" as const, marginTop: 8 }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>Powered by AutoSync</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section style={{ background: "#fff", padding: "48px 24px", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-around", flexWrap: "wrap" as const, gap: 32 }}>
          {[
            { label: "Vehicle Makes", counter: makes },
            { label: "Models", counter: models },
            { label: "Engines", counter: engines },
            { label: "Vehicle Specs", counter: specs },
          ].map((item, i) => (
            <div key={i} ref={item.counter.ref} style={{ textAlign: "center" as const, minWidth: 140 }}>
              <div style={{ fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 800, color: "#005bd2", lineHeight: 1 }}>
                {item.counter.value.toLocaleString()}
              </div>
              <div style={{ fontSize: 14, color: "#64748b", marginTop: 6, fontWeight: 500 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── WIDGET SHOWCASE ─── */}
      <section id="widgets" ref={fadeWidgets.ref} style={{
        background: "#f6f6f7", padding: "80px 24px",
        opacity: fadeWidgets.visible ? 1 : 0, transform: fadeWidgets.visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px", color: "#0f172a" }}>See It In Action</h2>
            <p style={{ fontSize: 18, color: "#64748b", maxWidth: 600, margin: "0 auto" }}>
              Production-ready storefront widgets that install with one click. No coding required.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column" as const, gap: 48 }}>

            {/* Row 1: YMME + Plate Lookup */}
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" as const, justifyContent: "center" }}>
              {/* YMME Search Widget */}
              <BrowserFrame title="YMME Vehicle Search Widget">
                <div style={{ padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#005bd2" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", letterSpacing: "0.5px", textTransform: "uppercase" as const }}>Find Parts For Your Vehicle</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <SelectMock label="Make" value="BMW" hasLogo />
                    <SelectMock label="Model" value="3 Series" />
                    <SelectMock label="Year" value="2022" />
                    <SelectMock label="Engine" value="M340i 382 Hp" />
                  </div>
                  <button style={{
                    width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
                    background: "#005bd2", color: "#fff", fontSize: 14, fontWeight: 600, marginTop: 10, cursor: "pointer",
                  }}>Find Parts</button>
                  <div style={{ textAlign: "center" as const, marginTop: 8 }}>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>Powered by AutoSync</span>
                  </div>
                </div>
              </BrowserFrame>

              {/* UK Plate Lookup */}
              <BrowserFrame title="UK Registration Plate Lookup">
                <div style={{ padding: 20 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 0,
                      borderRadius: 6, overflow: "hidden" as const, border: "2px solid #1a1a1a",
                    }}>
                      <div style={{
                        background: "#003399", color: "#fff", padding: "10px 8px",
                        fontSize: 11, fontWeight: 700, display: "flex", flexDirection: "column" as const,
                        alignItems: "center", gap: 2, lineHeight: 1,
                      }}>
                        <span style={{ fontSize: 8 }}>GB</span>
                        <span style={{ fontSize: 14 }}>{'🇬🇧'}</span>
                      </div>
                      <div style={{
                        flex: 1, background: "#f7c948", padding: "10px 14px",
                        fontSize: 22, fontWeight: 800, fontFamily: "'Charles Wright', monospace",
                        letterSpacing: 2, color: "#1a1a1a", textAlign: "center" as const,
                      }}>BD18 SMR</div>
                    </div>
                    <button style={{
                      padding: "10px 18px", borderRadius: 6, border: "none",
                      background: "#005bd2", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                      whiteSpace: "nowrap" as const,
                    }}>Look Up</button>
                  </div>
                  <div style={{
                    background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#15803d" }}>Vehicle Found</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                      <strong>2018 Volvo XC40</strong> &bull; 2.0L Diesel &bull; 150 HP<br />
                      <span style={{ color: "#005bd2", fontWeight: 600 }}>23 compatible parts available</span>
                    </div>
                  </div>
                </div>
              </BrowserFrame>
            </div>

            {/* Row 2: Compatibility Table + Vehicle Spec */}
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" as const, justifyContent: "center" }}>
              {/* Vehicle Compatibility Table */}
              <BrowserFrame title="Vehicle Compatibility Table">
                <div style={{ padding: 20 }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px",
                    background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, marginBottom: 14,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#15803d" }}>Fits your vehicle</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                        {["Make", "Model", "Years", "Engine"].map(h => (
                          <th key={h} style={{ textAlign: "left" as const, padding: "8px 10px", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { make: "BMW", model: "3 Series (F30)", years: "2012-2019", engine: "320i 184 Hp" },
                        { make: "BMW", model: "3 Series (G20)", years: "2019-2025", engine: "330i 258 Hp" },
                        { make: "BMW", model: "4 Series (F32)", years: "2013-2020", engine: "420i 184 Hp" },
                      ].map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px" }}><strong>{row.make}</strong></td>
                          <td style={{ padding: "10px" }}>{row.model}</td>
                          <td style={{ padding: "10px" }}>{row.years}</td>
                          <td style={{ padding: "10px", color: "#64748b" }}>{row.engine}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </BrowserFrame>

              {/* Vehicle Spec Card */}
              <BrowserFrame title="Vehicle Specification Card">
                <div style={{
                  background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
                  padding: 24, color: "#fff", borderRadius: "0 0 8px 8px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 40, height: 40, background: "rgba(255,255,255,0.1)", borderRadius: 8,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.6)",
                    }}>AUDI</div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>A1</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>1.4 TFSI (150 Hp) S tronic</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 16 }}>
                    {["2014", "EA211", "Petrol", "Hatchback"].map(tag => (
                      <span key={tag} style={{
                        padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: "rgba(0,91,210,0.3)", color: "#93c5fd",
                      }}>{tag}</span>
                    ))}
                  </div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12,
                    background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 14,
                  }}>
                    {[
                      { val: "150", unit: "HP" },
                      { val: "250", unit: "Nm" },
                      { val: "1.4", unit: "L" },
                      { val: "7.9", unit: "s" },
                    ].map((s, i) => (
                      <div key={i} style={{ textAlign: "center" as const }}>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{s.val}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" as const }}>{s.unit}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </BrowserFrame>
            </div>

            {/* Row 3: Admin Dashboard */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <BrowserFrame title="AutoSync Admin Dashboard" wide>
                <div style={{ padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <AutoSyncLogo size={18} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Dashboard</span>
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }}>autosync-9.myshopify.com</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                    {[
                      { label: "Products", value: "2,844", color: "#005bd2" },
                      { label: "Fitments", value: "5,827", color: "#7c3aed" },
                      { label: "Coverage", value: "44%", color: "#059669" },
                      { label: "Collections", value: "1,125", color: "#d97706" },
                    ].map((stat, i) => (
                      <div key={i} style={{
                        background: "#f8fafc", borderRadius: 8, padding: 14,
                        border: "1px solid #e2e8f0",
                      }}>
                        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" as const, fontWeight: 600, letterSpacing: 0.5 }}>{stat.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: stat.color, marginTop: 4 }}>{stat.value}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Fitment Coverage</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#005bd2" }}>44%</span>
                    </div>
                    <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" as const }}>
                      <div style={{ width: "44%", height: "100%", background: "linear-gradient(90deg, #005bd2, #5b9cf5)", borderRadius: 4 }} />
                    </div>
                  </div>
                </div>
              </BrowserFrame>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" ref={fadeFeatures.ref} style={{
        background: "#fff", padding: "80px 24px",
        opacity: fadeFeatures.visible ? 1 : 0, transform: fadeFeatures.visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px" }}>Everything You Need to Sell Parts</h2>
            <p style={{ fontSize: 18, color: "#64748b", maxWidth: 600, margin: "0 auto" }}>
              From data import to storefront experience, AutoSync handles the entire fitment workflow.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
            {[
              { icon: icons.database, title: "29,000+ Engine Database", desc: "Pre-built YMME database covering 374 makes, 3,888 models, and 29,515 engines. No manual data entry required." },
              { icon: icons.zap, title: "AI-Free Smart Extraction", desc: "Pattern-matching engine automatically maps products to vehicles from titles and descriptions. No AI black box." },
              { icon: icons.search, title: "YMME Search Widget", desc: "Cascading Year/Make/Model/Engine dropdowns with make logos. Customers find compatible parts in seconds." },
              { icon: icons.tag, title: "Push Tags & Metafields", desc: "One-click sync to Shopify. Fitment data stored as app-owned metafields and smart collection tags." },
              { icon: icons.layers, title: "Smart Collections", desc: "Automatically create and maintain collections by make, model, or year. Proper SEO titles and descriptions." },
              { icon: icons.globe, title: "UK Plate Lookup", desc: "DVLA integration lets UK customers enter their registration plate to instantly find compatible parts." },
              { icon: icons.shield, title: "Vehicle Spec Pages", desc: "Auto-generated vehicle specification pages with full technical details, published as Shopify metaobjects." },
              { icon: icons.barChart, title: "Fitment Analytics", desc: "Track coverage, mapping progress, and sales impact. See which makes and models drive the most revenue." },
              { icon: icons.upload, title: "Multi-Source Import", desc: "Import from CSV, XML, JSON, API, or FTP. Smart column mapping remembers your configuration." },
            ].map((feat, i) => (
              <div key={i} style={{
                background: "#fff", borderRadius: 8, padding: 28, border: "1px solid #e2e8f0",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
              onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)"; }}
              onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 10, background: "#eff6ff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#005bd2", marginBottom: 16,
                }}>{feat.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>{feat.title}</h3>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section ref={fadeHowItWorks.ref} style={{
        background: "#f6f6f7", padding: "80px 24px",
        opacity: fadeHowItWorks.visible ? 1 : 0, transform: fadeHowItWorks.visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px" }}>How It Works</h2>
            <p style={{ fontSize: 18, color: "#64748b" }}>Four simple steps to vehicle-aware selling</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 32 }}>
            {[
              { step: 1, title: "Install", desc: "Add AutoSync from the Shopify App Store. Free plan available instantly." },
              { step: 2, title: "Import", desc: "Sync your Shopify products or import from CSV, API, or FTP data sources." },
              { step: 3, title: "Map", desc: "Our extraction engine automatically maps products to vehicles. Review and refine." },
              { step: 4, title: "Sell", desc: "Customers search by their vehicle and find exactly what fits. Conversions increase." },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: "center" as const }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", background: "#005bd2",
                  color: "#fff", fontSize: 20, fontWeight: 800, display: "flex", alignItems: "center",
                  justifyContent: "center", margin: "0 auto 16px",
                }}>{s.step}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" ref={fadePricing.ref} style={{
        background: "#fff", padding: "80px 24px",
        opacity: fadePricing.visible ? 1 : 0, transform: fadePricing.visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 60 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px" }}>Simple, Transparent Pricing</h2>
            <p style={{ fontSize: 18, color: "#64748b", maxWidth: 600, margin: "0 auto" }}>
              Start free. Scale as you grow. No hidden fees, no long-term contracts.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, alignItems: "start" }}>
            {plans.map((plan, i) => (
              <div key={i} style={{
                background: "#fff", borderRadius: 8, padding: 24,
                border: plan.highlight ? "2px solid #005bd2" : "1px solid #e2e8f0",
                position: "relative" as const,
                boxShadow: plan.highlight ? "0 8px 30px rgba(0,91,210,0.12)" : "none",
                transform: plan.highlight ? "scale(1.02)" : "none",
              }}>
                {plan.highlight && (
                  <div style={{
                    position: "absolute" as const, top: -12, left: "50%", transform: "translateX(-50%)",
                    background: "#005bd2", color: "#fff", padding: "4px 14px", borderRadius: 12,
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.5,
                    whiteSpace: "nowrap" as const,
                  }}>Most Popular</div>
                )}
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{plan.name}</div>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{plan.price}</span>
                  <span style={{ fontSize: 14, color: "#64748b" }}>{plan.period}</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  <strong style={{ color: "#0f172a" }}>{plan.products}</strong> products
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  <strong style={{ color: "#0f172a" }}>{plan.fitments}</strong> fitments
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                  <strong style={{ color: "#0f172a" }}>{plan.providers}</strong> providers
                </div>
                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                  {plan.features.map((feat, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, color: "#374151" }}>
                      {icons.check}
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
                <a href="https://apps.shopify.com" target="_blank" rel="noopener noreferrer" style={{
                  display: "block", textAlign: "center" as const, padding: "10px 0", borderRadius: 8,
                  marginTop: 16, fontSize: 14, fontWeight: 600, textDecoration: "none",
                  background: plan.highlight ? "#005bd2" : "#f1f5f9",
                  color: plan.highlight ? "#fff" : "#0f172a",
                  border: plan.highlight ? "none" : "1px solid #e2e8f0",
                  transition: "background 0.2s",
                }}>Get Started</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── COMPETITOR COMPARISON ─── */}
      <section ref={fadeCompare.ref} style={{
        background: "#f6f6f7", padding: "80px 24px",
        opacity: fadeCompare.visible ? 1 : 0, transform: fadeCompare.visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 48 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px" }}>Why AutoSync?</h2>
            <p style={{ fontSize: 18, color: "#64748b" }}>Compare us with the competition</p>
          </div>

          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" as const }}>
            <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ textAlign: "left" as const, padding: "14px 16px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase" as const }}>Feature</th>
                  <th style={{ textAlign: "center" as const, padding: "14px 16px", fontWeight: 700, color: "#005bd2", fontSize: 13 }}>AutoSync</th>
                  <th style={{ textAlign: "center" as const, padding: "14px 16px", fontWeight: 600, color: "#64748b", fontSize: 13 }}>Convermax</th>
                  <th style={{ textAlign: "center" as const, padding: "14px 16px", fontWeight: 600, color: "#64748b", fontSize: 13 }}>Others</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: "Starting Price", us: "$0/mo", them: "$250/mo", others: "$50-100/mo" },
                  { feature: "YMME Database Included", us: true, them: false, others: false },
                  { feature: "Auto Extraction Engine", us: true, them: false, others: false },
                  { feature: "UK Plate Lookup (DVLA)", us: true, them: false, others: false },
                  { feature: "Smart Collections", us: true, them: true, others: false },
                  { feature: "Multi-Source Import", us: true, them: false, others: true },
                  { feature: "Vehicle Spec Pages", us: true, them: false, others: false },
                  { feature: "Built for Shopify", us: true, them: false, others: true },
                ].map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>{row.feature}</td>
                    <td style={{ padding: "12px 16px", textAlign: "center" as const }}>
                      {typeof row.us === "boolean" ? (row.us ? icons.checkGreen : icons.x) : <span style={{ fontWeight: 700, color: "#005bd2" }}>{row.us}</span>}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" as const }}>
                      {typeof row.them === "boolean" ? (row.them ? icons.checkGreen : icons.x) : <span style={{ color: "#64748b" }}>{row.them}</span>}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" as const }}>
                      {typeof row.others === "boolean" ? (row.others ? icons.checkGreen : icons.x) : <span style={{ color: "#64748b" }}>{row.others}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── CTA SECTION ─── */}
      <section style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)",
        padding: "80px 24px", textAlign: "center" as const, position: "relative" as const, overflow: "hidden" as const,
      }}>
        <div style={{
          position: "absolute" as const, top: -100, right: -100, width: 400, height: 400,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(0,91,210,0.15) 0%, transparent 70%)",
        }} />
        <div style={{ position: "relative" as const, zIndex: 1, maxWidth: 600, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, color: "#fff", margin: "0 0 16px" }}>
            Ready to sell more parts?
          </h2>
          <p style={{ fontSize: 18, color: "rgba(255,255,255,0.7)", margin: "0 0 32px" }}>
            Join automotive merchants already using AutoSync to increase conversions with vehicle-specific search.
          </p>
          <a href="https://apps.shopify.com" target="_blank" rel="noopener noreferrer" style={{
            display: "inline-block", background: "#005bd2", color: "#fff", padding: "16px 40px",
            borderRadius: 8, fontSize: 18, fontWeight: 700, textDecoration: "none",
            boxShadow: "0 4px 14px rgba(0,91,210,0.4)", transition: "transform 0.2s",
          }}>Install Free on Shopify</a>
        </div>
      </section>

      {/* ─── LOGIN FORM ─── */}
      <section id="login" style={{ background: "#fff", padding: "80px 24px" }}>
        <div style={{ maxWidth: 440, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 32 }}>
            <AutoSyncLogo size={48} />
            <h2 style={{ fontSize: 24, fontWeight: 800, margin: "16px 0 8px" }}>Merchant Login</h2>
            <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>Already have AutoSync installed? Enter your store domain below.</p>
          </div>
          <div style={{
            background: "#fff", borderRadius: 8, padding: 32,
            border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}>
            <Form method="post" action="/auth/login">
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Store Domain
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  name="shop"
                  placeholder="your-store"
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db",
                    fontSize: 14, fontFamily: font, outline: "none",
                  }}
                />
                <span style={{
                  display: "flex", alignItems: "center", padding: "10px 14px",
                  background: "#f8fafc", borderRadius: 8, border: "1px solid #d1d5db",
                  fontSize: 14, color: "#64748b", whiteSpace: "nowrap" as const,
                }}>.myshopify.com</span>
              </div>
              <button type="submit" style={{
                width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                background: "#005bd2", color: "#fff", fontSize: 14, fontWeight: 600,
                cursor: "pointer", marginTop: 16, fontFamily: font,
              }}>Log In</button>
            </Form>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer style={{
        background: "#0f172a", padding: "48px 24px 32px", color: "rgba(255,255,255,0.7)",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 40, marginBottom: 40 }}>
            {/* Brand */}
            <div style={{ minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <AutoSyncLogo size={28} />
                <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>AutoSync</span>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 260, margin: 0, color: "rgba(255,255,255,0.5)" }}>
                Vehicle fitment intelligence for Shopify automotive stores. Built by Performance HQ.
              </p>
            </div>

            {/* Product */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 12 }}>Product</div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                {["Features", "Widgets", "Pricing", "Changelog"].map(item => (
                  <button key={item} onClick={() => scrollTo(item.toLowerCase())} style={{
                    background: "none", border: "none", color: "rgba(255,255,255,0.6)",
                    fontSize: 13, cursor: "pointer", textAlign: "left" as const, padding: 0,
                    fontFamily: font,
                  }}>{item}</button>
                ))}
              </div>
            </div>

            {/* Legal */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 12 }}>Legal</div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                {[
                  { label: "Privacy Policy", href: "/legal/privacy" },
                  { label: "Terms of Service", href: "/legal/terms" },
                ].map(item => (
                  <a key={item.label} href={item.href} style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, textDecoration: "none" }}>{item.label}</a>
                ))}
              </div>
            </div>

            {/* Support */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 12 }}>Support</div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                <a href="mailto:support@autosync.dev" style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, textDecoration: "none" }}>support@autosync.dev</a>
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 24, textAlign: "center" as const }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              &copy; {new Date().getFullYear()} AutoSync by Performance HQ. All rights reserved.
            </span>
          </div>
        </div>
      </footer>

      {/* ─── GLOBAL ANIMATIONS ─── */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { margin: 0; padding: 0; }
        a:hover { opacity: 0.9; }
      `}</style>
    </div>
  );
}

/* ─── Browser Frame Mockup ─── */
function BrowserFrame({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0",
      boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
      width: wide ? "100%" : undefined, maxWidth: wide ? 700 : 360,
      flex: wide ? undefined : "1 1 340px",
      transition: "transform 0.2s, box-shadow 0.2s",
    }}
    onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.1)"; }}
    onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)"; }}
    >
      {/* Browser chrome */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
        background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
        borderRadius: "8px 8px 0 0",
      }}>
        <div style={{ display: "flex", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div style={{
          flex: 1, background: "#fff", borderRadius: 4, padding: "4px 10px",
          fontSize: 11, color: "#94a3b8", border: "1px solid #e2e8f0",
          overflow: "hidden" as const, textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const,
        }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

/* ─── Select Mockup ─── */
function SelectMock({ label, value, hasLogo }: { label: string; value: string; hasLogo?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "9px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
      background: "#f8fafc", fontSize: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {hasLogo && <img src="https://www.carlogos.org/car-logos/bmw-logo.png" alt="" style={{ width: 14, height: 14, objectFit: "contain" as const }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
        <span style={{ color: "#64748b" }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontWeight: 600, color: "#0f172a" }}>{value}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
  );
}
