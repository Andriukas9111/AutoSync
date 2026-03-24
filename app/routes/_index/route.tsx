import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef, useCallback } from "react";
import "./landing.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const [makesRes, modelsRes, enginesRes, productsRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("products").select("id", { count: "exact", head: true }),
  ]);
  return {
    showForm: Boolean(login),
    stats: { makes: makesRes.count ?? 0, models: modelsRes.count ?? 0, engines: enginesRes.count ?? 0, products: productsRes.count ?? 0 },
  };
};

// ─── SVG Icons ───
const I = {
  logo: (s = 24) => <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z" /><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z" /></svg>,
  chk: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  x: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  arr: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4l4 4-4 4" /></svg>,
  chev: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4" /></svg>,
};

// ─── System SVG Icons ───
const SysIcons = {
  extraction: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="20" cy="20" r="12" /><path d="M28.5 28.5L38 38" /><line x1="14" y1="17" x2="26" y2="17" /><line x1="14" y1="21" x2="24" y2="21" /><line x1="14" y1="25" x2="20" y2="25" /></svg>,
  ymmeDb: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="24" cy="14" rx="14" ry="5" /><path d="M10 14v10c0 2.76 6.27 5 14 5s14-2.24 14-5V14" /><path d="M10 24v10c0 2.76 6.27 5 14 5s14-2.24 14-5V24" /></svg>,
  collections: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="15" height="15" rx="3" /><rect x="27" y="6" width="15" height="15" rx="3" /><rect x="6" y="27" width="15" height="15" rx="3" /><rect x="27" y="27" width="15" height="15" rx="3" /></svg>,
  widgets: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="36" height="36" rx="4" /><line x1="6" y1="14" x2="42" y2="14" /><rect x="10" y="18" width="12" height="8" rx="2" /><rect x="26" y="18" width="12" height="8" rx="2" /><rect x="10" y="30" width="28" height="6" rx="2" /></svg>,
  providerImport: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M24 34V14" /><path d="M17 21l7-7 7 7" /><rect x="10" y="34" width="28" height="6" rx="2" /></svg>,
  vehicleSpecs: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="4" width="32" height="40" rx="3" /><line x1="14" y1="12" x2="34" y2="12" /><line x1="14" y1="18" x2="34" y2="18" /><line x1="14" y1="24" x2="34" y2="24" /><rect x="14" y="30" width="20" height="8" rx="2" /></svg>,
  pushEngine: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M24 38V10" /><path d="M16 18l8-8 8 8" /><path d="M14 42h20" /></svg>,
  pricingEngine: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="10" y="6" width="28" height="36" rx="4" /><line x1="16" y1="14" x2="32" y2="14" /><line x1="16" y1="20" x2="32" y2="20" /><line x1="16" y1="26" x2="24" y2="26" /><text x="17" y="36" fontSize="10" fill="#818cf8" stroke="none" fontWeight="700">$</text><text x="27" y="36" fontSize="10" fill="#818cf8" stroke="none" fontWeight="700">$</text></svg>,
};
const SYSTEM_ICONS = [SysIcons.extraction, SysIcons.ymmeDb, SysIcons.collections, SysIcons.widgets, SysIcons.providerImport, SysIcons.vehicleSpecs, SysIcons.pushEngine, SysIcons.pricingEngine];

// ─── Hooks ───
function useCounter(end: number, dur?: number) {
  const actualDur = dur ?? (end > 1000 ? 2500 : 2000);
  const [v, setV] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        const t0 = performance.now();
        const tick = (now: number) => { const p = Math.min((now - t0) / actualDur, 1); const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); setV(Math.floor(eased * end)); if (p < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    obs.observe(el); return () => obs.disconnect();
  }, [end, actualDur]);
  return { v, ref };
}

function useIOReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el); return () => obs.disconnect();
  }, []);
  return { ref, vis };
}

function IOReveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, vis } = useIOReveal();
  return <div ref={ref} className={`lp-io-reveal ${vis ? "visible" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>;
}

function Stat({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return <div ref={c.ref} className="lp-stat"><div className="lp-stat-val">{c.v.toLocaleString()}</div><div className="lp-stat-label">{label}</div></div>;
}

// ─── Make logos ───
const MAKES = [
  { name: "BMW", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" },
  { name: "Audi", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/audi.png" },
  { name: "Mercedes-Benz", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/mercedes-benz.png" },
  { name: "Volkswagen", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/volkswagen.png" },
  { name: "Toyota", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/toyota.png" },
  { name: "Ford", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/ford.png" },
  { name: "Porsche", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/porsche.png" },
  { name: "Honda", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/honda.png" },
  { name: "Chevrolet", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/chevrolet.png" },
  { name: "Nissan", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/nissan.png" },
];

// ─── UK Flag ───
const UKFlag = () => (
  <svg width="32" height="22" viewBox="0 0 60 40" style={{ display: "block", flexShrink: 0 }}>
    <rect width="60" height="40" fill="#012169" /><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6" /><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3" /><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10" /><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6" />
  </svg>
);

// ═══════════════════════════════════════════════
// WIDGET DEMOS
// ═══════════════════════════════════════════════

function YMMEDemo() {
  const [step, setStep] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        [500, 1200, 1800, 2400, 3000, 3500, 4200, 4800].forEach((d, i) => setTimeout(() => setStep(i + 1), d));
      }
    }, { threshold: 0.3 });
    obs.observe(el); return () => obs.disconnect();
  }, []);

  const garageCount = step >= 8 ? 3 : step >= 5 ? 1 : 0;
  const showGarage = step >= 6;
  const SearchIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>;
  const GarageIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13" rx="1" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>;

  const garageVehicles = step >= 8
    ? [{ year: "2022", make: "BMW", model: "3 Series", engine: "M340i (382 Hp)" }, { year: "2013", make: "Porsche", model: "Panamera", engine: "4.8L V8 \u00b7 440 Hp" }, { year: "2004", make: "BMW", model: "6 Series", engine: "645Ci \u00b7 333 Hp" }]
    : [{ year: "2022", make: "BMW", model: "3 Series", engine: "M340i (382 Hp)" }];

  return (
    <div ref={containerRef}>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="lp-demo-light" style={{ padding: 28 }}>
        <div className="demo-title" style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Find Parts for Your Vehicle</div>
        <div className="demo-grid-ymme">
          <div>
            <div className="demo-label">Make</div>
            {step >= 1 ? <div className="demo-sel ymme-anim-fill"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><img src={MAKES[0].logo} alt="" width="22" height="22" style={{ objectFit: "contain" }} />BMW</span>{I.chev}</div> : <div className="demo-sel"><span style={{ color: "#9ca3af" }}>Select...</span>{I.chev}</div>}
          </div>
          <div>
            <div className="demo-label">Model</div>
            {step >= 2 ? <div className="demo-sel ymme-anim-fill"><span>3 Series</span>{I.chev}</div> : <div className="demo-sel"><span style={{ color: "#9ca3af" }}>Select...</span>{I.chev}</div>}
          </div>
          <div>
            <div className="demo-label">Year</div>
            {step >= 3 ? <div className="demo-sel ymme-anim-fill"><span>2022</span>{I.chev}</div> : <div className="demo-sel"><span style={{ color: "#9ca3af" }}>Select...</span>{I.chev}</div>}
          </div>
          <div>
            <div className="demo-label">Engine</div>
            {step >= 4 ? <div className="demo-sel ymme-anim-fill"><span>M340i (382 Hp)</span>{I.chev}</div> : <div className="demo-sel"><span style={{ color: "#9ca3af" }}>Select...</span>{I.chev}</div>}
          </div>
          <div style={{ alignSelf: "end" }}>
            {step >= 5 ? <button className="ymme-find-btn" style={{ animation: "ymme-fade-in 0.4s ease" }}>{SearchIcon} Find Parts</button> : <button className="ymme-find-btn" style={{ opacity: 0.4 }}>{SearchIcon} Find Parts</button>}
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="demo-garage-btn" style={{ width: 44, height: 44 }}>
              {GarageIcon}
              {garageCount > 0 && <span className="demo-garage-badge">{garageCount}</span>}
            </button>
          </div>
        </div>
        {showGarage && (
          <div className="demo-garage-light" style={{ animation: "ymme-fade-in 0.3s ease" }}>
            <div className="demo-garage-hdr"><span>My Garage</span><span style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}>{garageVehicles.length} vehicle{garageVehicles.length !== 1 ? "s" : ""}</span></div>
            {garageVehicles.map((v, i) => (
              <div key={i} className="demo-garage-item" style={i > 0 && step >= 8 ? { animation: "ymme-fade-in 0.4s ease" } : undefined}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{v.year} {v.make} {v.model}</div><div style={{ fontSize: 12, color: "#6b7280" }}>{v.engine}</div></div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button style={{ padding: "4px 12px", borderRadius: 6, background: "#6366f1", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>Select</button>
                  <button style={{ padding: "4px 6px", borderRadius: 6, background: "#f3f4f6", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="demo-footer-light" style={{ marginTop: 18, paddingTop: 14 }}>{I.logo(12)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function PlateDemo() {
  const [plate, setPlate] = useState("");
  const [show, setShow] = useState(true);
  const [motOpen, setMotOpen] = useState(true);
  const [typed, setTyped] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        setShow(false);
        const text = "AL61 EAJ";
        let i = 0;
        const typeNext = () => {
          if (i < text.length) { i++; setPlate(text.slice(0, i)); setTimeout(typeNext, 120 + Math.random() * 80); }
          else { setTyped(true); setTimeout(() => setShow(true), 400); }
        };
        setTimeout(typeNext, 600);
      }
    }, { threshold: 0.3 });
    obs.observe(el); return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef}>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="lp-demo-light demo-plate-light">
        <div className="demo-title" style={{ textAlign: "center" }}>Find Parts by Registration</div>
        <div className="demo-subtitle" style={{ textAlign: "center" }}>Enter your UK registration number to find compatible parts</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div className="demo-plate-wrap" style={{ flex: 1 }}>
            <div className="demo-plate-gb"><UKFlag /></div>
            <input className={`demo-plate-input${!typed ? " plate-typing" : ""}`} placeholder="AB12 CDE" value={plate || "AL61 EAJ"} readOnly />
          </div>
          <button className="demo-plate-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            Look Up
          </button>
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Recent</div>
        <div className="demo-recent-row">
          <div className="demo-recent-chip"><span style={{ background: "#facc15", color: "#000", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>S777 MNH</span> Porsche Panamera</div>
          <div className="demo-recent-chip"><span style={{ background: "#facc15", color: "#000", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>AL61 EAJ</span> BMW 3 Series</div>
        </div>
        <div className={`demo-plate-result-wrap ${show ? "show" : ""}`}>
          {show && <div className="demo-plate-result">
            <div className="demo-plate-badges">
              <span className="demo-plate-gb-badge">GB</span>
              <span className="demo-plate-yellow-badge">AL61 EAJ</span>
            </div>
            <div className="demo-plate-vehicle">BMW M340I XDRIVE MHEV AUTO</div>
            <div className="demo-plate-meta">2022 &middot; ORANGE &middot; HYBRID ELECTRIC</div>
            <div className="demo-specs-light">
              {[["Year", "2022"], ["Colour", "ORANGE"], ["Fuel Type", "HYBRID ELECTRIC"], ["Engine", "2998cc"], ["CO\u2082 Emissions", "176 g/km"], ["Type Approval", "M1"], ["Wheelplan", "2 AXLE RIGID BODY"], ["First Registered", "30 Mar 2022"]].map(([k, v], i) =>
                <div key={i} className="demo-spec-light"><span>{k}</span><span>{v}</span></div>
              )}
            </div>
            <div className="demo-status-row">
              <div><label>MOT</label><div className="demo-status-val"><span className="demo-status-dot green" />Valid</div><div className="demo-status-sub">Expires 11 Nov 2026</div></div>
              <div><label>TAX</label><div className="demo-status-val"><span className="demo-status-dot green" />Taxed</div><div className="demo-status-sub">Due 1 Nov 2026</div></div>
            </div>
            <button className="demo-btn-blue" style={{ width: "100%", height: 48, fontSize: 16, marginBottom: 8 }}>Find Parts for This Vehicle &rarr;</button>
            <div className="demo-mot-history">
              <button className="demo-mot-toggle" onClick={() => setMotOpen(!motOpen)}>
                <span>MOT History <span className="demo-mot-count">2 tests</span></span>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#6b7280" strokeWidth="1.5" style={{ transform: motOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M4 6l4 4 4-4" /></svg>
              </button>
              {motOpen && <div>
                <div className="demo-mot-item"><span className="demo-mot-date">12 Nov 2025</span><span className="demo-mot-pass">PASS</span><span className="demo-mot-miles">87,329 Mi</span></div>
                <div className="demo-mot-item"><span className="demo-mot-date">4 Apr 2025</span><span className="demo-mot-pass">PASS</span><span className="demo-mot-miles">72,485 Mi</span></div>
              </div>}
            </div>
          </div>}
        </div>
        <div className="demo-footer-light">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function CompatDemo() {
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="lp-demo-light">
        <div className="demo-title">Vehicle Compatibility</div>
        <div className="demo-subtitle">All compatible vehicles for this product</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Make", "Model", "Years", "Engine"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #f3f4f6", color: "#9ca3af", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
            <tbody>{[["BMW", "3 Series (F30)", "2012\u20132019", "320i (184 Hp)"], ["BMW", "3 Series (G20)", "2019\u20132024", "320i (184 Hp)"], ["BMW", "4 Series (F32)", "2013\u20132020", "420i (184 Hp)"], ["Audi", "A4 (B9)", "2016\u20132024", "2.0 TFSI (190 Hp)"], ["Mercedes", "C-Class (W205)", "2014\u20132021", "C200 (184 Hp)"]].map((r, i) =>
              <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontSize: 13 }}>{c}</td>)}</tr>
            )}</tbody>
          </table>
        </div>
        <div className="demo-footer-light">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function BadgeDemo() {
  const [s, setS] = useState<0 | 1 | 2>(0);
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="lp-demo-light" style={{ textAlign: "center" }}>
        <div className="demo-title">Fitment Badge</div>
        <div className="demo-subtitle">Real-time compatibility check on every product page</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 16 }}>
          {["Fits", "Doesn't Fit", "No Vehicle"].map((t, i) =>
            <button key={i} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid", background: s === i ? "#6366f1" : "#fff", color: s === i ? "#fff" : "#374151", borderColor: s === i ? "#6366f1" : "#e5e7eb" }} onClick={() => setS(i as 0 | 1 | 2)}>{t}</button>
          )}
        </div>
        <div className={`demo-badge-light ${s === 0 ? "fits" : s === 1 ? "nofit" : "none"}`}>
          {s === 0 && <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Fits your 2022 BMW 3 Series</>}
          {s === 1 && <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" /></svg> May not fit your 2022 BMW 3 Series</>}
          {s === 2 && <>Select a vehicle to check compatibility</>}
        </div>
      </div>
    </>
  );
}

const SPEC_VEHICLES = [
  { make: "Acura", model: "ILX", engine: "2.0L 4-Cyl, 150 Hp", hp: "150", disp: "2.0L", fuel: "Petrol", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/acura.png" },
  { make: "Alfa Romeo", model: "146", engine: "1.4L Twin Spark, 103 Hp", hp: "103", disp: "1.4L", fuel: "Petrol", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/alfa-romeo.png" },
  { make: "BMW", model: "3 Series", engine: "316i (102 Hp) M10B18", hp: "102", disp: "1.6L", fuel: "Petrol", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" },
  { make: "Audi", model: "A3", engine: "1.6L FSI, 115 Hp", hp: "115", disp: "1.6L", fuel: "Petrol", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/audi.png" },
  { make: "Mercedes-Benz", model: "C-Class", engine: "C200 2.0L Turbo, 184 Hp", hp: "184", disp: "2.0L", fuel: "Petrol", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/mercedes-benz.png" },
  { make: "Porsche", model: "Panamera", engine: "2.9L V6 Turbo, 440 Hp", hp: "440", disp: "2.9L", fuel: "Petrol", logo: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/porsche.png" },
];

function VehicleSpecsDemo() {
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="lp-demo-light">
        <div style={{ width: 40, height: 3, background: "#6366f1", borderRadius: 2, marginBottom: 10 }} />
        <div className="demo-title" style={{ fontSize: 18 }}>Vehicle Specifications</div>
        <div className="demo-subtitle">Browse detailed specs for all supported vehicles</div>
        <div className="demo-specs-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input placeholder="Search vehicles..." readOnly />
          <span className="demo-specs-count-big">353 vehicles</span>
        </div>
        <div className="demo-vehicle-grid">
          {SPEC_VEHICLES.map((v, i) => (
            <div key={i} className="demo-vehicle-card">
              <div className="demo-vehicle-card-make"><img src={v.logo} alt="" /><span>{v.make}</span></div>
              <h4>{v.model}</h4>
              <div className="desc">{v.engine}</div>
              <div className="demo-vehicle-card-pills">
                <span className="demo-vehicle-card-pill green">{v.hp} HP</span>
                <span className="demo-vehicle-card-pill">{v.disp}</span>
                <span className="demo-vehicle-card-pill">{v.fuel}</span>
              </div>
              <span className="demo-vehicle-card-link">View Specs &rarr;</span>
            </div>
          ))}
        </div>
        <div className="demo-footer-light">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function VehicleSpecDetailDemo() {
  const StatIcon = {
    hp: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
    torque: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-6.219-8.56" /><path d="M21 3v5h-5" /></svg>,
    displacement: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="12" height="16" rx="2" /><line x1="6" y1="8" x2="18" y2="8" /><line x1="6" y1="16" x2="18" y2="16" /></svg>,
    speed: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 00-6.88 17.23" /><path d="M12 2a10 10 0 016.88 17.23" /><path d="M12 12l3.5-6.06" /><circle cx="12" cy="12" r="1" /></svg>,
    stopwatch: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M10 2h4" /></svg>,
    fuel: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 22V6a2 2 0 012-2h8a2 2 0 012 2v16" /><path d="M3 22h12" /><rect x="6" y="7" width="6" height="5" /></svg>,
  };
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="demo-spec-hero">
        <div className="demo-spec-hero-make"><img src="https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" alt="" /><span>BMW</span></div>
        <h2>3 Series</h2>
        <div className="sub">316i (102 Hp)</div>
        <div className="demo-spec-hero-tags">
          <span className="demo-spec-hero-tag">1987</span><span className="demo-spec-hero-tag">M10B18</span><span className="demo-spec-hero-tag">Petrol</span><span className="demo-spec-hero-tag">Sedan</span><span className="demo-spec-hero-tag">RWD</span>
        </div>
        <p>The BMW 316i is a compact executive sedan powered by the naturally aspirated M10B18 inline-4 engine, producing 102 horsepower and 140 Nm of torque.</p>
      </div>
      <div className="demo-quick-stats">
        <div className="demo-quick-stat"><div className="stat-icon">{StatIcon.hp}</div><div className="val">102</div><div className="label">HP</div></div>
        <div className="demo-quick-stat"><div className="stat-icon">{StatIcon.torque}</div><div className="val">140</div><div className="label">Nm</div></div>
        <div className="demo-quick-stat"><div className="stat-icon">{StatIcon.displacement}</div><div className="val">1.6L</div><div className="label">Displ.</div></div>
        <div className="demo-quick-stat"><div className="stat-icon">{StatIcon.speed}</div><div className="val">182</div><div className="label">km/h</div></div>
        <div className="demo-quick-stat"><div className="stat-icon">{StatIcon.stopwatch}</div><div className="val">12.1s</div><div className="label">0-100</div></div>
        <div className="demo-quick-stat"><div className="stat-icon">{StatIcon.fuel}</div><div className="val">Petrol</div><div className="label">Fuel</div></div>
      </div>
      <div className="demo-tab-bar">
        <button className="demo-tab active">Engine</button><button className="demo-tab">Performance</button><button className="demo-tab">Drivetrain</button><button className="demo-tab">Dimensions</button>
      </div>
      <div style={{ background: "#fff" }}>
        <table className="demo-spec-table"><tbody>
          {[["Engine Code", "M10B18"], ["Displacement", "1.6L (1,573 cc)"], ["Cylinders", "4"], ["Configuration", "Inline"], ["Aspiration", "Naturally aspirated"], ["Power", "102 HP @ 5,800 rpm"], ["Torque", "140 Nm @ 4,500 rpm"], ["Valves", "8 (2 per cyl)"], ["Bore x Stroke", "89.0 x 71.0 mm"], ["Compression", "9.5:1"], ["Fuel System", "Bosch L-Jetronic"]].map(([k, v], i) =>
            <tr key={i}><td>{k}</td><td>{v}</td></tr>
          )}
        </tbody></table>
      </div>
      <div style={{ background: "#fff", padding: "12px 24px" }}>
        <div className="demo-footer-light">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function VINDecodeDemo() {
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" /></div>
      <div className="lp-demo-light" style={{ textAlign: "center" }}>
        <div className="demo-title">Decode Your VIN</div>
        <div className="demo-subtitle">Enter your 17-character Vehicle Identification Number</div>
        <div className="demo-vin-input-row">
          <span className="demo-vin-badge">VIN</span>
          <div className="demo-vin-field"><input value="WBAPH5C55BA123456" readOnly style={{ letterSpacing: 1.5 }} /><span className="demo-vin-counter">17/17</span></div>
          <button className="demo-btn-blue">Decode VIN</button>
        </div>
        <div className="demo-vin-result">
          <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M3 8l3 3 7-7" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            VIN Decoded Successfully
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>2011 BMW 5 Series 528i</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>WBAPH5C55BA123456</div>
          <div className="demo-vin-specs-grid">
            {[["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Trim", "528i"], ["Body", "Sedan"], ["Drive", "RWD"], ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Transmission", "Automatic"], ["Country", "Germany"]].map(([k, v], i) =>
              <div key={i} className="demo-vin-spec-cell"><div className="demo-vin-spec-key">{k}</div><div className="demo-vin-spec-val">{v}</div></div>
            )}
          </div>
          <button className="demo-btn-blue" style={{ width: "100%", marginTop: 12 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            Find Compatible Parts
          </button>
        </div>
        <div className="demo-footer-light">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════
// INTERACTIVE DASHBOARD
// ═══════════════════════════════════════════════
const IDASH_NAV = ["Dashboard", "Products", "Push to Shopify", "Collections"] as const;
type IDashPage = typeof IDASH_NAV[number];

const NAV_ICONS: Record<IDashPage, JSX.Element> = {
  Dashboard: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>,
  Products: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4l6-2 6 2v8l-6 2-6-2z" /><path d="M8 6v8" /><path d="M2 4l6 2 6-2" /></svg>,
  "Push to Shopify": <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 12V4" /><path d="M5 7l3-3 3 3" /><path d="M3 14h10" /></svg>,
  Collections: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="4" width="14" height="10" rx="1.5" /><path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1" /></svg>,
};

function IDashDashboard() {
  return <>
    <div className="idash-title">Dashboard</div>
    <div className="idash-label">Quick Actions</div>
    <div className="idash-actions">
      <div className="idash-action"><span className="idash-dot" style={{ background: "#6366f1" }} /> Fetch Products</div>
      <div className="idash-action"><span className="idash-dot" style={{ background: "#f59e0b" }} /> Auto Extract <span className="idash-badge-orange">1,593 pending</span></div>
      <div className="idash-action"><span className="idash-dot" style={{ background: "#22c55e" }} /> Manual Map</div>
      <div className="idash-action idash-action-blue"><span className="idash-dot" style={{ background: "rgba(255,255,255,0.4)" }} /> Push to Shopify</div>
    </div>
    <div className="idash-stats-row">
      <div className="idash-stat-card"><div className="idash-stat-num">2,844</div><div className="idash-stat-lbl">Total Products</div></div>
      <div className="idash-stat-card"><div className="idash-stat-num">5,827</div><div className="idash-stat-lbl">Vehicle Links</div></div>
      <div className="idash-stat-card"><div className="idash-stat-num">1,251</div><div className="idash-stat-lbl">Mapped</div></div>
      <div className="idash-stat-card"><div className="idash-stat-num">44%</div><div className="idash-stat-lbl">Coverage</div></div>
    </div>
    <div className="idash-label">Fitment Coverage</div>
    <div className="idash-progress-wrap">
      <div className="idash-progress-bar"><div className="idash-progress-fill" style={{ width: "44%" }} /></div>
      <div className="idash-progress-labels"><span>1,593 Needs Review</span><span>1,251 Mapped</span></div>
    </div>
    <div className="idash-bottom-row">
      <div className="idash-bottom-card"><div className="idash-label">Top Makes</div><div className="idash-kv"><span>Audi</span><strong>584</strong></div><div className="idash-kv"><span>Aria</span><strong>308</strong></div><div className="idash-kv"><span>Alfa Romeo</span><strong>103</strong></div></div>
      <div className="idash-bottom-card"><div className="idash-label">YMME Database</div><div className="idash-kv"><span>Makes</span><strong>374</strong></div><div className="idash-kv"><span>Models</span><strong>3,888</strong></div><div className="idash-kv"><span>Engines</span><strong>29,515</strong></div></div>
    </div>
  </>;
}

function IDashProducts() {
  const rows = [
    { name: "Eibach Pro-Kit Lowering Springs", status: "auto_mapped", tone: "green", fitments: 12 },
    { name: "MST Performance BMW Intake", status: "auto_mapped", tone: "green", fitments: 8 },
    { name: "Scorpion Exhaust System", status: "unmapped", tone: "gray", fitments: 0 },
    { name: "Bilstein B14 Coilover Kit", status: "flagged", tone: "orange", fitments: 3 },
    { name: "K&N Air Filter BMW E90", status: "auto_mapped", tone: "green", fitments: 15 },
  ];
  return <>
    <div className="idash-title">Products <span className="idash-title-sub">2,844 products</span></div>
    <table className="idash-table">
      <thead><tr><th>Product</th><th>Status</th><th>Fitments</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td className="idash-td-name">{r.name}</td><td><span className={`idash-status-badge idash-status-${r.tone}`}>{r.status}</span></td><td className="idash-td-num">{r.fitments}</td></tr>)}</tbody>
    </table>
  </>;
}

function IDashPush() {
  return <>
    <div className="idash-title">Push to Shopify</div>
    <button className="idash-push-btn">Push All Mapped Products</button>
    <div className="idash-push-checks">
      <label className="idash-check"><input type="checkbox" defaultChecked readOnly /> Push Tags</label>
      <label className="idash-check"><input type="checkbox" defaultChecked readOnly /> Push Metafields</label>
      <label className="idash-check"><input type="checkbox" defaultChecked readOnly /> Create Collections</label>
    </div>
    <div className="idash-push-last">2,844 products pushed &middot; 1h ago</div>
  </>;
}

function IDashCollections() {
  const cols = [
    { name: "BMW Parts", count: 423, logo: MAKES[0].logo },
    { name: "Audi Parts", count: 312, logo: MAKES[1].logo },
    { name: "Mercedes Parts", count: 189, logo: MAKES[2].logo },
    { name: "Volkswagen Parts", count: 156, logo: MAKES[3].logo },
  ];
  return <>
    <div className="idash-title">Collections <span className="idash-title-sub">1,125 collections</span></div>
    <div className="idash-col-grid">
      {cols.map((c, i) => <div key={i} className="idash-col-card"><img src={c.logo} alt="" className="idash-col-logo" /><div><div className="idash-col-name">{c.name}</div><div className="idash-col-count">{c.count} products</div></div></div>)}
    </div>
  </>;
}

function InteractiveDashboard() {
  const [page, setPage] = useState<IDashPage>("Dashboard");
  return (
    <div className="lp-interactive-dash">
      <div className="lp-idash-sidebar">
        <div className="lp-idash-logo">{I.logo(16)} AutoSync</div>
        {IDASH_NAV.map(n => (
          <div key={n} className={`lp-idash-nav-item ${page === n ? "active" : ""}`} onClick={() => setPage(n)}>{NAV_ICONS[n]} {n}</div>
        ))}
      </div>
      <div className="lp-idash-main">
        {page === "Dashboard" && <IDashDashboard />}
        {page === "Products" && <IDashProducts />}
        {page === "Push to Shopify" && <IDashPush />}
        {page === "Collections" && <IDashCollections />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// FEATURE WALL
// ═══════════════════════════════════════════════
const FEATURE_WALL_ITEMS = [
  { id: "ymme", title: "YMME Vehicle Search", desc: "Cascading Make/Model/Year/Engine dropdowns with brand logos and My Garage" },
  { id: "plate", title: "UK Plate Lookup", desc: "DVLA registration lookup with MOT history and tax status" },
  { id: "compat", title: "Vehicle Compatibility", desc: "Full compatibility table showing all vehicles a product fits" },
  { id: "badge", title: "Fitment Badge", desc: "Real-time fits/doesn't fit badge on every product page" },
  { id: "specs", title: "Vehicle Specifications", desc: "SEO-optimized spec pages with search and filtering" },
  { id: "detail", title: "Vehicle Spec Detail", desc: "Rich detail pages with performance data and engine specs" },
  { id: "vin", title: "VIN Decode", desc: "17-character VIN decoder for all major manufacturers" },
] as const;

type FeatureId = typeof FEATURE_WALL_ITEMS[number]["id"];

const FEATURE_DEMOS: Record<FeatureId, () => JSX.Element> = {
  ymme: YMMEDemo,
  plate: PlateDemo,
  compat: CompatDemo,
  badge: BadgeDemo,
  specs: VehicleSpecsDemo,
  detail: VehicleSpecDetailDemo,
  vin: VINDecodeDemo,
};

function FeatureWall() {
  const [active, setActive] = useState<FeatureId>("ymme");
  const Demo = FEATURE_DEMOS[active];
  return (
    <div className="lp-feature-wall">
      <div className="lp-fw-nav">
        {FEATURE_WALL_ITEMS.map(f => (
          <div key={f.id} className={`lp-fw-item ${active === f.id ? "active" : ""}`} onClick={() => setActive(f.id)}>
            <div className="lp-fw-item-title">{f.title}</div>
            <div className="lp-fw-item-desc">{f.desc}</div>
          </div>
        ))}
      </div>
      <div className="lp-fw-demo">
        <div key={active} className="lp-fw-demo-inner">
          <Demo />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════
const PLANS = [
  { name: "Free", price: 0, products: "50", fitments: "200", providers: "0", makes: "5", features: ["Manual mapping", "Product browser", "Help docs", "50 product limit", "Basic support", "YMME data access"], pop: false },
  { name: "Starter", price: 19, products: "1,000", fitments: "5,000", providers: "1", makes: "20", features: ["Push tags & metafields", "YMME Search widget", "Fitment Badge", "Compatibility table", "1 provider import", "Email support"], pop: false },
  { name: "Growth", price: 49, products: "10,000", fitments: "50,000", providers: "3", makes: "50", features: ["All Starter features", "Smart auto-extraction", "All 4 storefront widgets", "Make collections", "Bulk operations", "Analytics dashboard"], pop: true },
  { name: "Professional", price: 99, products: "50,000", fitments: "250,000", providers: "5", makes: "100", features: ["All Growth features", "API & FTP data import", "Wheel Finder widget", "Vehicle Spec Pages", "Make+Model collections", "Priority support"], pop: false },
  { name: "Business", price: 179, products: "200,000", fitments: "1,000,000", providers: "15", makes: "200", features: ["All Professional features", "Pricing Engine", "Year-range collections", "My Garage widget", "Dedicated support", "Custom branding"], pop: false },
  { name: "Enterprise", price: 299, products: "Unlimited", fitments: "Unlimited", providers: "Unlimited", makes: "Unlimited", features: ["All Business features", "UK Plate Lookup (DVLA)", "VIN Decode", "Full CSS customisation", "SLA guarantee", "White-glove onboarding"], pop: false },
];

const COMPS = [
  { n: "AutoSync", p: "Free\u2013$299", hl: true, db: 1, ext: 1, col: 1, w: "7", pl: 1, vin: 1, wh: 1, api: 1, an: 1, vp: 1 },
  { n: "Convermax", p: "$250\u2013$850", hl: false, db: 0, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 1, api: 0, an: 0, vp: 1 },
  { n: "EasySearch", p: "$19\u2013$75", hl: false, db: 1, ext: 0, col: 0, w: "2", pl: 0, vin: 0, wh: 0, api: 0, an: 0, vp: 0 },
  { n: "PCFitment", p: "$15\u2013$150", hl: false, db: 1, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 0, api: 0, an: 1, vp: 0 },
  { n: "VFitz", p: "$1\u2013$58", hl: false, db: 1, ext: 0, col: 0, w: "1", pl: 0, vin: 0, wh: 0, api: 0, an: 1, vp: 0 },
  { n: "AutoFit AI", p: "$50\u2013$250", hl: false, db: 0, ext: 1, col: 0, w: "2", pl: 0, vin: 0, wh: 0, api: 0, an: 0, vp: 0 },
];

const FAQS = [
  { q: "What is YMME and why does my store need it?", a: "YMME (Year, Make, Model, Engine) is the industry standard for vehicle parts compatibility. It helps customers find parts that fit their specific vehicle, reducing returns by up to 80% and increasing conversions." },
  { q: "Do I need to manually enter all vehicle data?", a: "No. AutoSync includes a pre-loaded database of 374+ makes, 3,686 models, and 29,515 engines. Our smart extraction engine automatically detects vehicle compatibility from your existing product titles and descriptions." },
  { q: "How does the UK plate lookup work?", a: "Enterprise plan includes DVLA integration. Customers enter their UK registration number and instantly see their vehicle details, MOT history, tax status, and compatible parts from your store." },
  { q: "Will the widgets work with my Shopify theme?", a: "Yes. All widgets are Shopify Theme App Extension blocks that work with any Online Store 2.0 theme. Drag and drop in the theme editor, zero code changes required." },
  { q: "How is AutoSync different from Convermax?", a: "Convermax starts at $250/month with complex setup. AutoSync offers more features including plate lookup, VIN decode, smart collections, auto-extraction, and 7 widgets, starting free with self-service setup." },
  { q: "Can I import products from supplier feeds?", a: "Yes. AutoSync supports CSV, XML, JSON, REST API, and FTP imports with smart column mapping that auto-detects fields and remembers your mappings for future imports." },
  { q: "What happens if I exceed plan limits?", a: "You\u2019ll be notified before reaching limits. Upgrade anytime with no data loss. Your data is never deleted \u2014 you just can\u2019t add more until you upgrade." },
  { q: "Is there a free trial?", a: "The Free plan lets you try AutoSync with 50 products at no cost, forever. All paid plans include a 30-day free trial." },
];

const SYSTEMS = [
  { t: "Smart Extraction", d: "Pattern-matching engine with 55 make patterns, model detection, and 3-tier confidence routing.", s: "80%+ accuracy" },
  { t: "YMME Database", d: "Pre-loaded vehicle database with every make, model, and engine worldwide.", s: "29K+ engines" },
  { t: "Smart Collections", d: "Auto-creates SEO-optimized Shopify collections with brand logos and meta descriptions.", s: "3 strategies" },
  { t: "7 Storefront Widgets", d: "YMME Search, Fitment Badge, Compatibility Table, Plate Lookup, VIN Decode, Wheel Finder, Vehicle Specs.", s: "7 widgets" },
  { t: "Provider Import", d: "Import from CSV, XML, JSON, REST API, or FTP. Smart column mapper auto-detects fields.", s: "5 formats" },
  { t: "Vehicle Spec Pages", d: "Auto-generated SEO pages with 90+ engine specs pushed as Shopify metaobjects.", s: "90+ fields" },
  { t: "Shopify Push Engine", d: "Pushes tags, 5 metafield types, and activates Search & Discovery filters automatically.", s: "5 metafields" },
  { t: "Pricing Engine", d: "Markup, margin, fixed, and MAP pricing rules scoped by vendor, product type, or tag.", s: "4 rule types" },
];

const STEPS = [
  { n: "1", t: "Install & Import", d: "Install from the Shopify App Store. Fetch your products or import from CSV, XML, API, or FTP suppliers." },
  { n: "2", t: "Auto-Extract", d: "Smart extraction scans product data and detects vehicle compatibility with 80%+ accuracy." },
  { n: "3", t: "Push to Shopify", d: "Push tags, metafields, and smart collections. Search & Discovery filters activate automatically." },
  { n: "4", t: "Sell More Parts", d: "Customers find parts that fit. Fewer returns, higher conversions, better SEO rankings." },
];

// ═══════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const [showMorePlans, setShowMorePlans] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const dashSectionRef = useRef<HTMLElement>(null);
  const stepsLineRef = useRef<HTMLDivElement>(null);
  const systemsRef = useRef<HTMLDivElement>(null);

  // Scroll listener
  useEffect(() => {
    const fn = () => { setScrolled(window.scrollY > 20); setShowBackToTop(window.scrollY > 500); };
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Hero word animation
  useEffect(() => {
    if (typeof window === "undefined") return;
    const words = document.querySelectorAll(".lp-hero-word");
    words.forEach((w, i) => {
      setTimeout(() => w.classList.add("visible"), 200 + i * 80);
    });
  }, []);

  // GSAP: dashboard pinning + auto-cycling + steps line
  useEffect(() => {
    if (typeof window === "undefined") return;
    let ctx: any;
    (async () => {
      try {
        const { gsap } = await import("gsap");
        const { ScrollTrigger } = await import("gsap/ScrollTrigger");
        gsap.registerPlugin(ScrollTrigger);

        ctx = gsap.context(() => {
          // Steps line fill
          if (stepsLineRef.current) {
            gsap.to(stepsLineRef.current, {
              width: "100%",
              ease: "none",
              scrollTrigger: {
                trigger: stepsLineRef.current.parentElement,
                start: "top 70%",
                end: "bottom 50%",
                scrub: true,
              },
            });
          }
        });
      } catch (_e) { /* GSAP failed — graceful fallback */ }
    })();
    return () => { if (ctx) ctx.revert(); };
  }, []);

  // Dashboard auto-cycling
  useEffect(() => {
    if (typeof window === "undefined") return;
    // We'll dispatch a custom event to cycle the dashboard pages
    const pages: IDashPage[] = ["Dashboard", "Products", "Push to Shopify", "Collections"];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % pages.length;
      const event = new CustomEvent("dash-cycle", { detail: pages[idx] });
      window.dispatchEvent(event);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // IntersectionObserver for system cards
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = systemsRef.current; if (!el) return;
    const cards = el.querySelectorAll(".lp-sys");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const card = entry.target as HTMLElement;
          const idx = Array.from(cards).indexOf(card);
          setTimeout(() => card.classList.add("revealed"), idx * 80);
          obs.unobserve(card);
        }
      });
    }, { threshold: 0.1 });
    cards.forEach(c => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  const visiblePlans = showMorePlans ? PLANS : PLANS.slice(0, 3);

  return (
    <div className="lp">

      {/* ── Nav ── */}
      <nav className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-w lp-nav-inner">
          <a href="#" className="lp-logo">{I.logo()} AutoSync</a>
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="lp-btn lp-btn-accent">Get Started</a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-w" style={{ position: "relative", zIndex: 1 }}>
          <div ref={heroRef}>
            <h1 className="lp-hero-title">
              {["Vehicle", "fitment"].map((w, i) => <span key={i} className="lp-hero-word">{w}</span>)}
              <span className="lp-hero-word accent">intelligence</span>
              {["for", "Shopify"].map((w, i) => <span key={i + 3} className="lp-hero-word">{w}</span>)}
            </h1>
            <p className="lp-hero-sub">Help customers find parts that fit. YMME search, auto-extraction, smart collections, and 7 storefront widgets for automotive e-commerce.</p>
            <div className="lp-hero-ctas">
              <a href="#login" className="lp-btn lp-btn-accent lp-btn-lg">Start Free Trial {I.arr}</a>
              <a href="#features" className="lp-btn lp-btn-outline lp-btn-lg">See Features</a>
            </div>
          </div>
          <div className="lp-stats">
            <Stat value={stats.makes} label="Makes" />
            <Stat value={stats.models} label="Models" />
            <Stat value={stats.engines} label="Engines" />
            <Stat value={stats.products} label="Products" />
          </div>
        </div>
      </section>

      {/* ── Interactive Dashboard (pinned) ── */}
      <section ref={dashSectionRef} className="lp-dash-section">
        <div className="lp-w">
          <InteractiveDashboard />
        </div>
      </section>

      {/* ── Feature Wall ── */}
      <section id="features" className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-section-header center">
              <span className="lp-tag">Storefront Widgets</span>
              <div className="lp-h2">7 widgets. One platform.</div>
              <p className="lp-sub">Every widget your automotive store needs, built as native Shopify Theme App Extension blocks.</p>
            </div>
          </IOReveal>
          <IOReveal delay={0.1}>
            <FeatureWall />
          </IOReveal>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-section-header center">
              <span className="lp-tag">How It Works</span>
              <div className="lp-h2">From install to sales in 4 steps</div>
            </div>
          </IOReveal>
          <div className="lp-steps">
            <div className="lp-steps-line"><div ref={stepsLineRef} className="lp-steps-line-fill" /></div>
            {STEPS.map((s, i) => (
              <IOReveal key={i} delay={i * 0.1}>
                <div className="lp-step">
                  <div className="lp-step-num">{s.n}</div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Systems Grid ── */}
      <section id="systems" className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-section-header center">
              <span className="lp-tag">Platform</span>
              <div className="lp-h2">Every system, explained</div>
              <p className="lp-sub">AutoSync is a complete platform with 8 integrated systems working together.</p>
            </div>
          </IOReveal>
          <div className="lp-systems" ref={systemsRef}>
            {SYSTEMS.map((sys, i) => (
              <div key={i} className="lp-sys">
                <div className="lp-sys-icon">{SYSTEM_ICONS[i]}</div>
                <h3>{sys.t}</h3>
                <p>{sys.d}</p>
                <span className="lp-sys-stat">{sys.s}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="lp-section lp-section-alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-section-header center">
              <span className="lp-tag">Pricing</span>
              <div className="lp-h2">Simple, transparent pricing</div>
              <p className="lp-sub">Start free. Scale as you grow. Cancel anytime.</p>
            </div>
          </IOReveal>
          <div className="lp-pricing">
            {visiblePlans.map((p, i) => (
              <IOReveal key={p.name} delay={i * 0.05}>
                <div className={`lp-price ${p.pop ? "pop" : ""}`}>
                  {p.pop && <div className="lp-price-badge">Most Popular</div>}
                  <div className="lp-price-name">{p.name}</div>
                  <div style={{ marginBottom: 14 }}>
                    {p.price === 0 ? <span className="lp-price-amt">Free</span> : <><span className="lp-price-amt">${p.price}</span><span className="lp-price-per">/mo</span></>}
                  </div>
                  <div className="lp-price-limits">
                    <div><strong>{p.products}</strong> products</div>
                    <div><strong>{p.fitments}</strong> fitments</div>
                    <div><strong>{p.providers}</strong> providers</div>
                    <div><strong>{p.makes}</strong> active makes</div>
                  </div>
                  <ul className="lp-price-feat">
                    {p.features.map((f, j) => <li key={j}>{I.chk} {f}</li>)}
                  </ul>
                  <a href="#login" className={`lp-btn ${p.pop ? "lp-btn-accent" : "lp-btn-outline"}`} style={{ width: "100%" }}>
                    {p.price === 0 ? "Get Started" : "Start Free Trial"}
                  </a>
                </div>
              </IOReveal>
            ))}
          </div>
          {!showMorePlans && <div style={{ textAlign: "center", marginTop: 24 }}>
            <button className="lp-btn lp-btn-outline" onClick={() => setShowMorePlans(true)}>
              Show all plans {I.chev}
            </button>
          </div>}
        </div>
      </section>

      {/* ── Compare ── */}
      <section id="compare" className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-section-header center">
              <span className="lp-tag">Comparison</span>
              <div className="lp-h2">AutoSync vs the competition</div>
            </div>
          </IOReveal>
          <IOReveal delay={0.1}>
            <div className="lp-compare-wrap">
              <table className="lp-tbl">
                <thead><tr>
                  <th>Feature</th>
                  {COMPS.map((c, i) => <th key={i} className={c.hl ? "hl" : ""}>{c.hl ? <strong>{c.n}</strong> : c.n}</th>)}
                </tr></thead>
                <tbody>
                  <tr><td>Price</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.p}</td>)}</tr>
                  {([["YMME Database", "db"], ["Auto Extraction", "ext"], ["Smart Collections", "col"], ["UK Plate Lookup", "pl"], ["VIN Decode", "vin"], ["Wheel Finder", "wh"], ["API/FTP Import", "api"], ["Analytics", "an"], ["Vehicle Pages", "vp"]] as const).map(([label, key]) =>
                    <tr key={key}><td>{label}</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{(c as any)[key] === 1 ? I.chk : (c as any)[key] === 0 ? I.x : (c as any)[key]}</td>)}</tr>
                  )}
                  <tr><td>Widgets</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.w}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </IOReveal>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="lp-section lp-section-alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-section-header center">
              <span className="lp-tag">FAQ</span>
              <div className="lp-h2">Frequently asked questions</div>
            </div>
          </IOReveal>
          <div className="lp-faq-list">
            {FAQS.map((item, i) => (
              <IOReveal key={i} delay={i * 0.03}>
                <div className={`lp-faq ${faq === i ? "open" : ""}`}>
                  <button className="lp-faq-q" onClick={() => setFaq(faq === i ? null : i)}>{item.q}<span className="lp-faq-ico">+</span></button>
                  {faq === i && <div className="lp-faq-a">{item.a}</div>}
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta-section">
        <div className="lp-w" style={{ position: "relative", zIndex: 1 }}>
          <IOReveal>
            <div className="lp-h2" style={{ textAlign: "center" }}>Ready to sell more parts?</div>
            <p style={{ fontSize: 16, color: "var(--text-secondary)", marginBottom: 28, textAlign: "center", maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>Join automotive stores using AutoSync to help customers find parts that fit.</p>
            <div style={{ textAlign: "center" }}><a href="#login" className="lp-btn lp-btn-accent lp-btn-lg">Start Your Free Trial {I.arr}</a></div>
          </IOReveal>
        </div>
      </section>

      {/* ── Login ── */}
      <section id="login" className="lp-section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="lp-w" style={{ maxWidth: 420, textAlign: "center" }}>
          {I.logo(40)}
          <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 6px", letterSpacing: "-0.02em" }}>AutoSync</div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>Enter your Shopify store domain to get started</p>
          {showForm && <Form method="post" action="/auth/login">
            <div style={{ display: "flex", gap: 6 }}>
              <input name="shop" className="lp-login-input" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)} />
              <button type="submit" className="lp-btn lp-btn-accent">Install</button>
            </div>
          </Form>}
        </div>
      </section>

      {/* ── Back to Top ── */}
      {showBackToTop && (
        <button className="lp-back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
        </button>
      )}

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-w">
          <div className="lp-footer-grid">
            <div>
              <div className="lp-footer-brand">{I.logo(18)} AutoSync</div>
              <p className="lp-footer-desc">Vehicle fitment intelligence for Shopify. Help customers find parts that fit their vehicle.</p>
            </div>
            <div><h4>Product</h4><div className="lp-footer-links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></div></div>
            <div><h4>Company</h4><div className="lp-footer-links"><a href="#">About</a><a href="#">Blog</a><a href="#">Changelog</a></div></div>
            <div><h4>Legal</h4><div className="lp-footer-links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="mailto:support@autosync.app">Contact</a></div></div>
          </div>
          <div className="lp-footer-social">
            <a href="#" aria-label="Twitter"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg></a>
            <a href="#" aria-label="GitHub"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg></a>
          </div>
          <div className="lp-footer-bottom">&copy; {new Date().getFullYear()} AutoSync. All rights reserved. &middot; <a href="/legal/privacy" style={{ color: "inherit" }}>Privacy</a> &middot; <a href="/legal/terms" style={{ color: "inherit" }}>Terms</a></div>
        </div>
      </footer>
    </div>
  );
}
