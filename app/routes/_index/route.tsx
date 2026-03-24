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

/* Our real SVG logo as a component */
function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/>
      <path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/>
    </svg>
  );
}

/* Animated counter */
function Counter({ end, suffix = "" }: { end: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        const t0 = performance.now();
        const run = (now: number) => {
          const p = Math.min((now - t0) / 1800, 1);
          setVal(Math.round(end * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
      }
    }, { threshold: 0.3 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        *{margin:0;padding:0;box-sizing:border-box}
        html{scroll-behavior:smooth}
        body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased}

        /* Nav */
        .as-nav{position:fixed;top:0;left:0;right:0;z-index:100;transition:all .3s}
        .as-nav--solid{background:rgba(255,255,255,.85);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06);box-shadow:0 1px 3px rgba(0,0,0,.04)}
        .as-nav-inner{max-width:1200px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
        .as-nav-brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:#0f172a;text-decoration:none}
        .as-nav-links{display:flex;align-items:center;gap:32px}
        .as-nav-links a{color:#64748b;text-decoration:none;font-size:14px;font-weight:500;transition:color .2s}
        .as-nav-links a:hover{color:#0f172a}
        .as-btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;transition:all .2s;cursor:pointer;border:none}
        .as-btn--primary{background:#005bd2;color:#fff}
        .as-btn--primary:hover{background:#0047a8;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,91,210,.3)}
        .as-btn--outline{background:transparent;color:#0f172a;border:1px solid #d1d5db}
        .as-btn--outline:hover{border-color:#005bd2;color:#005bd2}
        .as-btn--large{padding:14px 32px;font-size:16px;border-radius:10px}
        .as-btn--white{background:#fff;color:#0f172a}
        .as-btn--white:hover{background:#f1f5f9;transform:translateY(-1px)}

        /* Hero */
        .as-hero{padding:140px 24px 100px;background:linear-gradient(180deg,#0a0f1e 0%,#0f1d3a 50%,#0f172a 100%);color:#fff;position:relative;overflow:hidden}
        .as-hero::before{content:'';position:absolute;top:50%;left:50%;width:800px;height:800px;background:radial-gradient(circle,rgba(0,91,210,.12) 0%,transparent 70%);transform:translate(-50%,-50%);pointer-events:none}
        .as-hero-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center}
        .as-hero-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(0,91,210,.15);border:1px solid rgba(0,91,210,.3);border-radius:100px;padding:6px 16px 6px 8px;font-size:13px;color:#93c5fd;margin-bottom:24px}
        .as-hero-badge-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 2s infinite}
        .as-hero h1{font-size:clamp(36px,5vw,56px);font-weight:800;line-height:1.08;letter-spacing:-2px;margin-bottom:20px}
        .as-hero h1 span{background:linear-gradient(135deg,#60a5fa,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .as-hero p{font-size:18px;line-height:1.7;color:rgba(255,255,255,.65);max-width:500px;margin-bottom:32px}
        .as-hero-ctas{display:flex;gap:12px;flex-wrap:wrap}

        /* Widget Preview in Hero */
        .as-widget-preview{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:24px;backdrop-filter:blur(10px);animation:floatUp 4s ease-in-out infinite}
        .as-wp-title{font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:16px;display:flex;align-items:center;gap:8px}
        .as-wp-title .dot{width:6px;height:6px;border-radius:50%;background:#005bd2}
        .as-wp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
        .as-wp-field{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:8px 12px}
        .as-wp-field-label{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:1px}
        .as-wp-field-value{font-size:14px;font-weight:500;color:#fff;margin-top:2px}
        .as-wp-btn{width:100%;padding:10px;background:#005bd2;border:none;border-radius:6px;color:#fff;font-weight:600;font-size:14px;cursor:pointer}

        /* Stats */
        .as-stats{padding:60px 24px;border-bottom:1px solid #f1f5f9}
        .as-stats-inner{max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:40px;text-align:center}
        .as-stat-num{font-size:clamp(32px,4vw,48px);font-weight:800;color:#005bd2;letter-spacing:-1px}
        .as-stat-label{font-size:14px;color:#64748b;margin-top:4px}

        /* Section headers */
        .as-section{padding:100px 24px}
        .as-section--alt{background:#f8fafc}
        .as-section--dark{background:#0f172a;color:#fff}
        .as-section-inner{max-width:1100px;margin:0 auto}
        .as-section-header{text-align:center;margin-bottom:64px}
        .as-section-tag{font-size:13px;font-weight:600;color:#005bd2;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px}
        .as-section-title{font-size:clamp(28px,4vw,44px);font-weight:800;letter-spacing:-1px;line-height:1.15;margin-bottom:16px}
        .as-section-desc{font-size:18px;color:#64748b;max-width:560px;margin:0 auto;line-height:1.7}
        .as-section--dark .as-section-desc{color:rgba(255,255,255,.6)}

        /* Widget Showcase */
        .as-showcase-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px}
        .as-browser{background:#fff;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden;transition:transform .3s,box-shadow .3s}
        .as-browser:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,.08)}
        .as-browser-bar{background:#f1f5f9;padding:10px 16px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #e2e8f0}
        .as-browser-dot{width:8px;height:8px;border-radius:50%}
        .as-browser-url{font-size:11px;color:#94a3b8;margin-left:10px}
        .as-browser-body{padding:20px}

        /* Feature cards */
        .as-features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
        .as-feature{background:#fff;border:1px solid #e8ecf1;border-radius:10px;padding:28px;transition:all .25s}
        .as-feature:hover{border-color:#005bd2;box-shadow:0 8px 24px rgba(0,91,210,.08);transform:translateY(-2px)}
        .as-feature-icon{width:40px;height:40px;border-radius:10px;background:#e8f0fe;display:flex;align-items:center;justify-content:center;color:#005bd2;margin-bottom:16px}
        .as-feature h3{font-size:17px;font-weight:700;margin-bottom:8px}
        .as-feature p{font-size:14px;color:#64748b;line-height:1.65}

        /* Steps */
        .as-steps{display:flex;justify-content:center;gap:60px;flex-wrap:wrap}
        .as-step{text-align:center;max-width:220px}
        .as-step-num{width:48px;height:48px;border-radius:50%;background:#005bd2;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 16px}
        .as-step h3{font-size:18px;font-weight:700;margin-bottom:8px}
        .as-step p{font-size:14px;color:#64748b;line-height:1.6}

        /* Pricing */
        .as-pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
        .as-plan{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:28px 20px;position:relative;transition:all .25s}
        .as-plan:hover{border-color:#005bd2;box-shadow:0 4px 20px rgba(0,91,210,.1)}
        .as-plan--featured{border-color:#005bd2;box-shadow:0 4px 20px rgba(0,91,210,.12);transform:scale(1.03)}
        .as-plan-badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#005bd2;color:#fff;font-size:11px;font-weight:700;padding:4px 14px;border-radius:100px;white-space:nowrap}
        .as-plan-name{font-size:14px;font-weight:600;color:#64748b;margin-bottom:8px}
        .as-plan-price{font-size:36px;font-weight:800;letter-spacing:-1px;margin-bottom:4px}
        .as-plan-price span{font-size:14px;font-weight:400;color:#94a3b8}
        .as-plan-limit{font-size:13px;color:#005bd2;margin-bottom:16px}
        .as-plan-features{list-style:none;padding:0;margin:0 0 20px}
        .as-plan-features li{font-size:13px;color:#475569;padding:5px 0;display:flex;align-items:flex-start;gap:6px}
        .as-plan-features li::before{content:'✓';color:#005bd2;font-weight:700;flex-shrink:0}

        /* Comparison */
        .as-compare{width:100%;border-collapse:collapse;font-size:14px}
        .as-compare th{text-align:left;padding:14px 16px;font-weight:600;border-bottom:2px solid #e2e8f0}
        .as-compare td{padding:12px 16px;border-bottom:1px solid #f1f5f9}
        .as-compare tr:hover td{background:#f8fafc}
        .as-compare .as-check{color:#22c55e;font-weight:700}
        .as-compare .as-cross{color:#ef4444}
        .as-compare .as-highlight{color:#005bd2;font-weight:700}

        /* CTA */
        .as-cta{text-align:center;padding:80px 24px}

        /* Login */
        .as-login{max-width:400px;margin:0 auto;background:#fff;border-radius:10px;border:1px solid #e2e8f0;padding:32px;text-align:center}
        .as-login h3{font-size:18px;font-weight:700;margin-bottom:16px}
        .as-login-row{display:flex;gap:8px}
        .as-login input{flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px}
        .as-login input:focus{outline:none;border-color:#005bd2;box-shadow:0 0 0 3px rgba(0,91,210,.1)}

        /* Footer */
        .as-footer{background:#0f172a;color:rgba(255,255,255,.5);padding:48px 24px;text-align:center;font-size:13px}
        .as-footer a{color:rgba(255,255,255,.6);text-decoration:none}
        .as-footer a:hover{color:#fff}
        .as-footer-links{display:flex;justify-content:center;gap:24px;margin-top:16px}

        @keyframes floatUp{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

        @media(max-width:768px){
          .as-hero-inner{grid-template-columns:1fr}
          .as-features-grid{grid-template-columns:1fr}
          .as-stats-inner{grid-template-columns:repeat(2,1fr);gap:24px}
          .as-steps{flex-direction:column;align-items:center}
          .as-nav-links a:not(.as-btn){display:none}
          .as-showcase-grid{grid-template-columns:1fr}
        }
      `}} />

      {/* Nav */}
      <nav className={`as-nav ${scrolled ? "as-nav--solid" : ""}`}>
        <div className="as-nav-inner">
          <a href="/" className="as-nav-brand" style={{ color: scrolled ? "#0f172a" : "#fff" }}>
            <span style={{ color: "#005bd2" }}><Logo size={28} /></span> AutoSync
          </a>
          <div className="as-nav-links">
            <a href="#showcase" style={{ color: scrolled ? undefined : "rgba(255,255,255,.7)" }}>Widgets</a>
            <a href="#features" style={{ color: scrolled ? undefined : "rgba(255,255,255,.7)" }}>Features</a>
            <a href="#pricing" style={{ color: scrolled ? undefined : "rgba(255,255,255,.7)" }}>Pricing</a>
            <a href="#login" style={{ color: scrolled ? undefined : "rgba(255,255,255,.7)" }}>Login</a>
            <a href="https://apps.shopify.com" className="as-btn as-btn--primary">Install Free</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="as-hero">
        <div className="as-hero-inner">
          <div>
            <div className="as-hero-badge">
              <span className="as-hero-badge-dot" /> Built for Shopify
            </div>
            <h1>
              Vehicle Fitment<br /><span>Intelligence</span><br />for Shopify
            </h1>
            <p>
              Help customers find the right parts for their vehicle. YMME search, UK plate lookup, smart collections, and fitment badges — all from one app.
            </p>
            <div className="as-hero-ctas">
              <a href="https://apps.shopify.com" className="as-btn as-btn--primary as-btn--large">Start Free →</a>
              <a href="#showcase" className="as-btn as-btn--outline as-btn--large" style={{ borderColor: "rgba(255,255,255,.2)", color: "#fff" }}>See Widgets</a>
            </div>
          </div>

          {/* Floating YMME Widget Preview */}
          <div className="as-widget-preview">
            <div className="as-wp-title"><span className="dot" /> Find Parts for Your Vehicle</div>
            <div className="as-wp-grid">
              <div className="as-wp-field"><div className="as-wp-field-label">Make</div><div className="as-wp-field-value">BMW</div></div>
              <div className="as-wp-field"><div className="as-wp-field-label">Model</div><div className="as-wp-field-value">3 Series</div></div>
              <div className="as-wp-field"><div className="as-wp-field-label">Year</div><div className="as-wp-field-value">2022</div></div>
              <div className="as-wp-field"><div className="as-wp-field-label">Engine</div><div className="as-wp-field-value">M340i 382 Hp</div></div>
            </div>
            <button className="as-wp-btn">🔍 Find Compatible Parts</button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="as-stats">
        <div className="as-stats-inner">
          {[
            [stats.makes, "Vehicle Makes"],
            [stats.models, "Models"],
            [stats.engines, "Engine Variants"],
            [stats.specs, "Vehicle Specs"],
          ].map(([n, l]) => (
            <div key={String(l)}>
              <div className="as-stat-num"><Counter end={Number(n)} /></div>
              <div className="as-stat-label">{String(l)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Widget Showcase */}
      <section id="showcase" className="as-section as-section--alt">
        <div className="as-section-inner">
          <div className="as-section-header">
            <div className="as-section-tag">See It In Action</div>
            <h2 className="as-section-title">Storefront widgets that<br />work on any theme</h2>
            <p className="as-section-desc">Install once, works everywhere. No coding required. Every widget adapts to your theme automatically.</p>
          </div>
          <div className="as-showcase-grid">
            {/* YMME Widget */}
            <div className="as-browser">
              <div className="as-browser-bar">
                <span className="as-browser-dot" style={{ background: "#ef4444" }} />
                <span className="as-browser-dot" style={{ background: "#eab308" }} />
                <span className="as-browser-dot" style={{ background: "#22c55e" }} />
                <span className="as-browser-url">YMME Vehicle Search</span>
              </div>
              <div className="as-browser-body">
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#005bd2", display: "inline-block" }} />
                  FIND PARTS FOR YOUR VEHICLE
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {[["Make", "BMW"], ["Model", "3 Series"], ["Year", "2022"], ["Engine", "M340i 382 Hp"]].map(([l, v]) => (
                    <div key={l} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px" }}>
                      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>{l}</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "#005bd2", color: "#fff", textAlign: "center", padding: 10, borderRadius: 6, fontWeight: 600, fontSize: 14 }}>🔍 Find Parts</div>
                <div style={{ textAlign: "center", fontSize: 10, color: "#94a3b8", marginTop: 8, opacity: .5 }}>Powered by AutoSync</div>
              </div>
            </div>

            {/* Plate Lookup */}
            <div className="as-browser">
              <div className="as-browser-bar">
                <span className="as-browser-dot" style={{ background: "#ef4444" }} />
                <span className="as-browser-dot" style={{ background: "#eab308" }} />
                <span className="as-browser-dot" style={{ background: "#22c55e" }} />
                <span className="as-browser-url">UK Plate Lookup</span>
              </div>
              <div className="as-browser-body" style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Find Parts by Registration</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
                  <div style={{ display: "flex", border: "2px solid #1a1a2e", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ background: "#003da5", color: "#fff", padding: "8px 6px", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center" }}>GB</div>
                    <div style={{ background: "#f4c542", padding: "8px 14px", fontWeight: 700, fontSize: 16 }}>BD18 JYC</div>
                  </div>
                  <div style={{ background: "#005bd2", color: "#fff", padding: "8px 18px", borderRadius: 6, fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center" }}>🔍 Look Up</div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14, textAlign: "left" }}>
                  <div style={{ fontWeight: 600, color: "#166534", fontSize: 14 }}>✓ Vehicle Found</div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>2018 Volvo XC40 • 2.0L Diesel • 150 HP</div>
                  <div style={{ color: "#005bd2", fontSize: 13, marginTop: 4, fontWeight: 500 }}>23 compatible parts available →</div>
                </div>
              </div>
            </div>

            {/* Vehicle Compatibility */}
            <div className="as-browser">
              <div className="as-browser-bar">
                <span className="as-browser-dot" style={{ background: "#ef4444" }} />
                <span className="as-browser-dot" style={{ background: "#eab308" }} />
                <span className="as-browser-dot" style={{ background: "#22c55e" }} />
                <span className="as-browser-url">Product Page</span>
              </div>
              <div className="as-browser-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>Vehicle Compatibility</span>
                  <span style={{ background: "#dcfce7", color: "#166534", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 100 }}>✓ Fits your vehicle</span>
                </div>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                    {["Make", "Model", "Years", "Engine"].map(h => <th key={h} style={{ padding: 8, textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 12 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[["BMW", "3 Series (G20)", "2019–2025", "330i 258 Hp"], ["BMW", "3 Series (F30)", "2012–2019", "320i 184 Hp"], ["BMW", "4 Series (F32)", "2013–2020", "420i 184 Hp"]].map(([m, mo, y, e], i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: 8, fontWeight: 600 }}>{m}</td>
                        <td style={{ padding: 8, color: "#475569" }}>{mo}</td>
                        <td style={{ padding: 8, color: "#64748b" }}>{y}</td>
                        <td style={{ padding: 8, color: "#64748b" }}>{e}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="as-section">
        <div className="as-section-inner">
          <div className="as-section-header">
            <div className="as-section-tag">Features</div>
            <h2 className="as-section-title">Everything you need to sell<br />automotive parts online</h2>
            <p className="as-section-desc">From product mapping to storefront widgets, AutoSync handles every aspect of vehicle fitment.</p>
          </div>
          <div className="as-features-grid">
            {[
              ["🔍", "YMME Search Widget", "Cascading Year/Make/Model/Engine dropdowns. Persists across pages with localStorage."],
              ["🇬🇧", "UK Plate Lookup", "Customers enter their reg plate, instantly see compatible parts. DVLA + MOT APIs."],
              ["🤖", "Smart Auto-Extraction", "Automatically detect vehicle fitment from titles, descriptions, tags. Engine families + chassis codes."],
              ["📦", "Smart Collections", "Auto-generate make, model, and year-range collections with brand logos and SEO."],
              ["📄", "Vehicle Spec Pages", "SEO-optimized specification pages with full engine data and linked products."],
              ["🏷️", "Fitment Badge", "'Fits your vehicle' or 'May not fit' badges on every product page."],
              ["📥", "Provider Import", "CSV, XML, FTP, or API. Auto-detect format, smart column mapping with memory."],
              ["🔎", "Search & Discovery Filters", "Structured metafields — filter by Make, Model, Year, Engine in Shopify filters."],
              ["📊", "Analytics Dashboard", "Fitment coverage, popular makes/models, plate lookups, conversion funnel."],
            ].map(([icon, title, desc]) => (
              <div className="as-feature" key={title}>
                <div className="as-feature-icon" style={{ fontSize: 20 }}>{icon}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="as-section as-section--alt">
        <div className="as-section-inner">
          <div className="as-section-header">
            <div className="as-section-tag">How It Works</div>
            <h2 className="as-section-title">Up and running in minutes</h2>
            <p className="as-section-desc">Four simple steps to vehicle fitment on your store.</p>
          </div>
          <div className="as-steps">
            {[
              ["1", "Install", "Install from the Shopify App Store. Enable widgets in your theme editor."],
              ["2", "Import", "Sync products or import from CSV/FTP/API. Smart mapping handles the rest."],
              ["3", "Map", "Auto-extraction detects vehicles. Review suggestions or map manually."],
              ["4", "Sell", "Push to Shopify. Customers search by vehicle and find the right parts."],
            ].map(([n, t, d]) => (
              <div className="as-step" key={t}>
                <div className="as-step-num">{n}</div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="as-section">
        <div className="as-section-inner">
          <div className="as-section-header">
            <div className="as-section-tag">Pricing</div>
            <h2 className="as-section-title">Start free, scale as you grow</h2>
            <p className="as-section-desc">Every plan includes the YMME database. Upgrade anytime.</p>
          </div>
          <div className="as-pricing-grid">
            {[
              { name: "Free", price: "$0", limit: "50 products", features: ["Manual mapping", "YMME widget"] },
              { name: "Starter", price: "$19", limit: "1,000 products", features: ["Push tags & metafields", "Fitment badge", "Email support"] },
              { name: "Growth", price: "$49", limit: "10,000 products", featured: true, features: ["Auto extraction", "All 4 widgets", "Smart collections", "Bulk operations"] },
              { name: "Professional", price: "$99", limit: "50,000 products", features: ["API integration", "My Garage", "Collections (Make+Model)"] },
              { name: "Business", price: "$179", limit: "200,000 products", features: ["FTP import", "Wheel Finder", "Priority support"] },
              { name: "Enterprise", price: "$299", limit: "Unlimited", features: ["DVLA plate lookup", "VIN decode", "Full CSS customisation"] },
            ].map((p) => (
              <div className={`as-plan ${p.featured ? "as-plan--featured" : ""}`} key={p.name}>
                {p.featured && <div className="as-plan-badge">Most Popular</div>}
                <div className="as-plan-name">{p.name}</div>
                <div className="as-plan-price">{p.price}<span>/mo</span></div>
                <div className="as-plan-limit">{p.limit}</div>
                <ul className="as-plan-features">
                  {p.features.map(f => <li key={f}>{f}</li>)}
                </ul>
                <a href="https://apps.shopify.com" className={`as-btn ${p.featured ? "as-btn--primary" : "as-btn--outline"}`} style={{ width: "100%", fontSize: 13 }}>Get Started</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Competitor Comparison */}
      <section className="as-section as-section--alt">
        <div className="as-section-inner">
          <div className="as-section-header">
            <div className="as-section-tag">Why AutoSync</div>
            <h2 className="as-section-title">Compare with alternatives</h2>
          </div>
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <table className="as-compare">
              <thead><tr>
                <th style={{ width: "30%" }}>Feature</th>
                <th className="as-highlight">AutoSync</th>
                <th>Convermax</th>
                <th>Others</th>
              </tr></thead>
              <tbody>
                {[
                  ["Starting Price", "$0/mo", "$250/mo", "$50-100/mo"],
                  ["YMME Database", "✓", "✗", "✗"],
                  ["Auto Extraction Engine", "✓", "✗", "✗"],
                  ["UK Plate Lookup (DVLA)", "✓", "✗", "✗"],
                  ["Smart Collections", "✓", "✓", "✗"],
                  ["Vehicle Spec Pages", "✓", "✗", "✗"],
                  ["Multi-Source Import", "✓", "✗", "✓"],
                  ["Built for Shopify", "✓", "✗", "✓"],
                ].map(([feat, us, them, others]) => (
                  <tr key={feat}>
                    <td style={{ fontWeight: 600 }}>{feat}</td>
                    <td className={us === "✓" ? "as-check" : us.includes("$0") ? "as-highlight" : ""}>{us}</td>
                    <td className={them === "✗" ? "as-cross" : ""}>{them}</td>
                    <td className={others === "✗" ? "as-cross" : ""}>{others}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="as-section as-section--dark">
        <div className="as-cta">
          <h2 className="as-section-title" style={{ color: "#fff", marginBottom: 16 }}>Ready to sell more parts?</h2>
          <p className="as-section-desc" style={{ marginBottom: 32 }}>Join automotive merchants using AutoSync to help customers find the right parts.</p>
          <a href="https://apps.shopify.com" className="as-btn as-btn--white as-btn--large">Install Free on Shopify →</a>
        </div>
      </section>

      {/* Login */}
      {showForm && (
        <section id="login" className="as-section">
          <div className="as-login">
            <div style={{ color: "#005bd2", marginBottom: 12 }}><Logo size={32} /></div>
            <h3>Already installed?</h3>
            <Form method="post" action="/auth/login">
              <div className="as-login-row">
                <input type="text" name="shop" placeholder="your-store" />
                <span style={{ display: "flex", alignItems: "center", fontSize: 14, color: "#64748b" }}>.myshopify.com</span>
              </div>
              <button type="submit" className="as-btn as-btn--primary" style={{ width: "100%", marginTop: 12 }}>Open Dashboard</button>
            </Form>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="as-footer">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16, color: "#fff" }}>
          <Logo size={18} /> <span style={{ fontWeight: 700 }}>AutoSync</span>
        </div>
        <p>© {new Date().getFullYear()} AutoSync. Vehicle fitment intelligence for Shopify.</p>
        <div className="as-footer-links">
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
        </div>
      </footer>
    </>
  );
}
