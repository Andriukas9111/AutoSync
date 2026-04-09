import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";
import { useCounter } from "./hooks/useCounter";
import { useScrollReveal } from "./hooks/useScrollReveal";
import { MAKES } from "./data/makes";
import { PLANS } from "./data/plans";
import { COMPETITORS, COMPARE_FEATURES } from "./data/competitors";
import { FAQS } from "./data/faqs";
import { SYSTEMS, STEPS, TESTIMONIALS } from "./data/systems";
import "./landing.css";

/* ══════════════ LOADER ══════════════ */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const [makesRes, modelsRes, enginesRes, specsRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
  ]);
  return {
    showForm: Boolean(login),
    stats: { makes: makesRes.count ?? 0, models: modelsRes.count ?? 0, engines: enginesRes.count ?? 0, specs: specsRes.count ?? 0 },
  };
};

/* ══════════════ ICONS ══════════════ */
const Logo = (s = 24) => <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>;
const Chk = <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#0099ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Xic = <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/></svg>;
const Chev = <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>;

/* ══════════════ SHARED COMPONENTS ══════════════ */
function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useScrollReveal();
  return <div ref={ref} className={`reveal ${visible ? "reveal--visible" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>;
}

function StatCell({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return <div ref={c.ref} className="stat-cell"><div className="stat-cell__value">{c.value.toLocaleString()}+</div><div className="stat-cell__label">{label}</div></div>;
}

/* ══════════════ DASHBOARD (rich embedded UI like Opscale) ══════════════ */
function AppDashboard() {
  const [page, setPage] = useState(0);
  const pages = ["Dashboard", "Products", "Push", "Collections"];
  const icons = [
    <svg key="0" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
    <svg key="1" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4l6-2 6 2v8l-6 2-6-2z"/><path d="M8 6v8"/></svg>,
    <svg key="2" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 12V4"/><path d="M5 7l3-3 3 3"/><path d="M3 14h10"/></svg>,
    <svg key="3" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="4" width="14" height="10" rx="1.5"/><path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1"/></svg>,
  ];

  return (
    <div className="dash">
      <div className="dash__sidebar">
        <div className="dash__brand">{Logo(15)} AutoSync</div>
        <div className="dash__menu">
          {pages.map((p, i) => <div key={p} className={`dash__menu-item ${page === i ? "dash__menu-item--active" : ""}`} onClick={() => setPage(i)} style={{ cursor: "pointer" }}>{icons[i]} {p}</div>)}
        </div>
      </div>
      <div className="dash__body">
        {page === 0 && <>
          <div className="dash-title">Dashboard</div>
          <div className="dash-label">Quick Actions</div>
          <div className="dash-actions">
            <div className="dash-action"><span className="dash-dot" style={{ background: "#0099ff" }}/> Fetch Products</div>
            <div className="dash-action"><span className="dash-dot" style={{ background: "#ea580c" }}/> Auto Extract</div>
            <div className="dash-action"><span className="dash-dot" style={{ background: "#16a34a" }}/> Manual Map</div>
            <div className="dash-action dash-action--primary"><span className="dash-dot" style={{ background: "rgba(255,255,255,.5)" }}/> Push to Shopify</div>
          </div>
          <div className="dash-cards">
            {[["2,844", "Products"], ["5,827", "Fitments"], ["1,251", "Mapped"], ["44%", "Coverage"]].map(([n, l], i) =>
              <div key={i} className="dash-card"><div className="dash-card__num">{n}</div><div className="dash-card__text">{l}</div></div>
            )}
          </div>
          <div className="dash-label">Fitment Coverage</div>
          <div className="dash-progress"><div className="dash-progress__fill" style={{ width: "44%" }}/></div>
          <div className="dash-meta"><span>1,593 Needs Review</span><span>1,251 Mapped</span></div>
        </>}
        {page === 1 && <>
          <div className="dash-title">Products</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Product", "Status", "Fits"].map(h => <th key={h} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 10, textTransform: "uppercase" as const, letterSpacing: ".05em", fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {[["Eibach Pro-Kit Springs", "mapped", "#16a34a", 12], ["MST BMW Intake", "mapped", "#16a34a", 8], ["Scorpion Exhaust", "unmapped", "#999", 0], ["Bilstein B14 Kit", "flagged", "#ea580c", 3]].map(([n, s, c, f], i) =>
                <tr key={i}><td style={{ padding: "12px 8px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>{n as string}</td><td style={{ padding: "12px 8px", borderBottom: "1px solid var(--line)" }}><span style={{ fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 999, background: `${c}10`, color: c as string }}>{s as string}</span></td><td style={{ padding: "12px 8px", borderBottom: "1px solid var(--line)", textAlign: "center", fontWeight: 600 }}>{f as number}</td></tr>
              )}
            </tbody>
          </table>
        </>}
        {page === 2 && <>
          <div className="dash-title">Push to Shopify</div>
          <button className="demo-cta" style={{ width: "100%", marginBottom: 14, borderRadius: 14, padding: 14 }}>Push All Mapped Products</button>
          {["Push Tags", "Push Metafields", "Create Collections"].map(t => <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-2)", marginBottom: 8, cursor: "pointer" }}><input type="checkbox" defaultChecked readOnly style={{ accentColor: "var(--blue)", width: 16, height: 16 }}/> {t}</label>)}
        </>}
        {page === 3 && <>
          <div className="dash-title">Collections</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {MAKES.slice(0, 4).map((m, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, borderRadius: 16, border: "1px solid var(--line)" }}><img src={m.logo} alt="" style={{ width: 28, height: 28, objectFit: "contain" }}/><div><div style={{ fontSize: 13, fontWeight: 600 }}>{m.name} Parts</div><div style={{ fontSize: 11, color: "var(--ink-4)" }}>{[423, 312, 189, 156][i]} products</div></div></div>)}
          </div>
        </>}
      </div>
    </div>
  );
}

/* ══════════════ FEATURE ROW DEMOS ══════════════ */
function YmmeDemo() {
  return <>
    <div className="chrome-bar"><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/></div>
    <div className="demo-content">
      <div className="demo-heading">Find Parts for Your Vehicle</div>
      <div className="demo-grid-4">
        {[["Make", "BMW"], ["Model", "3 Series"], ["Year", "2022"], ["Engine", "M340i"]].map(([label, val]) => (
          <div key={label}><div className="demo-field-label">{label}</div><div className="demo-select"><span style={{ display: "flex", alignItems: "center", gap: 5 }}>{label === "Make" && <img src={MAKES[0].logo} alt="" width="18" height="18" style={{ objectFit: "contain" }}/>}{val}</span>{Chev}</div></div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="demo-cta" style={{ flex: 1, height: 44 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Find Parts</button>
        <div style={{ width: 44, height: 44, borderRadius: 14, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <span style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "var(--blue)", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
        </div>
      </div>
      <div className="demo-footer">{Logo(11)} Powered by AutoSync</div>
    </div>
  </>;
}

function PlateDemo() {
  return <>
    <div className="chrome-bar"><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/></div>
    <div className="demo-content">
      <div className="demo-heading" style={{ textAlign: "center" }}>UK Plate Lookup</div>
      <div className="demo-subtext" style={{ textAlign: "center" }}>Enter your registration number</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div className="demo-plate" style={{ flex: 1 }}>
          <div className="demo-plate__flag"><svg width="22" height="15" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3"/><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10"/><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6"/></svg></div>
          <input className="demo-plate__input" value="AL61 EAJ" readOnly/>
        </div>
        <button className="demo-cta" style={{ height: 48, padding: "0 20px" }}>Look Up</button>
      </div>
      <div style={{ fontFamily: "var(--f-head)", fontSize: 17, fontWeight: 700, marginBottom: 4 }}>BMW M340I XDRIVE MHEV AUTO</div>
      <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 14 }}>2022 &middot; ORANGE &middot; HYBRID ELECTRIC</div>
      {[["Year", "2022"], ["Engine", "2998cc"], ["Fuel", "HYBRID ELECTRIC"], ["CO\u2082", "176 g/km"]].map(([k, v], i) => <div key={i} className="demo-spec-line"><span>{k}</span><span>{v}</span></div>)}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0" }}>
        {[["MOT", "Valid", "#16a34a"], ["TAX", "Taxed", "#16a34a"]].map(([l, v, c]) => <div key={l as string} style={{ padding: 12, borderRadius: 14, background: "var(--bg-alt)", border: "1px solid var(--line)" }}><div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-4)", textTransform: "uppercase" as const, letterSpacing: ".05em" }}>{l as string}</div><div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: c as string }}/>{v as string}</div></div>)}
      </div>
      <button className="demo-cta" style={{ width: "100%" }}>Find Parts for This Vehicle</button>
      <div className="demo-footer">{Logo(11)} Powered by AutoSync</div>
    </div>
  </>;
}

function VinDemo() {
  return <>
    <div className="chrome-bar"><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/></div>
    <div className="demo-content" style={{ textAlign: "center" }}>
      <div className="demo-heading">VIN Decode</div>
      <div className="demo-subtext">Decode any 17-character VIN worldwide</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <span style={{ padding: "6px 12px", background: "var(--blue-soft)", color: "var(--blue)", fontSize: 10, fontWeight: 700, borderRadius: 8, letterSpacing: ".05em", border: "1px solid rgba(0,153,255,.08)" }}>VIN</span>
        <div className="demo-vin-input"><input value="WBAPH5C55BA123456" readOnly style={{ letterSpacing: 1.5 }}/><span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600, fontFamily: "var(--f-mono)" }}>17/17</span></div>
        <button className="demo-cta">Decode</button>
      </div>
      <div style={{ fontFamily: "var(--f-head)", fontSize: 17, fontWeight: 700, marginBottom: 8 }}>2011 BMW 5 Series 528i</div>
      <div className="demo-vin-grid">
        {[["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Body", "Sedan"], ["Drive", "RWD"], ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Trans", "Auto"], ["Country", "Germany"], ["Trim", "528i"]].map(([k, v], i) => <div key={i} className="demo-vin-cell"><div className="demo-vin-cell__key">{k}</div><div className="demo-vin-cell__val">{v}</div></div>)}
      </div>
      <div className="demo-footer">{Logo(11)} Powered by AutoSync</div>
    </div>
  </>;
}

function BadgeDemo() {
  return <>
    <div className="chrome-bar"><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/><span className="chrome-bar__dot"/></div>
    <div className="demo-content" style={{ textAlign: "center" }}>
      <div className="demo-heading">Fitment Badge</div>
      <div className="demo-subtext">Appears on every product page</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        <div className="demo-badge-strip demo-badge-strip--green"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#16a34a" strokeWidth="2" strokeLinecap="round"/></svg> Fits your 2022 BMW 3 Series</div>
        <div className="demo-badge-strip demo-badge-strip--red"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/></svg> May not fit your vehicle</div>
      </div>
      <div className="demo-vehicle-grid">
        {[{ m: "BMW", n: "3 Series", hp: "102 HP" }, { m: "Audi", n: "A3", hp: "115 HP" }].map((v, i) => <div key={i} className="demo-vehicle-card"><div className="demo-vehicle-card__make"><img src={MAKES[i].logo} alt=""/>{v.m}</div><h4>{v.n}</h4><div className="demo-vehicle-card__pills"><span className="demo-vehicle-card__pill demo-vehicle-card__pill--accent">{v.hp}</span><span className="demo-vehicle-card__pill">Petrol</span></div></div>)}
      </div>
      <div className="demo-footer">{Logo(11)} Powered by AutoSync</div>
    </div>
  </>;
}

/* ══════════════ PAGE ══════════════ */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [showBtt, setShowBtt] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const stepsLineRef = useRef<HTMLDivElement>(null);
  const bentoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => { setScrolled(window.scrollY > 20); setShowBtt(window.scrollY > 600); };
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Hero word stagger
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.querySelectorAll(".hero__word").forEach((w, i) => {
      setTimeout(() => w.classList.add("hero__word--visible"), 400 + i * 140);
    });
  }, []);

  // GSAP
  useEffect(() => {
    if (typeof window === "undefined") return;
    let ctx: any;
    (async () => {
      try {
        const { gsap } = await import("gsap");
        const { ScrollTrigger } = await import("gsap/ScrollTrigger");
        gsap.registerPlugin(ScrollTrigger);
        ctx = gsap.context(() => {
          if (stepsLineRef.current) {
            gsap.to(stepsLineRef.current, { width: "100%", ease: "none", scrollTrigger: { trigger: stepsLineRef.current.parentElement, start: "top 70%", end: "bottom 50%", scrub: true } });
          }
          const frame = document.querySelector(".product-frame");
          if (frame) {
            gsap.fromTo(frame, { scale: 0.92, rotateX: 5 }, { scale: 1, rotateX: 0, ease: "none", scrollTrigger: { trigger: frame, start: "top 90%", end: "top 25%", scrub: true } });
          }
        });
      } catch (_) {}
    })();
    return () => { if (ctx) ctx.revert(); };
  }, []);

  // Bento stagger
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = bentoRef.current; if (!el) return;
    const cards = el.querySelectorAll(".bento-card");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = Array.from(cards).indexOf(entry.target);
          setTimeout(() => entry.target.classList.add("bento-card--revealed"), idx * 120);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    cards.forEach(c => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="page">

      {/* ══ 1. NAV ══ */}
      <nav className={`nav ${scrolled ? "nav--scrolled" : ""}`}>
        <div className="nav__inner">
          <a href="#" className="nav__brand">{Logo()} AutoSync</a>
          <div className="nav__links">
            <a href="#features">Features</a>
            <a href="#how">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="btn btn--dark btn--sm">Start Free Trial</a>
        </div>
      </nav>

      {/* ══ 2. HERO ══ */}
      <section className="hero">
        <div className="hero__content">
          <div style={{ marginBottom: 28 }}><span className="pill pill--blue">Vehicle Fitment Intelligence</span></div>
          <h1 className="hero__title">
            {["Vehicle", "fitment"].map((w, i) => <span key={i} className="hero__word">{w}</span>)}
            <span className="hero__word hero__word--accent">intelligence</span>
            {["for", "Shopify"].map((w, i) => <span key={i + 3} className="hero__word">{w}</span>)}
          </h1>
          <p className="hero__subtitle">The only app that automatically maps vehicle fitments to your products, creates smart collections, and adds Search & Discovery filters.</p>
          <div className="hero__actions">
            <a href="#login" className="btn btn--dark btn--lg">Start Free Trial</a>
            <a href="#features" className="btn btn--ghost btn--lg">See How It Works</a>
          </div>
        </div>
        <div className="hero__stats">
          <StatCell value={stats.makes} label="Vehicle Makes"/>
          <StatCell value={stats.models} label="Models"/>
          <StatCell value={stats.engines} label="Engines"/>
          <StatCell value={stats.specs} label="Vehicle Specs"/>
        </div>
      </section>

      {/* ══ 3. 3D PRODUCT ══ */}
      <div className="product-section">
        <div className="product-frame"><AppDashboard/></div>
      </div>

      {/* ══ 4. TRUST ══ */}
      <section className="trust">
        <div className="wrap"><p className="trust__label">Trusted by parts retailers using these vehicle brands</p></div>
        <div style={{ overflow: "hidden" }}>
          <div className="trust__track">
            {[...MAKES, ...MAKES].map((m, i) => <img key={i} src={m.logo} alt={m.name} title={m.name} loading="lazy"/>)}
          </div>
        </div>
      </section>

      {/* ══ 5. BENTO ══ */}
      <section id="features" className="section">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">Platform</span><div className="heading-2">8 integrated systems</div><p className="body-text">A complete platform where every system works together seamlessly.</p></div></Reveal>
          <div className="bento" ref={bentoRef}>
            {SYSTEMS.map((sys, i) => (
              <div key={i} className={`bento-card ${sys.wide ? "bento-card--wide" : ""}`}>
                <h3>{sys.title}</h3>
                <p>{sys.desc}</p>
                <span className="bento-card__badge">{sys.stat}</span>
                {sys.wide && <div className="bento-card__visual">
                  {i === 0 ? [["Auto Mapped", "#16a34a", "72%"], ["Flagged", "#ea580c", "18%"], ["No Match", "#999", "10%"]].map(([l, c, w], j) => <div key={j} className="bento-visual-row"><span className="bento-visual-dot" style={{ background: c as string }}/><span style={{ flex: "0 0 100px" }}>{l}</span><div className="bento-visual-bar"><span style={{ width: w as string, background: c as string, display: "block", height: "100%", borderRadius: 3 }}/></div></div>)
                  : [["Makes", "374"], ["Models", "3,888"], ["Engines", "29,515"]].map(([l, v], j) => <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: j < 2 ? "1px solid var(--line)" : "none", fontSize: 13, color: "var(--ink-3)" }}><span>{l}</span><strong style={{ color: "var(--ink)" }}>{v}</strong></div>)}
                </div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 6. FEATURE ROWS (alternating) ══ */}
      <section className="section section--alt">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">Storefront Widgets</span><div className="heading-2">7 widgets your store needs</div><p className="body-text">Native Shopify Theme App Extension blocks. Drag and drop, zero code.</p></div></Reveal>
          <Reveal><div className="feature-row"><div className="feature-row__info"><span className="pill pill--blue" style={{ marginBottom: 16 }}>YMME Search</span><h3>Find parts by vehicle</h3><p>Cascading Make, Model, Year, Engine dropdowns with brand logos, My Garage for saved vehicles, and instant search results.</p><ul><li>{Chk} 374+ vehicle makes with logos</li><li>{Chk} My Garage saves multiple vehicles</li><li>{Chk} Search & Discovery integration</li></ul></div><div className="feature-row__visual"><YmmeDemo/></div></div></Reveal>
          <Reveal><div className="feature-row feature-row--reversed"><div className="feature-row__info"><span className="pill pill--blue" style={{ marginBottom: 16 }}>Plate Lookup</span><h3>UK registration lookup</h3><p>DVLA integration with MOT history, tax status, and instant vehicle identification from a UK number plate.</p><ul><li>{Chk} Real-time DVLA API</li><li>{Chk} MOT history & tax status</li><li>{Chk} Recent searches saved</li></ul></div><div className="feature-row__visual"><PlateDemo/></div></div></Reveal>
          <Reveal><div className="feature-row"><div className="feature-row__info"><span className="pill pill--blue" style={{ marginBottom: 16 }}>VIN Decode</span><h3>Decode any vehicle worldwide</h3><p>17-character VIN decoder covering 60+ manufacturers with full spec breakdown and one-click part search.</p><ul><li>{Chk} 60+ manufacturers supported</li><li>{Chk} Full specification breakdown</li><li>{Chk} One-click compatible parts</li></ul></div><div className="feature-row__visual"><VinDemo/></div></div></Reveal>
          <Reveal><div className="feature-row feature-row--reversed"><div className="feature-row__info"><span className="pill pill--blue" style={{ marginBottom: 16 }}>Badge & Specs</span><h3>Compatibility everywhere</h3><p>Fitment badges on every product page and SEO-optimized vehicle specification galleries with 90+ fields.</p><ul><li>{Chk} Real-time fits / doesn't fit badge</li><li>{Chk} 90+ spec fields per vehicle</li><li>{Chk} Auto-generated SEO pages</li></ul></div><div className="feature-row__visual"><BadgeDemo/></div></div></Reveal>
        </div>
      </section>

      {/* ══ 7. HOW IT WORKS ══ */}
      <section id="how" className="section">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">How It Works</span><div className="heading-2">From install to sales in 4 steps</div></div></Reveal>
          <div className="steps-grid">
            <div className="steps-line"><div ref={stepsLineRef} className="steps-line__fill"/></div>
            {STEPS.map((s, i) => <Reveal key={i} delay={i * 0.12}><div className="step-item"><div className="step-item__number">{s.num}</div><h3>{s.title}</h3><p>{s.desc}</p></div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ══ 8. PRICING ══ */}
      <section id="pricing" className="section section--alt">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">Pricing</span><div className="heading-2">Simple, transparent pricing</div><p className="body-text">Start free. Scale as you grow. 14-day trial on all paid plans.</p></div></Reveal>
          <div className="pricing-grid">
            {PLANS.map((p, i) => <Reveal key={p.name} delay={i * 0.06}><div className={`pricing-card ${p.pop ? "pricing-card--featured" : ""}`}>
              {p.pop && <div className="pricing-card__badge">Most Popular</div>}
              <div className="pricing-card__name">{p.name}</div>
              <div style={{ marginBottom: 18 }}>{p.price === 0 ? <span className="pricing-card__price">Free</span> : <><span className="pricing-card__price">${p.price}</span><span className="pricing-card__period">/mo</span></>}</div>
              <div className="pricing-card__limits"><div><strong>{p.products}</strong> products</div><div><strong>{p.fitments}</strong> fitments</div></div>
              <ul className="pricing-card__features">{p.features.map((f, j) => <li key={j}>{Chk} {f}</li>)}</ul>
              <a href="#login" className={`btn ${p.pop ? "btn--blue" : "btn--ghost"}`} style={{ width: "100%", justifyContent: "center" }}>{p.price === 0 ? "Get Started" : "Start Free Trial"}</a>
            </div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ══ 9. COMPARE ══ */}
      <section id="compare" className="section">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">Comparison</span><div className="heading-2">AutoSync vs the competition</div></div></Reveal>
          <Reveal delay={0.1}><div className="compare-wrapper">
            <table className="compare-table">
              <thead><tr><th>Feature</th>{COMPETITORS.map((c, i) => <th key={i} className={c.highlight ? "compare--highlight" : ""}>{c.highlight ? <strong>{c.name}</strong> : c.name}</th>)}</tr></thead>
              <tbody>
                <tr><td>Price</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "compare--highlight" : ""}>{c.price}</td>)}</tr>
                {COMPARE_FEATURES.map(f => <tr key={f.key}><td>{f.label}</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "compare--highlight" : ""}>{(c as any)[f.key] === true ? Chk : (c as any)[f.key] === false ? Xic : (c as any)[f.key]}</td>)}</tr>)}
                <tr><td>Widgets</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "compare--highlight" : ""}>{c.widgets}</td>)}</tr>
              </tbody>
            </table>
          </div></Reveal>
        </div>
      </section>

      {/* ══ 10. TESTIMONIALS ══ */}
      <section className="section section--alt">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">Testimonials</span><div className="heading-2">What parts retailers say</div></div></Reveal>
          <div className="testimonial-grid">
            {TESTIMONIALS.map((t, i) => <Reveal key={i} delay={i * 0.1}><div className="testimonial-card"><div className="testimonial-card__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div className="testimonial-card__quote">&ldquo;{t.quote}&rdquo;</div><div className="testimonial-card__name">{t.name}</div><div className="testimonial-card__role">{t.role}</div></div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ══ 11. FAQ ══ */}
      <section id="faq" className="section">
        <div className="wrap">
          <Reveal><div className="section-header section-header--center"><span className="pill pill--blue">FAQ</span><div className="heading-2">Frequently asked questions</div></div></Reveal>
          <div className="faq-list">
            {FAQS.map((item, i) => <Reveal key={i} delay={i * 0.03}><div className={`faq-item ${openFaq === i ? "faq-item--open" : ""}`}><button className="faq-item__question" onClick={() => setOpenFaq(openFaq === i ? null : i)}>{item.q}<span className="faq-item__icon">+</span></button>{openFaq === i && <div className="faq-item__answer">{item.a}</div>}</div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ══ 12. CTA ══ */}
      <section className="cta-section">
        <div className="wrap" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <Reveal><div className="heading-2">Ready to sell more parts?</div><p className="body-text" style={{ margin: "16px auto 36px", color: "rgba(255,255,255,.7)" }}>Join automotive stores using AutoSync to help customers find exact-fit parts.</p><a href="#login" className="btn btn--white btn--lg">Start Your Free Trial</a></Reveal>
        </div>
      </section>

      {/* ══ 13. LOGIN ══ */}
      <section id="login" className="section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="wrap" style={{ maxWidth: 440, textAlign: "center" }}>
          {Logo(48)}
          <div style={{ fontFamily: "var(--f-head)", fontSize: 22, fontWeight: 800, margin: "16px 0 6px", letterSpacing: "-.02em" }}>AutoSync</div>
          <p style={{ fontSize: 14, color: "var(--ink-3)", marginBottom: 28 }}>Enter your Shopify store domain to get started</p>
          {showForm && <Form method="post" action="/auth/login"><div style={{ display: "flex", gap: 8 }}><input name="shop" className="login-field" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)}/><button type="submit" className="btn btn--blue">Install</button></div></Form>}
        </div>
      </section>

      {showBtt && <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}

      {/* ══ 14. FOOTER ══ */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer__grid">
            <div><div className="footer__brand">{Logo(18)} AutoSync</div><p className="footer__desc">Vehicle fitment intelligence for Shopify. Help customers find parts that fit their vehicle.</p></div>
            <div><h4>Product</h4><div className="footer__links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></div></div>
            <div><h4>Company</h4><div className="footer__links"><a href="#">About</a><a href="#">Blog</a><a href="#">Changelog</a></div></div>
            <div><h4>Legal</h4><div className="footer__links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="mailto:support@autosync.app">Contact</a></div></div>
          </div>
          <div className="footer__bottom">&copy; {new Date().getFullYear()} AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
