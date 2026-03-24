import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";

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

  return { ref, style: { opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(40px)", transition: "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)" } as React.CSSProperties };
}

/* ─── Stat counter component ─── */
function StatCounter({ end, label, suffix }: { end: number; label: string; suffix?: string }) {
  const { value, ref } = useCounter(end);
  return (
    <div ref={ref} style={{ textAlign: "center" }}>
      <div style={{ fontSize: "48px", fontWeight: 800, color: "#005bd2", letterSpacing: "-2px", lineHeight: 1 }}>
        {value.toLocaleString()}{suffix || ""}
      </div>
      <div style={{ fontSize: "14px", color: "#64748b", marginTop: "8px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
    </div>
  );
}

/* ─── SVG Icons ─── */
const icons = {
  ymme: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  ),
  plate: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="3" />
      <path d="M6 12h2M10 12h4M16 12h2" />
    </svg>
  ),
  extract: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z" />
      <circle cx="12" cy="15" r="2" />
    </svg>
  ),
  collections: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  vehicle: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  ),
  badge: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 L15.09 8.26 L22 9.27 L17 14.14 L18.18 21.02 L12 17.77 L5.82 21.02 L7 14.14 L2 9.27 L8.91 8.26 Z" />
    </svg>
  ),
  provider: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  filters: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  analytics: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#005bd2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  x: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

/* ─── Feature card component ─── */
function FeatureCard({ icon, title, desc, index }: { icon: React.ReactNode; title: string; desc: string; index: number }) {
  const [hovered, setHovered] = useState(false);
  const fade = useFadeIn();

  return (
    <div
      ref={fade.ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...fade.style,
        transitionDelay: `${index * 0.08}s`,
        background: hovered ? "#fafbff" : "white",
        borderRadius: "8px",
        padding: "32px",
        border: hovered ? "1px solid #005bd2" : "1px solid #e8ecf1",
        boxShadow: hovered ? "0 8px 30px rgba(0,91,210,0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        cursor: "default",
      }}
    >
      <div style={{
        width: "52px",
        height: "52px",
        borderRadius: "8px",
        background: "linear-gradient(135deg, #eef4ff, #dbeafe)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: "20px",
      }}>
        {icon}
      </div>
      <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", marginBottom: "8px", margin: "0 0 8px" }}>{title}</h3>
      <p style={{ color: "#64748b", lineHeight: 1.7, fontSize: "15px", margin: 0 }}>{desc}</p>
    </div>
  );
}

/* ─── Pricing card component ─── */
function PricingCard({ name, price, products, fitments, features, highlight }: {
  name: string; price: string; products: string; fitments: string; features: string[]; highlight?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: highlight ? "linear-gradient(135deg, #005bd2 0%, #0043a0 100%)" : "white",
        color: highlight ? "white" : "#0f172a",
        borderRadius: "8px",
        padding: highlight ? "40px 28px" : "32px 24px",
        border: highlight ? "none" : hovered ? "1px solid #005bd2" : "1px solid #e8ecf1",
        boxShadow: highlight ? "0 20px 60px rgba(0,91,210,0.3)" : hovered ? "0 8px 30px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.04)",
        transform: highlight ? "scale(1.05)" : hovered ? "translateY(-4px)" : "translateY(0)",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        position: "relative" as const,
        display: "flex",
        flexDirection: "column" as const,
      }}
    >
      {highlight && (
        <div style={{
          position: "absolute",
          top: "-12px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#10b981",
          color: "white",
          fontSize: "12px",
          fontWeight: 700,
          padding: "4px 16px",
          borderRadius: "8px",
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}>Most Popular</div>
      )}
      <div style={{ fontSize: "15px", fontWeight: 600, opacity: 0.8, marginBottom: "4px" }}>{name}</div>
      <div style={{ fontSize: "40px", fontWeight: 800, marginBottom: "4px", letterSpacing: "-2px" }}>
        {price}<span style={{ fontSize: "16px", fontWeight: 400, opacity: 0.7 }}>/mo</span>
      </div>
      <div style={{ fontSize: "13px", opacity: 0.6, marginBottom: "4px" }}>{products} products</div>
      <div style={{ fontSize: "13px", opacity: 0.6, marginBottom: "20px" }}>{fitments} fitments</div>
      <div style={{ borderTop: highlight ? "1px solid rgba(255,255,255,0.2)" : "1px solid #e8ecf1", paddingTop: "20px", flex: 1 }}>
        {features.map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", marginBottom: "10px", opacity: 0.9 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={highlight ? "#86efac" : "#005bd2"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {f}
          </div>
        ))}
      </div>
      <a
        href="https://apps.shopify.com"
        style={{
          display: "block",
          textAlign: "center",
          padding: "14px",
          borderRadius: "8px",
          fontWeight: 600,
          fontSize: "15px",
          textDecoration: "none",
          marginTop: "20px",
          background: highlight ? "white" : "#005bd2",
          color: highlight ? "#005bd2" : "white",
          transition: "opacity 0.2s",
        }}
      >
        {name === "Free" ? "Start Free" : "Get Started"}
      </a>
    </div>
  );
}

