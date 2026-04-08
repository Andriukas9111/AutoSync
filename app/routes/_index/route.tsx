import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef, useCallback } from "react";
import "./landing.css";

/* ═══════════════════════════════════════════════
   LOADER — Public YMME database stats
   ═══════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════
   SVG ICONS
   ═══════════════════════════════════════════════ */
const I = {
  logo: (s = 24) => <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z" /><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z" /></svg>,
  chk: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#5B7FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  x: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  arr: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4l4 4-4 4" /></svg>,
  chev: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4" /></svg>,
};

/* ═══════════════════════════════════════════════
   SYSTEM ICONS
   ═══════════════════════════════════════════════ */
const SysIcons = {
  extraction: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="20" cy="20" r="12" /><path d="M28.5 28.5L38 38" /><line x1="14" y1="17" x2="26" y2="17" /><line x1="14" y1="21" x2="24" y2="21" /><line x1="14" y1="25" x2="20" y2="25" /></svg>,
  ymmeDb: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="24" cy="14" rx="14" ry="5" /><path d="M10 14v10c0 2.76 6.27 5 14 5s14-2.24 14-5V14" /><path d="M10 24v10c0 2.76 6.27 5 14 5s14-2.24 14-5V24" /></svg>,
  collections: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="15" height="15" rx="3" /><rect x="27" y="6" width="15" height="15" rx="3" /><rect x="6" y="27" width="15" height="15" rx="3" /><rect x="27" y="27" width="15" height="15" rx="3" /></svg>,
  widgets: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="36" height="36" rx="4" /><line x1="6" y1="14" x2="42" y2="14" /><rect x="10" y="18" width="12" height="8" rx="2" /><rect x="26" y="18" width="12" height="8" rx="2" /><rect x="10" y="30" width="28" height="6" rx="2" /></svg>,
  providerImport: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M24 34V14" /><path d="M17 21l7-7 7 7" /><rect x="10" y="34" width="28" height="6" rx="2" /></svg>,
  vehicleSpecs: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="4" width="32" height="40" rx="3" /><line x1="14" y1="12" x2="34" y2="12" /><line x1="14" y1="18" x2="34" y2="18" /><line x1="14" y1="24" x2="34" y2="24" /><rect x="14" y="30" width="20" height="8" rx="2" /></svg>,
  pushEngine: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M24 38V10" /><path d="M16 18l8-8 8 8" /><path d="M14 42h20" /></svg>,
  pricingEngine: <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5B7FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="10" y="6" width="28" height="36" rx="4" /><line x1="16" y1="14" x2="32" y2="14" /><line x1="16" y1="20" x2="32" y2="20" /><line x1="16" y1="26" x2="24" y2="26" /></svg>,
};
const SYSTEM_ICONS = [SysIcons.extraction, SysIcons.ymmeDb, SysIcons.collections, SysIcons.widgets, SysIcons.providerImport, SysIcons.vehicleSpecs, SysIcons.pushEngine, SysIcons.pricingEngine];

/* ═══════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════ */
function useCounter(end: number, dur?: number) {
  const actualDur = dur ?? (end > 1000 ? 1400 : 1000);
  const [v, setV] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        const t0 = performance.now();
        const tick = (now: number) => { const p = Math.min((now - t0) / actualDur, 1); const eased = p === 1 ? 1 : 1 - Math.pow(2, -14 * p); setV(Math.floor(eased * end)); if (p < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.15 });
    obs.observe(el); return () => obs.disconnect();
  }, [end, actualDur]);
  return { v, ref };
}

function useIOReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.02 });
    obs.observe(el); return () => obs.disconnect();
  }, []);
  return { ref, vis };
}

function IOReveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, vis } = useIOReveal();
  return <div ref={ref} className={`lp-reveal ${vis ? "visible" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>;
}

function Stat({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return <div ref={c.ref} className="lp-stat"><div className="lp-stat__val">{c.v.toLocaleString()}+</div><div className="lp-stat__label">{label}</div></div>;
}

/* ═══════════════════════════════════════════════
   MAKE LOGOS
   ═══════════════════════════════════════════════ */
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

const UKFlag = () => (
  <svg width="32" height="22" viewBox="0 0 60 40" style={{ display: "block", flexShrink: 0 }}>
    <rect width="60" height="40" fill="#012169" /><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6" /><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3" /><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10" /><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6" />
  </svg>
);

/* ═══════════════════════════════════════════════
   WIDGET DEMOS
   ═══════════════════════════════════════════════ */
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
  const GarageIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13" rx="1" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>;
  const garageVehicles = step >= 8
    ? [{ year: "2022", make: "BMW", model: "3 Series", engine: "M340i (382 Hp)" }, { year: "2013", make: "Porsche", model: "Panamera", engine: "4.8L V8 \u00b7 440 Hp" }, { year: "2004", make: "BMW", model: "6 Series", engine: "645Ci \u00b7 333 Hp" }]
    : [{ year: "2022", make: "BMW", model: "3 Series", engine: "M340i (382 Hp)" }];
  return (
    <div ref={containerRef}>
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="lp-demo" style={{ padding: 28 }}>
        <div className="dm-title" style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Find Parts for Your Vehicle</div>
        <div className="dm-grid-4">
          {["Make", "Model", "Year", "Engine"].map((label, idx) => (
            <div key={label}>
              <div className="dm-label">{label}</div>
              {step >= idx + 1 ? (
                <div className="dm-sel dm-anim">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {idx === 0 && <img src={MAKES[0].logo} alt="" width="22" height="22" style={{ objectFit: "contain" }} />}
                    {idx === 0 ? "BMW" : idx === 1 ? "3 Series" : idx === 2 ? "2022" : "M340i (382 Hp)"}
                  </span>{I.chev}
                </div>
              ) : (
                <div className="dm-sel"><span style={{ color: "rgba(255,255,255,0.25)" }}>Select...</span>{I.chev}</div>
              )}
            </div>
          ))}
        </div>
        <div className="dm-bottom-row">
          <button className="dm-find-btn" style={step < 5 ? { opacity: 0.4 } : { animation: "ymme-fade-in 0.4s ease" }}>{SearchIcon} Find Parts</button>
          <button className="dm-garage-btn" style={{ width: 42, height: 42 }}>
            {GarageIcon}
            {garageCount > 0 && <span className="dm-garage-badge">{garageCount}</span>}
          </button>
        </div>
        {showGarage && (
          <div className="dm-garage" style={{ animation: "ymme-fade-in 0.3s ease" }}>
            <div className="dm-garage__hdr"><span>My Garage</span><span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>{garageVehicles.length} vehicle{garageVehicles.length !== 1 ? "s" : ""}</span></div>
            {garageVehicles.map((v, i) => (
              <div key={i} className="dm-garage__item" style={i > 0 && step >= 8 ? { animation: "ymme-fade-in 0.4s ease" } : undefined}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{v.year} {v.make} {v.model}</div><div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{v.engine}</div></div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button style={{ padding: "4px 12px", borderRadius: 6, background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>Select</button>
                  <button style={{ padding: "4px 6px", borderRadius: 6, background: "var(--bg-hover)", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="dm-footer" style={{ marginTop: 18 }}>{I.logo(12)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function PlateDemo() {
  const [motOpen, setMotOpen] = useState(true);
  return (
    <div>
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="lp-demo lp-demo">
        <div className="dm-title" style={{ textAlign: "center" }}>Find Parts by Registration</div>
        <div className="dm-sub" style={{ textAlign: "center" }}>Enter your UK registration number</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div className="dm-plate-wrap" style={{ flex: 1 }}>
            <div className="dm-plate-gb"><UKFlag /></div>
            <input className="dm-plate-input" value="AL61 EAJ" readOnly />
          </div>
          <button className="dm-plate-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            Look Up
          </button>
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Recent</div>
        <div className="dm-chips">
          <div className="dm-chip"><span style={{ background: "#facc15", color: "#000", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>S777 MNH</span> Porsche Panamera</div>
          <div className="dm-chip"><span style={{ background: "#facc15", color: "#000", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>AL61 EAJ</span> BMW 3 Series</div>
        </div>
        <div className="dm-result-wrap show">
          <div className="dm-result">
            <div className="dm-plate-badges"><span className="dm-plate-gb-badge">GB</span><span className="dm-yellow-badge">AL61 EAJ</span></div>
            <div className="dm-vehicle">BMW M340I XDRIVE MHEV AUTO</div>
            <div className="dm-meta">2022 &middot; ORANGE &middot; HYBRID ELECTRIC</div>
            <div className="dm-specs">
              {[["Year", "2022"], ["Colour", "ORANGE"], ["Fuel Type", "HYBRID ELECTRIC"], ["Engine", "2998cc"], ["CO\u2082 Emissions", "176 g/km"], ["Type Approval", "M1"], ["Wheelplan", "2 AXLE RIGID BODY"], ["First Registered", "30 Mar 2022"]].map(([k, v], i) =>
                <div key={i} className="dm-spec-row"><span>{k}</span><span>{v}</span></div>
              )}
            </div>
            <div className="dm-status-grid">
              <div><label>MOT</label><div className="dm-status-val"><span className="dm-dot dm-dot-- green" />Valid</div><div className="dm-status-sub">Expires 11 Nov 2026</div></div>
              <div><label>TAX</label><div className="dm-status-val"><span className="dm-dot dm-dot-- green" />Taxed</div><div className="dm-status-sub">Due 1 Nov 2026</div></div>
            </div>
            <button className="dm-btn-accent" style={{ width: "100%", height: 44, fontSize: 15, marginBottom: 8 }}>Find Parts for This Vehicle &rarr;</button>
            <div className="dm-mot">
              <button className="dm-mot-toggle" onClick={() => setMotOpen(!motOpen)}>
                <span>MOT History <span className="dm-mot-count">2 tests</span></span>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: motOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M4 6l4 4 4-4" /></svg>
              </button>
              {motOpen && <div>
                <div className="dm-mot-item"><span className="dm-mot-date">12 Nov 2025</span><span className="dm-mot-pass">PASS</span><span className="dm-mot-miles">87,329 Mi</span></div>
                <div className="dm-mot-item"><span className="dm-mot-date">4 Apr 2025</span><span className="dm-mot-pass">PASS</span><span className="dm-mot-miles">72,485 Mi</span></div>
              </div>}
            </div>
          </div>
        </div>
        <div className="dm-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function CompatDemo() {
  return (
    <>
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="lp-demo">
        <div className="dm-title">Vehicle Compatibility</div>
        <div className="dm-sub">All compatible vehicles for this product</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Make", "Model", "Years", "Engine"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-quaternary)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
            <tbody>{[["BMW", "3 Series (F30)", "2012\u20132019", "320i (184 Hp)"], ["BMW", "3 Series (G20)", "2019\u20132024", "320i (184 Hp)"], ["BMW", "4 Series (F32)", "2013\u20132020", "420i (184 Hp)"], ["Audi", "A4 (B9)", "2016\u20132024", "2.0 TFSI (190 Hp)"], ["Mercedes", "C-Class (W205)", "2014\u20132021", "C200 (184 Hp)"]].map((r, i) =>
              <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 13 }}>{c}</td>)}</tr>
            )}</tbody>
          </table>
        </div>
        <div className="dm-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function BadgeDemo() {
  const [s, setS] = useState<0 | 1 | 2>(0);
  return (
    <>
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="lp-demo" style={{ textAlign: "center" }}>
        <div className="dm-title">Fitment Badge</div>
        <div className="dm-sub">Real-time compatibility on every product page</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 16 }}>
          {["Fits", "Doesn't Fit", "No Vehicle"].map((t, i) =>
            <button key={i} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid", background: s === i ? "var(--accent)" : "transparent", color: s === i ? "#fff" : "var(--text-secondary)", borderColor: s === i ? "var(--accent)" : "var(--border)" }} onClick={() => setS(i as 0 | 1 | 2)}>{t}</button>
          )}
        </div>
        <div className={`dm-badge ${s === 0 ? "fits" : s === 1 ? "nofit" : "none"}`}>
          {s === 0 && <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Fits your 2022 BMW 3 Series</>}
          {s === 1 && <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" /></svg> May not fit your 2022 BMW 3 Series</>}
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
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="lp-demo">
        <div className="dm-title" style={{ fontSize: 18 }}>Vehicle Specifications</div>
        <div className="dm-sub">Browse detailed specs for all vehicles</div>
        <div className="dm-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input placeholder="Search vehicles..." readOnly />
          <span className="dm-search-count">353 vehicles</span>
        </div>
        <div className="dm-vgrid">
          {SPEC_VEHICLES.map((v, i) => (
            <div key={i} className="dm-vcard">
              <div className="dm-vcard-make"><img src={v.logo} alt="" /><span>{v.make}</span></div>
              <h4>{v.model}</h4>
              <div className="desc">{v.engine}</div>
              <div className="dm-vcard-pills">
                <span className="dm-vcard-pill green">{v.hp} HP</span>
                <span className="dm-vcard-pill">{v.disp}</span>
                <span className="dm-vcard-pill">{v.fuel}</span>
              </div>
              <span className="dm-vcard-link">View Specs &rarr;</span>
            </div>
          ))}
        </div>
        <div className="dm-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function VehicleSpecDetailDemo() {
  const StatIcon = {
    hp: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
    torque: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><path d="M21 12a9 9 0 11-6.219-8.56" /><path d="M21 3v5h-5" /></svg>,
    displacement: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><rect x="6" y="4" width="12" height="16" rx="2" /><line x1="6" y1="8" x2="18" y2="8" /><line x1="6" y1="16" x2="18" y2="16" /></svg>,
    speed: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><path d="M12 2a10 10 0 00-6.88 17.23" /><path d="M12 2a10 10 0 016.88 17.23" /><path d="M12 12l3.5-6.06" /><circle cx="12" cy="12" r="1" /></svg>,
    stopwatch: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M10 2h4" /></svg>,
    fuel: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><path d="M3 22V6a2 2 0 012-2h8a2 2 0 012 2v16" /><path d="M3 22h12" /><rect x="6" y="7" width="6" height="5" /></svg>,
  };
  return (
    <>
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="dm-hero-dark">
        <div className="dm-hero-dark-make"><img src="https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" alt="" /><span>BMW</span></div>
        <h2>3 Series</h2>
        <div className="sub">316i (102 Hp)</div>
        <div className="dm-hero-dark-tags">
          <span className="dm-hero-dark-tag">1987</span><span className="dm-hero-dark-tag">M10B18</span><span className="dm-hero-dark-tag">Petrol</span><span className="dm-hero-dark-tag">Sedan</span><span className="dm-hero-dark-tag">RWD</span>
        </div>
        <p>The BMW 316i is a compact executive sedan powered by the naturally aspirated M10B18 inline-4 engine, producing 102 horsepower.</p>
      </div>
      <div className="dm-qstats">
        {[["hp", "102", "HP"], ["torque", "140", "Nm"], ["displacement", "1.6L", "Displ."], ["speed", "182", "km/h"], ["stopwatch", "12.1s", "0-100"], ["fuel", "Petrol", "Fuel"]].map(([icon, val, label], i) => (
          <div key={i} className="dm-qstat"><div className="stat-icon">{StatIcon[icon as keyof typeof StatIcon]}</div><div className="val">{val}</div><div className="label">{label}</div></div>
        ))}
      </div>
      <div className="dm-tabs">
        <button className="dm-tabactive">Engine</button><button className="demo-tab">Performance</button><button className="demo-tab">Drivetrain</button><button className="demo-tab">Dimensions</button>
      </div>
      <div style={{ background: "var(--bg-elevated)" }}>
        <table className="dm-spec-table"><tbody>
          {[["Engine Code", "M10B18"], ["Displacement", "1.6L (1,573 cc)"], ["Cylinders", "4"], ["Configuration", "Inline"], ["Power", "102 HP @ 5,800 rpm"], ["Torque", "140 Nm @ 4,500 rpm"], ["Compression", "9.5:1"], ["Fuel System", "Bosch L-Jetronic"]].map(([k, v], i) =>
            <tr key={i}><td>{k}</td><td>{v}</td></tr>
          )}
        </tbody></table>
      </div>
      <div style={{ background: "var(--bg-elevated)", padding: "12px 24px" }}>
        <div className="dm-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function VINDecodeDemo() {
  return (
    <>
      <div className="lp-chrome"><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /><span className="lp-chrome__dot" /></div>
      <div className="lp-demo" style={{ textAlign: "center" }}>
        <div className="dm-title">Decode Your VIN</div>
        <div className="dm-sub">Enter your 17-character Vehicle Identification Number</div>
        <div className="dm-vin-row">
          <span className="dm-vin-badge">VIN</span>
          <div className="dm-vin-field"><input value="WBAPH5C55BA123456" readOnly style={{ letterSpacing: 1.5 }} /><span className="dm-vin-counter">17/17</span></div>
          <button className="dm-btn-accent">Decode VIN</button>
        </div>
        <div className="dm-result">
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M3 8l3 3 7-7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            VIN Decoded Successfully
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>2011 BMW 5 Series 528i</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 14, fontFamily: "var(--font-mono)" }}>WBAPH5C55BA123456</div>
          <div className="dm-vin-specs">
            {[["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Trim", "528i"], ["Body", "Sedan"], ["Drive", "RWD"], ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Transmission", "Automatic"], ["Country", "Germany"]].map(([k, v], i) =>
              <div key={i} className="dm-vin-cell"><div className="dm-vin-key">{k}</div><div className="dm-vin-val">{v}</div></div>
            )}
          </div>
          <button className="dm-btn-accent" style={{ width: "100%", marginTop: 12 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            Find Compatible Parts
          </button>
        </div>
        <div className="dm-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════
   INTERACTIVE DASHBOARD
   ═══════════════════════════════════════════════ */
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
    <div className="id-title">Dashboard</div>
    <div className="id-label">Quick Actions</div>
    <div className="id-actions">
      <div className="id-action"><span className="id-dot" style={{ background: "var(--accent)" }} /> Fetch Products</div>
      <div className="id-action"><span className="id-dot" style={{ background: "var(--orange)" }} /> Auto Extract <span className="id-badge">1,593 pending</span></div>
      <div className="id-action"><span className="id-dot" style={{ background: "var(--green)" }} /> Manual Map</div>
      <div className="id-action id-action-blue"><span className="id-dot" style={{ background: "rgba(255,255,255,0.4)" }} /> Push to Shopify</div>
    </div>
    <div className="id-stats">
      <div className="id-stat-card"><div className="id-stat-num">2,844</div><div className="id-stat-lbl">Total Products</div></div>
      <div className="id-stat-card"><div className="id-stat-num">5,827</div><div className="id-stat-lbl">Vehicle Links</div></div>
      <div className="id-stat-card"><div className="id-stat-num">1,251</div><div className="id-stat-lbl">Mapped</div></div>
      <div className="id-stat-card"><div className="id-stat-num">44%</div><div className="id-stat-lbl">Coverage</div></div>
    </div>
    <div className="id-label">Fitment Coverage</div>
    <div className="id-progress">
      <div className="id-pbar"><div className="id-pfill" style={{ width: "44%" }} /></div>
      <div className="id-plabels"><span>1,593 Needs Review</span><span>1,251 Mapped</span></div>
    </div>
    <div className="id-bottom">
      <div className="id-bcard"><div className="id-label">Top Makes</div><div className="id-kv"><span>Audi</span><strong>584</strong></div><div className="id-kv"><span>Aria</span><strong>308</strong></div><div className="id-kv"><span>Alfa Romeo</span><strong>103</strong></div></div>
      <div className="id-bcard"><div className="id-label">YMME Database</div><div className="id-kv"><span>Makes</span><strong>374</strong></div><div className="id-kv"><span>Models</span><strong>3,888</strong></div><div className="id-kv"><span>Engines</span><strong>29,515</strong></div></div>
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
    <div className="id-title">Products <span className="id-title-sub">2,844 products</span></div>
    <table className="id-table">
      <thead><tr><th>Product</th><th>Status</th><th>Fitments</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td className="id-td-name">{r.name}</td><td><span className={`id-badge-pill id-badge-${r.tone}`}>{r.status}</span></td><td className="id-td-num">{r.fitments}</td></tr>)}</tbody>
    </table>
  </>;
}

function IDashPush() {
  return <>
    <div className="id-title">Push to Shopify</div>
    <button className="id-push-btn">Push All Mapped Products</button>
    <div className="id-checks">
      <label className="id-check"><input type="checkbox" defaultChecked readOnly /> Push Tags</label>
      <label className="id-check"><input type="checkbox" defaultChecked readOnly /> Push Metafields</label>
      <label className="id-check"><input type="checkbox" defaultChecked readOnly /> Create Collections</label>
    </div>
    <div className="id-push-meta">2,844 products pushed &middot; 1h ago</div>
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
    <div className="id-title">Collections <span className="id-title-sub">1,125 collections</span></div>
    <div className="id-col-grid">
      {cols.map((c, i) => <div key={i} className="id-col-card"><img src={c.logo} alt="" className="id-col-logo" /><div><div className="id-col-name">{c.name}</div><div className="id-col-count">{c.count} products</div></div></div>)}
    </div>
  </>;
}

function InteractiveDashboard() {
  const [page, setPage] = useState<IDashPage>("Dashboard");
  return (
    <div className="lp-idash">
      <div className="lp-idash__sidebar">
        <div className="lp-idash__logo">{I.logo(16)} AutoSync</div>
        {IDASH_NAV.map(n => (
          <div key={n} className={`lp-idash__nav-item ${page === n ? "active" : ""}`} onClick={() => setPage(n)}>{NAV_ICONS[n]} {n}</div>
        ))}
      </div>
      <div className="lp-idash__main">
        {page === "Dashboard" && <IDashDashboard />}
        {page === "Products" && <IDashProducts />}
        {page === "Push to Shopify" && <IDashPush />}
        {page === "Collections" && <IDashCollections />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   FEATURE WALL
   ═══════════════════════════════════════════════ */
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
const FEATURE_DEMOS: Record<FeatureId, () => JSX.Element> = { ymme: YMMEDemo, plate: PlateDemo, compat: CompatDemo, badge: BadgeDemo, specs: VehicleSpecsDemo, detail: VehicleSpecDetailDemo, vin: VINDecodeDemo };

function FeatureWall() {
  const [active, setActive] = useState<FeatureId>("ymme");
  const Demo = FEATURE_DEMOS[active];
  return (
    <div className="lp-fw">
      <div className="lp-fw__nav">
        {FEATURE_WALL_ITEMS.map(f => (
          <div key={f.id} className={`lp-fw__item ${active === f.id ? "active" : ""}`} onClick={() => setActive(f.id)}>
            <div className="lp-fw__item-title">{f.title}</div>
            <div className="lp-fw__item-desc">{f.desc}</div>
          </div>
        ))}
      </div>
      <div className="lp-fw__demo"><div key={active} className="lp-fw__demo-inner"><Demo /></div></div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   DATA ARRAYS
   ═══════════════════════════════════════════════ */
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
  { q: "Is there a free trial?", a: "The Free plan lets you try AutoSync with 50 products at no cost, forever. All paid plans include a 14-day free trial." },
];

const SYSTEMS = [
  { t: "Smart Extraction", d: "Pattern-matching engine with 55 make patterns, model detection, and 3-tier confidence routing.", s: "80%+ accuracy" },
  { t: "YMME Database", d: "Pre-loaded vehicle database with every make, model, and engine worldwide.", s: "29K+ engines" },
  { t: "Smart Collections", d: "Auto-creates SEO-optimized Shopify collections with brand logos and meta descriptions.", s: "3 strategies" },
  { t: "7 Storefront Widgets", d: "YMME Search, Fitment Badge, Compatibility Table, My Garage, Wheel Finder, Plate Lookup, VIN Decode.", s: "7 widgets" },
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

const PROVIDERS = [
  { title: "CSV Upload", desc: "Drag and drop CSV files with automatic column detection and smart field mapping.", icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="M9 15l3-3 3 3" /></svg> },
  { title: "XML Feed", desc: "Connect to XML product feeds with XPath mapping and scheduled auto-imports.", icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /><path d="M4 11h4l1.5 2L11 10l1.5 3 1-1.5L15 13h5" /></svg> },
  { title: "REST API", desc: "Connect to any REST API with custom headers, authentication, and response mapping.", icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg> },
  { title: "FTP Server", desc: "Auto-download files from FTP/SFTP servers on a schedule with change detection.", icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><circle cx="6" cy="6" r="1" /><circle cx="6" cy="18" r="1" /></svg> },
];

const TESTIMONIALS = [
  { quote: "AutoSync completely transformed how we sell parts online. Our customers can now find exact-fit parts in seconds instead of scrolling through pages.", name: "James Mitchell", role: "Owner, Mitchell Performance Parts", stars: 5 },
  { quote: "The YMME search widget alone was worth the switch. We saw a 40% reduction in returns within the first month of installing AutoSync.", name: "Sarah Thompson", role: "E-commerce Manager, UK Auto Spares", stars: 5 },
  { quote: "Moving from Convermax saved us over $600/month and we actually got more features. The plate lookup is incredible for our UK customers.", name: "David Chen", role: "Technical Director, DriveSpec Ltd", stars: 5 },
];

/* ═══════════════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════════════ */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const [showMorePlans, setShowMorePlans] = useState(true);
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
    const words = document.querySelectorAll(".lp-hero__word");
    words.forEach((w, i) => { setTimeout(() => w.classList.add("visible"), 300 + i * 120); });
  }, []);

  // GSAP: steps line
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
            gsap.to(stepsLineRef.current, {
              width: "100%", ease: "none",
              scrollTrigger: { trigger: stepsLineRef.current.parentElement, start: "top 70%", end: "bottom 50%", scrub: true },
            });
          }
        });
      } catch (_e) { /* GSAP failed */ }
    })();
    return () => { if (ctx) ctx.revert(); };
  }, []);

  // System cards reveal
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
      {/* ── 1. Nav ── */}
      <nav className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-w lp-nav__inner">
          <a href="#" className="lp-logo">{I.logo()} AutoSync</a>
          <div className="lp-nav__links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="lp-btn lp-btn--accent">Get Started</a>
        </div>
      </nav>

      {/* ── 2. Hero ── */}
      <section className="lp-hero">
        <div className="lp-w" style={{ position: "relative", zIndex: 1 }}>
          <div className="lp-pill" style={{ marginBottom: 20 }}>Vehicle Fitment Intelligence</div>
          <h1 className="lp-hero__title">
            {["Vehicle", "fitment"].map((w, i) => <span key={i} className="lp-hero__word">{w}</span>)}
            <span className="lp-hero__word accent">intelligence</span>
            {["for", "Shopify"].map((w, i) => <span key={i + 3} className="lp-hero__word">{w}</span>)}
          </h1>
          <p className="lp-hero__sub">The only Shopify app that automatically maps vehicle fitments to your products, creates smart collections, and adds Search & Discovery filters — so customers find exact-fit parts instantly.</p>
          <div className="lp-hero__ctas">
            <a href="#login" className="lp-btn lp-btn--accent lp-btn--lg">Start Free Trial</a>
            <a href="#features" className="lp-btn lp-btn--ghost lp-btn--lg">See How It Works</a>
          </div>
          <div className="lp-hero__stats">
            <Stat value={stats.makes} label="Vehicle Makes" />
            <Stat value={stats.models} label="Models" />
            <Stat value={stats.engines} label="Engines" />
            <Stat value={stats.specs} label="Vehicle Specs" />
          </div>
        </div>
      </section>

      {/* ── 3. Trust Logos ── */}
      <section className="lp-trust">
        <div className="lp-w">
          <p className="lp-trust__label">Trusted by parts retailers using these vehicle brands</p>
        </div>
        <div style={{ overflow: "hidden" }}>
          <div className="lp-marquee">
            {[...MAKES, ...MAKES].map((m, i) => <img key={i} src={m.logo} alt={m.name} title={m.name} loading="lazy" />)}
          </div>
        </div>
      </section>

      {/* ── 4. Interactive Dashboard ── */}
      <section className="lp-product">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">Product</span>
              <div className="lp-h2">The complete fitment platform</div>
              <p className="lp-p">Everything you need to manage vehicle compatibility data, push to Shopify, and help customers find parts that fit.</p>
            </div>
          </IOReveal>
          <IOReveal delay={0.15}>
            <div className="lp-product__frame">
              <InteractiveDashboard />
            </div>
          </IOReveal>
        </div>
      </section>

      {/* ── 5. Feature Wall (7 Widgets) ── */}
      <section id="features" className="lp-section lp-section--alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">Storefront Widgets</span>
              <div className="lp-h2">7 widgets. One platform.</div>
              <p className="lp-p">Every widget your automotive store needs, built as native Shopify Theme App Extension blocks.</p>
            </div>
          </IOReveal>
          <IOReveal delay={0.1}>
            <FeatureWall />
          </IOReveal>
        </div>
      </section>

      {/* ── 6. How It Works ── */}
      <section id="how-it-works" className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">How It Works</span>
              <div className="lp-h2">From install to sales in 4 steps</div>
            </div>
          </IOReveal>
          <div className="lp-steps">
            <div className="lp-steps__line"><div ref={stepsLineRef} className="lp-steps__line-fill" /></div>
            {STEPS.map((s, i) => (
              <IOReveal key={i} delay={i * 0.1}>
                <div className="lp-step">
                  <div className="lp-step__num">{s.n}</div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Systems Grid ── */}
      <section id="systems" className="lp-section lp-section--alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">Platform</span>
              <div className="lp-h2">8 integrated systems</div>
              <p className="lp-p">A complete platform where every system works together seamlessly.</p>
            </div>
          </IOReveal>
          <div className="lp-bento" ref={systemsRef}>
            {SYSTEMS.map((sys, i) => (
              <div key={i} className="lp-bento__card">
                <div className="lp-bento__icon">{SYSTEM_ICONS[i]}</div>
                <h3>{sys.t}</h3>
                <p>{sys.d}</p>
                <span className="lp-bento__stat">{sys.s}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. Provider Integration ── */}
      <section className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">Data Import</span>
              <div className="lp-h2">Connect any parts supplier</div>
              <p className="lp-p">Import product data from any source with smart column mapping and scheduled auto-imports.</p>
            </div>
          </IOReveal>
          <div className="lp-providers">
            {PROVIDERS.map((p, i) => (
              <IOReveal key={i} delay={i * 0.08}>
                <div className="lp-provider-card">
                  <div className="lp-provider-card-icon">{p.icon}</div>
                  <h3>{p.title}</h3>
                  <p>{p.desc}</p>
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 9. Pricing ── */}
      <section id="pricing" className="lp-section lp-section--alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">Pricing</span>
              <div className="lp-h2">Simple, transparent pricing</div>
              <p className="lp-p">Start free. Scale as you grow. Cancel anytime. All paid plans include a 14-day free trial.</p>
            </div>
          </IOReveal>
          <div className="lp-pricing">
            {visiblePlans.map((p, i) => (
              <IOReveal key={p.name} delay={i * 0.05}>
                <div className={`lp-price-card ${p.pop ? "lp-price-card--pop" : ""}`}>
                  {p.pop && <div className="lp-price-card__badge">Most Popular</div>}
                  <div className="lp-price-card__name">{p.name}</div>
                  <div style={{ marginBottom: 14 }}>
                    {p.price === 0 ? <span className="lp-price-card__amt">Free</span> : <><span className="lp-price-card__amt">${p.price}</span><span className="lp-price-card__per">/mo</span></>}
                  </div>
                  <div className="lp-price-card__limits">
                    <div><strong>{p.products}</strong> products</div>
                    <div><strong>{p.fitments}</strong> fitments</div>
                    <div><strong>{p.providers}</strong> providers</div>
                    <div><strong>{p.makes}</strong> active makes</div>
                  </div>
                  <ul className="lp-price-card__feat">
                    {p.features.map((f, j) => <li key={j}>{I.chk} {f}</li>)}
                  </ul>
                  <a href="#login" className={`lp-btn ${p.pop ? "lp-btn-accent" : "lp-btn-outline"}`} style={{ width: "100%" }}>
                    {p.price === 0 ? "Get Started" : "Start Free Trial"}
                  </a>
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 10. Comparison ── */}
      <section id="compare" className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
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
                    <tr key={key}><td>{label}</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{(c as Record<string, unknown>)[key] === 1 ? I.chk : (c as Record<string, unknown>)[key] === 0 ? I.x : (c as Record<string, unknown>)[key]}</td>)}</tr>
                  )}
                  <tr><td>Widgets</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.w}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </IOReveal>
        </div>
      </section>

      {/* ── 11. Testimonials ── */}
      <section className="lp-section lp-section--alt">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">Testimonials</span>
              <div className="lp-h2">What parts retailers say</div>
            </div>
          </IOReveal>
          <div className="lp-testimonials">
            {TESTIMONIALS.map((t, i) => (
              <IOReveal key={i} delay={i * 0.1}>
                <div className="lp-testimonial">
                  <div className="lp-testimonial-stars">{"★".repeat(t.stars)}</div>
                  <div className="lp-testimonial-quote">"{t.quote}"</div>
                  <div className="lp-testimonial-author">{t.name}</div>
                  <div className="lp-testimonial-role">{t.role}</div>
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 12. FAQ ── */}
      <section id="faq" className="lp-section">
        <div className="lp-w">
          <IOReveal>
            <div className="lp-shdr c">
              <span className="lp-tag">FAQ</span>
              <div className="lp-h2">Frequently asked questions</div>
            </div>
          </IOReveal>
          <div className="lp-faq-list">
            {FAQS.map((item, i) => (
              <IOReveal key={i} delay={i * 0.03}>
                <div className={`lp-faq ${faq === i ? "open" : ""}`}>
                  <button className="lp-faq__q" onClick={() => setFaq(faq === i ? null : i)}>{item.q}<span className="lp-faq__ico">+</span></button>
                  {faq === i && <div className="lp-faq__a">{item.a}</div>}
                </div>
              </IOReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 13. CTA ── */}
      <section className="lp-cta">
        <div className="lp-w" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <IOReveal>
            <div className="lp-h2">Ready to sell more parts?</div>
            <p style={{ fontSize: 16, color: "var(--text-secondary)", marginBottom: 28, maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>Join automotive stores using AutoSync to help customers find parts that fit.</p>
            <a href="#login" className="lp-btn lp-btn--accent lp-btn--lg">Start Your Free Trial {I.arr}</a>
          </IOReveal>
        </div>
      </section>

      {/* ── 14. Login ── */}
      <section id="login" className="lp-section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="lp-w" style={{ maxWidth: 420, textAlign: "center" }}>
          {I.logo(40)}
          <div style={{ fontSize: 18, fontWeight: 700, margin: "14px 0 6px", letterSpacing: "-0.02em" }}>AutoSync</div>
          <p style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 20 }}>Enter your Shopify store domain to get started</p>
          {showForm && <Form method="post" action="/auth/login">
            <div style={{ display: "flex", gap: 6 }}>
              <input name="shop" className="lp-login-input" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)} />
              <button type="submit" className="lp-btn lp-btn--accent">Install</button>
            </div>
          </Form>}
        </div>
      </section>

      {/* ── Back to Top ── */}
      {showBackToTop && (
        <button className="lp-btt" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
        </button>
      )}

      {/* ── 15. Footer ── */}
      <footer className="lp-footer">
        <div className="lp-w">
          <div className="lp-footer__grid">
            <div>
              <div className="lp-footer__brand">{I.logo(18)} AutoSync</div>
              <p className="lp-footer__desc">Vehicle fitment intelligence for Shopify. Help customers find parts that fit their vehicle.</p>
            </div>
            <div><h4>Product</h4><div className="lp-footer__links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></div></div>
            <div><h4>Company</h4><div className="lp-footer__links"><a href="#">About</a><a href="#">Blog</a><a href="#">Changelog</a></div></div>
            <div><h4>Legal</h4><div className="lp-footer__links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="mailto:support@autosync.app">Contact</a></div></div>
          </div>
          <div className="lp-footer__bottom">&copy; {new Date().getFullYear()} AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