/* ─── CSS keyframes as a style element ─── */
function AnimationStyles() {
  return (
    <style>{`
      @keyframes heroGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-20px); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.8; }
      }
    `}</style>
  );
}

/* ─── Main page ─── */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();

  const heroFade = useFadeIn();
  const problemFade = useFadeIn();
  const howFade = useFadeIn();
  const compFade = useFadeIn();
  const ctaFade = useFadeIn();

  return (
    <>
      <AnimationStyles />
      <div style={{ minHeight: "100vh", background: "#ffffff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0f172a", overflowX: "hidden" }}>

        {/* ─── NAV BAR ─── */}
        <nav style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          padding: "0 24px",
        }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="40" height="40" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg"><path fill="#005bd2" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="#005bd2" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>
              <span style={{ fontSize: "20px", fontWeight: 700, color: "white", letterSpacing: "-0.5px" }}>AutoSync</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
              <a href="#features" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: "14px", fontWeight: 500, transition: "color 0.2s" }}>Features</a>
              <a href="#pricing" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: "14px", fontWeight: 500, transition: "color 0.2s" }}>Pricing</a>
              <a href="#login" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: "14px", fontWeight: 500, transition: "color 0.2s" }}>Login</a>
              <a href="https://apps.shopify.com" style={{
                display: "inline-block",
                padding: "8px 20px",
                background: "#005bd2",
                color: "white",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "14px",
                textDecoration: "none",
                transition: "background 0.2s",
              }}>Install Free</a>
            </div>
          </div>
        </nav>

        {/* ─── HERO ─── */}
        <header style={{
          position: "relative",
          background: "linear-gradient(135deg, #0f172a 0%, #1a2744 30%, #0f172a 60%, #162033 100%)",
          backgroundSize: "200% 200%",
          animation: "heroGradient 12s ease infinite",
          color: "white",
          padding: "160px 24px 120px",
          textAlign: "center",
          overflow: "hidden",
        }}>
          {/* Background decorative elements */}
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "-20%", right: "-10%", width: "600px", height: "600px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,91,210,0.15) 0%, transparent 70%)", animation: "float 8s ease-in-out infinite" }} />
            <div style={{ position: "absolute", bottom: "-30%", left: "-15%", width: "800px", height: "800px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,91,210,0.1) 0%, transparent 70%)", animation: "float 10s ease-in-out infinite 2s" }} />
            <div style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }} />
            <svg style={{ position: "absolute", top: "15%", left: "8%", opacity: 0.08, animation: "float 6s ease-in-out infinite" }} width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" stroke="white" strokeWidth="1" fill="none" />
              <circle cx="60" cy="60" r="30" stroke="white" strokeWidth="1" fill="none" />
            </svg>
            <svg style={{ position: "absolute", bottom: "20%", right: "12%", opacity: 0.06, animation: "float 7s ease-in-out infinite 1s" }} width="80" height="80" viewBox="0 0 80 80">
              <rect x="10" y="10" width="60" height="60" rx="8" stroke="white" strokeWidth="1" fill="none" transform="rotate(15 40 40)" />
            </svg>
            <svg style={{ position: "absolute", top: "40%", right: "25%", opacity: 0.05, animation: "float 9s ease-in-out infinite 3s" }} width="60" height="60" viewBox="0 0 60 60">
              <polygon points="30,5 55,50 5,50" stroke="white" strokeWidth="1" fill="none" />
            </svg>
          </div>

          <div ref={heroFade.ref} style={{ ...heroFade.style, maxWidth: "900px", margin: "0 auto", position: "relative", zIndex: 1 }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 16px 6px 8px",
              borderRadius: "100px",
              background: "rgba(0,91,210,0.2)",
              border: "1px solid rgba(0,91,210,0.3)",
              marginBottom: "32px",
              fontSize: "13px",
              fontWeight: 500,
              color: "rgba(255,255,255,0.9)",
            }}>
              <span style={{ display: "inline-flex", width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", animation: "pulse 2s ease-in-out infinite" }} />
              Built for Shopify
            </div>

            <h1 style={{
              fontSize: "clamp(36px, 6vw, 72px)",
              fontWeight: 800,
              lineHeight: 1.05,
              margin: "0 0 24px",
              letterSpacing: "-2px",
              background: "linear-gradient(135deg, #ffffff 0%, #94b8ff 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              Vehicle Fitment,<br />Solved for Shopify
            </h1>
            <p style={{
              fontSize: "clamp(17px, 2vw, 21px)",
              color: "rgba(255,255,255,0.65)",
              maxWidth: "620px",
              margin: "0 auto 44px",
              lineHeight: 1.7,
            }}>
              The complete Year/Make/Model/Engine system for automotive parts stores.
              Map products to vehicles, generate smart collections, and help every
              customer find the right part — instantly.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <a href="https://apps.shopify.com" style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "16px 36px",
                background: "#005bd2",
                color: "white",
                borderRadius: "14px",
                fontWeight: 600,
                fontSize: "17px",
                textDecoration: "none",
                boxShadow: "0 4px 24px rgba(0,91,210,0.4)",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}>
                Install Free on Shopify
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
              <a href="#how-it-works" style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "16px 36px",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                borderRadius: "14px",
                fontWeight: 600,
                fontSize: "17px",
                textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(8px)",
                transition: "background 0.2s, border-color 0.2s",
              }}>
                See How It Works
              </a>
            </div>
          </div>
        </header>

        {/* ─── SOCIAL PROOF / STATS BAR ─── */}
        <section style={{
          background: "white",
          borderBottom: "1px solid #f1f5f9",
          padding: "56px 24px",
          position: "relative",
        }}>
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <p style={{ textAlign: "center", fontSize: "14px", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "36px" }}>
              Powered by a comprehensive vehicle database
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "40px" }}>
              <StatCounter end={stats.makes as number} label="Vehicle Makes" suffix="+" />
              <StatCounter end={stats.models as number} label="Models" suffix="+" />
              <StatCounter end={stats.engines as number} label="Engine Variants" suffix="+" />
              <StatCounter end={stats.specs as number} label="Vehicle Specs" suffix="+" />
            </div>
          </div>
        </section>

        {/* ─── PROBLEM / SOLUTION ─── */}
        <section style={{ padding: "100px 24px", background: "#f8fafc" }}>
          <div ref={problemFade.ref} style={{ ...problemFade.style, maxWidth: "1100px", margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: "64px" }}>
              <p style={{ fontSize: "14px", color: "#005bd2", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "12px" }}>The Problem</p>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "-1px", margin: "0 0 16px", lineHeight: 1.15 }}>
                Automotive fitment is broken on Shopify
              </h2>
              <p style={{ fontSize: "18px", color: "#64748b", maxWidth: "600px", margin: "0 auto", lineHeight: 1.7 }}>
                Merchants struggle with manual tagging, customer complaints about wrong parts, and zero tooling for Year/Make/Model search.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
              {[
                {
                  problem: "Customers can't find parts for their vehicle",
                  solution: "YMME widget with cascading dropdowns that persist across pages",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                  ),
                },
                {
                  problem: "Manually tagging thousands of products takes weeks",
                  solution: "Smart auto-extraction detects fitment from titles, descriptions, and tags automatically",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  ),
                },
                {
                  problem: "No way to organize by vehicle — collections are generic",
                  solution: "Auto-generate smart collections per Make, Model, and Year with logos and SEO",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  ),
                },
              ].map((item) => (
                <div key={item.problem} style={{
                  background: "white",
                  borderRadius: "8px",
                  padding: "36px",
                  border: "1px solid #e8ecf1",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <div style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, #005bd2, #0043a0)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "20px",
                  }}>
                    {item.icon}
                  </div>
                  <p style={{ fontSize: "15px", color: "#ef4444", fontWeight: 600, marginBottom: "8px" }}>
                    {item.problem}
                  </p>
                  <p style={{ fontSize: "15px", color: "#475569", lineHeight: 1.7, margin: 0 }}>
                    {item.solution}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FEATURES ─── */}
        <section id="features" style={{ padding: "100px 24px", background: "white" }}>
          <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: "64px" }}>
              <p style={{ fontSize: "14px", color: "#005bd2", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "12px" }}>Features</p>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "-1px", margin: "0 0 16px", lineHeight: 1.15 }}>
                Everything you need to sell<br />automotive parts online
              </h2>
              <p style={{ fontSize: "18px", color: "#64748b", maxWidth: "560px", margin: "0 auto", lineHeight: 1.7 }}>
                From product mapping to storefront widgets, AutoSync handles every aspect of vehicle fitment.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
              {[
                { icon: icons.ymme, title: "YMME Search Widget", desc: "Cascading Year/Make/Model/Engine dropdowns that help customers find compatible parts. Persists across pages with localStorage." },
                { icon: icons.plate, title: "UK Plate Lookup", desc: "Customers enter their registration and instantly see compatible parts. Powered by DVLA and MOT APIs with full vehicle history." },
                { icon: icons.extract, title: "Smart Auto-Extraction", desc: "Automatically detect vehicle fitment from product titles, descriptions, and tags. Engine families, chassis codes, and platform groups." },
                { icon: icons.collections, title: "Smart Collections", desc: "Auto-generate make, model, and year-range collections with brand logos, SEO descriptions, and proper tag-based rules." },
                { icon: icons.vehicle, title: "Vehicle Spec Pages", desc: "SEO-optimized vehicle specification pages with full engine data, linked products, and a premium responsive design." },
                { icon: icons.badge, title: "Fitment Badge", desc: "'Fits your vehicle' or 'May not fit' indicators on every product page. Customers know instantly if a part is compatible." },
                { icon: icons.provider, title: "Provider Import", desc: "Import products from CSV, XML, FTP, or API. Auto-detect file format with smart column mapping that remembers your settings." },
                { icon: icons.filters, title: "Search & Discovery Filters", desc: "Structured metafields for Shopify Search and Discovery — filter by Make, Model, Year, and Engine directly in the storefront." },
                { icon: icons.analytics, title: "Analytics Dashboard", desc: "Fitment coverage, popular makes and models, conversion funnel, plate lookups, and supplier performance tracking." },
              ].map((f, i) => (
                <FeatureCard key={f.title} icon={f.icon} title={f.title} desc={f.desc} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* ─── HOW IT WORKS ─── */}
        <section id="how-it-works" style={{ padding: "100px 24px", background: "#f8fafc" }}>
          <div ref={howFade.ref} style={{ ...howFade.style, maxWidth: "1000px", margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: "64px" }}>
              <p style={{ fontSize: "14px", color: "#005bd2", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "12px" }}>How It Works</p>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "-1px", margin: "0 0 16px", lineHeight: 1.15 }}>
                Up and running in minutes
              </h2>
              <p style={{ fontSize: "18px", color: "#64748b", maxWidth: "500px", margin: "0 auto", lineHeight: 1.7 }}>
                Four simple steps to vehicle fitment on your store.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "32px" }}>
              {[
                { step: "1", title: "Install", desc: "Install AutoSync from the Shopify App Store. Enable the theme widgets in your Online Store editor." },
                { step: "2", title: "Import", desc: "Sync your Shopify products or import from CSV, XML, FTP, or API. Smart column mapping handles the rest." },
                { step: "3", title: "Map", desc: "Auto-extraction detects vehicles from product data. Review suggestions or map manually with cascading dropdowns." },
                { step: "4", title: "Sell", desc: "Push fitment data to Shopify. Customers search by vehicle, see compatibility badges, and find the right parts." },
              ].map((s) => (
                <div key={s.step} style={{ textAlign: "center", position: "relative" }}>
                  <div style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #005bd2, #0043a0)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 20px",
                    fontSize: "24px",
                    fontWeight: 800,
                    color: "white",
                    boxShadow: "0 4px 20px rgba(0,91,210,0.3)",
                  }}>
                    {s.step}
                  </div>
                  <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "#0f172a" }}>{s.title}</h3>
                  <p style={{ fontSize: "15px", color: "#64748b", lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── PRICING ─── */}
        <section id="pricing" style={{ padding: "100px 24px", background: "white" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: "64px" }}>
              <p style={{ fontSize: "14px", color: "#005bd2", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "12px" }}>Pricing</p>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "-1px", margin: "0 0 16px", lineHeight: 1.15 }}>
                Start free, scale as you grow
              </h2>
              <p style={{ fontSize: "18px", color: "#64748b", maxWidth: "500px", margin: "0 auto", lineHeight: 1.7 }}>
                Every plan includes the YMME database. Upgrade anytime.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "16px", alignItems: "start" }}>
              <PricingCard name="Free" price="$0" products="50" fitments="200" features={["Manual mapping", "YMME widget", "Fitment badge"]} />
              <PricingCard name="Starter" price="$19" products="500" fitments="2,500" features={["Auto extraction", "Push tags", "1 provider"]} />
              <PricingCard name="Growth" price="$49" products="5,000" fitments="25,000" features={["All widgets", "Smart collections", "3 providers", "Bulk operations"]} highlight />
              <PricingCard name="Professional" price="$99" products="25,000" fitments="100,000" features={["API integration", "My Garage", "5 providers", "Custom vehicles"]} />
              <PricingCard name="Business" price="$179" products="100,000" fitments="500,000" features={["FTP import", "Wheel Finder", "15 providers", "Priority support"]} />
              <PricingCard name="Enterprise" price="$299" products="Unlimited" fitments="Unlimited" features={["DVLA plate lookup", "VIN decode", "Full CSS control", "Dedicated support"]} />
            </div>
          </div>
        </section>

        {/* ─── COMPETITOR COMPARISON ─── */}
        <section style={{ padding: "100px 24px", background: "#f8fafc" }}>
          <div ref={compFade.ref} style={{ ...compFade.style, maxWidth: "900px", margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: "64px" }}>
              <p style={{ fontSize: "14px", color: "#005bd2", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "12px" }}>Comparison</p>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "-1px", margin: "0 0 16px", lineHeight: 1.15 }}>
                Why merchants choose AutoSync
              </h2>
            </div>
            <div style={{
              background: "white",
              borderRadius: "8px",
              border: "1px solid #e8ecf1",
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                borderBottom: "2px solid #f1f5f9",
                padding: "20px 24px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#64748b",
              }}>
                <div>Feature</div>
                <div style={{ textAlign: "center", color: "#005bd2" }}>AutoSync</div>
                <div style={{ textAlign: "center" }}>Convermax</div>
                <div style={{ textAlign: "center" }}>Others</div>
              </div>
              {[
                { feature: "Starting price", autosync: "Free", convermax: "$250/mo", others: "$49/mo" },
                { feature: "YMME Database", autosync: true, convermax: true, others: false },
                { feature: "UK Plate Lookup", autosync: true, convermax: false, others: false },
                { feature: "Smart Collections", autosync: true, convermax: false, others: false },
                { feature: "Auto Extraction", autosync: true, convermax: false, others: false },
                { feature: "Vehicle Spec Pages", autosync: true, convermax: false, others: false },
                { feature: "Provider Import (FTP/API)", autosync: true, convermax: true, others: false },
                { feature: "Built for Shopify", autosync: true, convermax: false, others: true },
              ].map((row, i) => (
                <div key={row.feature} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  padding: "16px 24px",
                  borderBottom: i < 7 ? "1px solid #f1f5f9" : "none",
                  fontSize: "14px",
                  alignItems: "center",
                }}>
                  <div style={{ fontWeight: 500, color: "#334155" }}>{row.feature}</div>
                  <div style={{ textAlign: "center" }}>
                    {typeof row.autosync === "boolean" ? (row.autosync ? icons.check : icons.x) : <span style={{ fontWeight: 700, color: "#005bd2" }}>{row.autosync}</span>}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    {typeof row.convermax === "boolean" ? (row.convermax ? icons.check : icons.x) : <span style={{ color: "#64748b" }}>{row.convermax}</span>}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    {typeof row.others === "boolean" ? (row.others ? icons.check : icons.x) : <span style={{ color: "#64748b" }}>{row.others}</span>}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ textAlign: "center", fontSize: "14px", color: "#94a3b8", marginTop: "20px" }}>
              Competitors include Convermax, EasySearch, and azFitment.
            </p>
          </div>
        </section>

        {/* ─── FINAL CTA ─── */}
        <section style={{
          padding: "100px 24px",
          background: "linear-gradient(135deg, #0f172a 0%, #1a2744 50%, #0f172a 100%)",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "-50%", left: "50%", transform: "translateX(-50%)", width: "1000px", height: "1000px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,91,210,0.2) 0%, transparent 70%)" }} />
          </div>
          <div ref={ctaFade.ref} style={{ ...ctaFade.style, maxWidth: "700px", margin: "0 auto", position: "relative", zIndex: 1 }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, color: "white", letterSpacing: "-1px", margin: "0 0 20px", lineHeight: 1.15 }}>
              Ready to sell more parts?
            </h2>
            <p style={{ fontSize: "18px", color: "rgba(255,255,255,0.6)", maxWidth: "500px", margin: "0 auto 40px", lineHeight: 1.7 }}>
              Join automotive Shopify stores using AutoSync to increase conversions with accurate vehicle fitment.
            </p>
            <a href="https://apps.shopify.com" style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "18px 40px",
              background: "#005bd2",
              color: "white",
              borderRadius: "14px",
              fontWeight: 600,
              fontSize: "18px",
              textDecoration: "none",
              boxShadow: "0 4px 24px rgba(0,91,210,0.4)",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}>
              Get Started for Free
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </section>

        {/* ─── LOGIN ─── */}
        {showForm && (
          <section id="login" style={{ padding: "80px 24px", background: "white" }}>
            <div style={{
              maxWidth: "420px",
              margin: "0 auto",
              background: "#f8fafc",
              borderRadius: "8px",
              padding: "40px",
              border: "1px solid #e8ecf1",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}>
              <div style={{ textAlign: "center", marginBottom: "28px" }}>
                <svg width="36" height="36" viewBox="0 0 150 150" fill="none" style={{ marginBottom: "12px" }}>
                  <path d="M75 10 L130 45 L130 105 L75 140 L20 105 L20 45 Z" fill="#005bd2" opacity="0.9" />
                  <path d="M60 65 L75 50 L100 80 L75 100 L50 80 Z" fill="white" />
                </svg>
                <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>Welcome back</h3>
                <p style={{ fontSize: "14px", color: "#64748b", margin: 0 }}>Enter your store URL to open the dashboard</p>
              </div>
              <Form method="post" action="/auth/login" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  type="text"
                  name="shop"
                  placeholder="your-store.myshopify.com"
                  style={{
                    padding: "14px 16px",
                    borderRadius: "10px",
                    border: "1px solid #d1d5db",
                    fontSize: "15px",
                    width: "100%",
                    boxSizing: "border-box",
                    outline: "none",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: "14px 24px",
                    background: "#005bd2",
                    color: "white",
                    borderRadius: "10px",
                    fontSize: "15px",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  Open Dashboard
                </button>
              </Form>
            </div>
          </section>
        )}

        {/* ─── FOOTER ─── */}
        <footer style={{ background: "#0f172a", color: "white", padding: "60px 24px 40px" }}>
          <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "start", gap: "40px", marginBottom: "40px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <svg width="20" height="20" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg"><path fill="#005bd2" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="#005bd2" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>
                  <span style={{ fontSize: "18px", fontWeight: 700 }}>AutoSync</span>
                </div>
                <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.5)", maxWidth: "280px", lineHeight: 1.7 }}>
                  Vehicle fitment intelligence for Shopify automotive stores.
                </p>
              </div>
              <div style={{ display: "flex", gap: "48px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "16px" }}>Product</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <a href="#features" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "14px", transition: "color 0.2s" }}>Features</a>
                    <a href="#pricing" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "14px", transition: "color 0.2s" }}>Pricing</a>
                    <a href="#how-it-works" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "14px", transition: "color 0.2s" }}>How It Works</a>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "16px" }}>Legal</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <a href="/legal/privacy" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "14px", transition: "color 0.2s" }}>Privacy Policy</a>
                    <a href="/legal/terms" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: "14px", transition: "color 0.2s" }}>Terms of Service</a>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
                &copy; 2026 AutoSync. All rights reserved.
              </p>
              <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
                Built for Shopify merchants worldwide.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
