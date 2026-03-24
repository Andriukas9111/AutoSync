import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";
import "./landing.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  const [makesRes, modelsRes, enginesRes, specsRes, tenantsRes, productsRes, fitmentsRes, collectionsRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
    db.from("tenants").select("id", { count: "exact", head: true }),
    db.from("products").select("id", { count: "exact", head: true }),
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }),
    db.from("collection_mappings").select("id", { count: "exact", head: true }),
  ]);
  return {
    showForm: Boolean(login),
    stats: { makes: makesRes.count ?? 0, models: modelsRes.count ?? 0, engines: enginesRes.count ?? 0, specs: specsRes.count ?? 0, tenants: tenantsRes.count ?? 0, products: productsRes.count ?? 0, fitments: fitmentsRes.count ?? 0, collections: collectionsRes.count ?? 0 },
  };
};

/* ─── SVG Icons ─── */
const Icons = {
  logo: (s = 28) => <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  cross: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/></svg>,
  shield: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  zap: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  globe: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg>,
  code: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  database: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  layers: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  tag: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  truck: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  grid: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  dollar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  chart: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  file: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  chevron: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>,
};

/* ─── Animated Counter ─── */
function useCounter(end: number, dur = 2000) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - t0) / dur, 1);
          setVal(Math.floor((1 - Math.pow(1 - p, 3)) * end));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [end, dur]);
  return { val, ref };
}

function Stat({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return <div ref={c.ref} className="lp-stat"><div className="lp-stat-num">{c.val.toLocaleString()}</div><div className="lp-stat-label">{label}</div></div>;
}

/* ─── Fade-In on Scroll ─── */
function Fade({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={`lp-fade ${vis ? "visible" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>;
}

/* ═══════════════════════════════════════════════
   DEMO WIDGETS
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
];

function YMMEDemo() {
  const [make, setMake] = useState("BMW");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [garage, setGarage] = useState(false);
  const filtered = MAKES.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <div className="demo-title">Find Parts for Your Vehicle</div>
      <div className="demo-grid">
        <div className="demo-field" style={{ position: "relative" }}>
          <label>Make</label>
          <button className="demo-select" onClick={() => setOpen(!open)}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src={MAKES.find(m => m.name === make)?.logo} alt="" width="20" height="20" style={{ objectFit: "contain" }} />
              {make}
            </span>
            {Icons.chevron}
          </button>
          {open && (
            <div className="demo-dropdown">
              <input className="demo-search" placeholder="Search makes..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              {filtered.map(m => (
                <div key={m.name} className={`demo-option ${m.name === make ? "active" : ""}`} onClick={() => { setMake(m.name); setOpen(false); setSearch(""); }}>
                  <img src={m.logo} alt="" /> {m.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="demo-field"><label>Model</label><div className="demo-select"><span>3 Series</span>{Icons.chevron}</div></div>
        <div className="demo-field"><label>Year</label><div className="demo-select"><span>2022</span>{Icons.chevron}</div></div>
        <div className="demo-field"><label>Engine</label><div className="demo-select"><span>M340i (382 Hp)</span>{Icons.chevron}</div></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="lp-btn lp-btn-primary" style={{ flex: 1 }}>{Icons.search} Find Parts</button>
        <button className="lp-btn lp-btn-outline" onClick={() => setGarage(!garage)} style={{ position: "relative", padding: "10px 14px" }}>
          {Icons.truck}
          <span style={{ position: "absolute", top: -6, right: -6, background: "var(--lp-accent)", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>3</span>
        </button>
      </div>
      {garage && (
        <div className="demo-garage">
          <div className="demo-garage-header"><span>My Garage</span><button style={{ opacity: 0.4, fontSize: 16 }}>&#x1f5d1;</button></div>
          {[{ y: 2013, mk: "Porsche", md: "Panamera" }, { y: 2022, mk: "BMW", md: "3 Series", eng: "M340i (382 Hp) xDrive" }, { y: 2004, mk: "BMW", md: "6 Series", eng: "645Ci (333 Hp)" }].map((v, i) => (
            <div key={i} className="demo-garage-item">
              <div><strong>{v.y} {v.mk} {v.md}</strong>{v.eng && <div style={{ fontSize: 12, color: "var(--lp-text-muted)" }}>{v.eng}</div>}</div>
              <button className="lp-btn lp-btn-primary lp-btn-sm">Select</button>
            </div>
          ))}
        </div>
      )}
      <div className="demo-footer">{Icons.logo(14)} Powered by AutoSync</div>
    </div>
  );
}

function PlateDemo() {
  const [plate, setPlate] = useState("");
  const [result, setResult] = useState(false);
  return (
    <div>
      <div className="demo-title" style={{ textAlign: "center" }}>Find Parts by Registration</div>
      <p style={{ textAlign: "center", fontSize: 13, color: "var(--lp-text-muted)", marginBottom: 16 }}>Enter your UK registration number</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div className="demo-plate-wrap">
          <div className="demo-plate-gb">GB</div>
          <input className="demo-plate-input" placeholder="AB12 CDE" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} />
        </div>
        <button className="lp-btn lp-btn-primary" onClick={() => setResult(true)}>{Icons.search} Look Up</button>
      </div>
      {result && (
        <div className="demo-result">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ background: "#1e3a8a", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>GB</span>
            <span style={{ background: "#fbbf24", color: "#000", padding: "2px 10px", borderRadius: 4, fontSize: 13, fontWeight: 700 }}>{plate || "AL61 EAJ"}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>BMW M340I XDRIVE MHEV AUTO</div>
          <div style={{ fontSize: 13, color: "var(--lp-text-muted)", marginBottom: 14 }}>2022 &middot; ORANGE &middot; HYBRID ELECTRIC</div>
          <div className="demo-specs">
            {[["Year", "2022"], ["Colour", "ORANGE"], ["Fuel Type", "HYBRID ELECTRIC"], ["Engine", "2998cc"], ["CO\u2082", "176 g/km"], ["Type", "M1"]].map(([k, v], i) => (
              <div key={i} className="demo-spec"><span>{k}</span><span>{v}</span></div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "14px 0" }}>
            <div><div style={{ fontSize: 11, color: "var(--lp-text-muted)" }}>MOT</div><span style={{ color: "var(--lp-success)", fontWeight: 600, fontSize: 14 }}>Valid</span></div>
            <div><div style={{ fontSize: 11, color: "var(--lp-text-muted)" }}>TAX</div><span style={{ color: "var(--lp-success)", fontWeight: 600, fontSize: 14 }}>Taxed</span></div>
          </div>
          <button className="lp-btn lp-btn-primary" style={{ width: "100%" }}>Find Parts for This Vehicle</button>
        </div>
      )}
      <div className="demo-footer">{Icons.logo(14)} Powered by AutoSync</div>
    </div>
  );
}

function CompatDemo() {
  return (
    <div>
      <div className="demo-title">Vehicle Compatibility</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Make", "Model", "Years", "Engine"].map(h => <th key={h} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--lp-border)", color: "var(--lp-text-muted)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>)}</tr></thead>
          <tbody>{[
            ["BMW", "3 Series (F30)", "2012-2019", "320i (184 Hp)"],
            ["BMW", "3 Series (G20)", "2019-2024", "320i (184 Hp)"],
            ["BMW", "4 Series (F32)", "2013-2020", "420i (184 Hp)"],
            ["Audi", "A4 (B9)", "2016-2024", "2.0 TFSI (190 Hp)"],
            ["Mercedes", "C-Class (W205)", "2014-2021", "C200 (184 Hp)"],
          ].map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: "10px 12px", borderBottom: "1px solid var(--lp-border)", color: "var(--lp-text-secondary)" }}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="demo-footer">{Icons.logo(14)} Powered by AutoSync</div>
    </div>
  );
}

function BadgeDemo() {
  const [state, setState] = useState<"fits" | "nofit" | "none">("fits");
  return (
    <div style={{ textAlign: "center" }}>
      <div className="demo-title">Fitment Badge</div>
      <div className="demo-badge-row">
        {(["fits", "nofit", "none"] as const).map(s => (
          <button key={s} className={`demo-badge-btn ${state === s ? "active" : ""}`} onClick={() => setState(s)}>
            {s === "fits" ? "Fits" : s === "nofit" ? "Doesn't Fit" : "No Vehicle"}
          </button>
        ))}
      </div>
      <div className={`demo-fitment ${state}`}>
        {state === "fits" && <>{Icons.check} Fits your 2022 BMW 3 Series</>}
        {state === "nofit" && <>{Icons.cross} May not fit your 2022 BMW 3 Series</>}
        {state === "none" && <>{Icons.search} Select a vehicle to check compatibility</>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════ */

const PLANS = [
  { name: "Free", price: 0, products: "50", fitments: "200", providers: "0", features: ["Manual mapping", "Product browser", "Community support"], popular: false },
  { name: "Starter", price: 19, products: "1,000", fitments: "5,000", providers: "1", features: ["Push tags & metafields", "YMME Search widget", "Fitment Badge", "Compatibility table"], popular: false },
  { name: "Growth", price: 49, products: "10,000", fitments: "50,000", providers: "3", features: ["All Starter features", "Smart auto-extraction", "All 4 widgets", "Make collections", "Bulk operations", "Analytics"], popular: true },
  { name: "Professional", price: 99, products: "50,000", fitments: "250,000", providers: "5", features: ["All Growth features", "API data import", "Wheel Finder", "Vehicle Spec Pages", "Make+Model collections", "Priority support"], popular: false },
  { name: "Business", price: 179, products: "200,000", fitments: "1,000,000", providers: "15", features: ["All Professional features", "FTP import", "Pricing Engine", "Year-range collections", "Dedicated support"], popular: false },
  { name: "Enterprise", price: 299, products: "Unlimited", fitments: "Unlimited", providers: "Unlimited", features: ["All Business features", "UK Plate Lookup (DVLA)", "VIN Decode", "Full CSS customisation", "SLA guarantee"], popular: false },
];

const COMPETITORS = [
  { name: "AutoSync", price: "Free\u2013$299", db: true, extract: true, collections: true, widgets: "7", plate: true, vin: true, wheel: true, api: true, analytics: true, pages: true, hl: true },
  { name: "Convermax", price: "$250\u2013$850", db: false, extract: false, collections: false, widgets: "1", plate: false, vin: true, wheel: true, api: false, analytics: false, pages: true, hl: false },
  { name: "EasySearch", price: "$19\u2013$75", db: true, extract: false, collections: false, widgets: "2", plate: false, vin: false, wheel: false, api: false, analytics: false, pages: false, hl: false },
  { name: "C: YMM", price: "$10\u2013$75", db: false, extract: false, collections: false, widgets: "1", plate: false, vin: false, wheel: false, api: false, analytics: false, pages: false, hl: false },
  { name: "PCFitment", price: "$15\u2013$150", db: true, extract: false, collections: false, widgets: "1", plate: false, vin: true, wheel: false, api: false, analytics: true, pages: false, hl: false },
  { name: "VFitz", price: "$1\u2013$58", db: true, extract: false, collections: false, widgets: "1", plate: false, vin: false, wheel: false, api: false, analytics: true, pages: false, hl: false },
  { name: "AutoFit AI", price: "$50\u2013$250", db: false, extract: true, collections: false, widgets: "2", plate: false, vin: false, wheel: false, api: false, analytics: false, pages: false, hl: false },
  { name: "PartFinder", price: "$49", db: false, extract: false, collections: false, widgets: "1", plate: false, vin: false, wheel: false, api: false, analytics: true, pages: false, hl: false },
  { name: "SearchAuto", price: "$89\u2013$500", db: false, extract: false, collections: false, widgets: "1", plate: false, vin: false, wheel: false, api: false, analytics: false, pages: false, hl: false },
];

const FAQS = [
  { q: "What is YMME and why does my store need it?", a: "YMME (Year, Make, Model, Engine) is the industry standard for vehicle parts compatibility. It helps customers quickly find parts that fit their specific vehicle, reducing returns by up to 80% and boosting conversion rates." },
  { q: "Do I need to manually enter all vehicle data?", a: "No. AutoSync includes a pre-loaded database of 331+ makes, 3,131 models, and 24,026 engines. Our smart extraction engine automatically detects vehicle compatibility from your product titles and descriptions." },
  { q: "How does the UK plate lookup work?", a: "Enterprise plan includes DVLA integration. Customers enter their UK registration number and instantly see their vehicle details, MOT history, and compatible parts from your store." },
  { q: "Will the widgets work with my Shopify theme?", a: "Yes. AutoSync widgets are Shopify Theme App Extension blocks. They work with any theme with zero code changes. Drag and drop in the theme editor." },
  { q: "How is AutoSync different from Convermax?", a: "Convermax starts at $250/month and requires custom setup. AutoSync offers more features (plate lookup, VIN decode, smart collections, auto-extraction) starting free, with self-service setup in minutes." },
  { q: "Can I import products from supplier feeds?", a: "Yes. AutoSync supports CSV, XML, JSON, REST API, and FTP imports. Smart column mapping auto-detects fields and remembers your mappings." },
  { q: "What happens if I exceed plan limits?", a: "You get a notification before reaching limits. Upgrade anytime. Your data is never deleted \u2014 you just can\u2019t add more until you upgrade." },
  { q: "Is there a free trial?", a: "The Free plan lets you try AutoSync with 50 products at no cost. Paid plans include a 30-day free trial." },
];

const SYSTEMS = [
  { icon: Icons.search, title: "Smart Extraction", desc: "Pattern-matching engine with 55 make patterns and 3-tier confidence routing. No AI costs \u2014 pure regex and coded rules.", stat: "80%+ accuracy" },
  { icon: Icons.database, title: "YMME Database", desc: "Pre-loaded vehicle database sourced from auto-data.net. Every make, model, engine, and spec worldwide.", stat: "24K+ engines" },
  { icon: Icons.layers, title: "Smart Collections", desc: "Auto-creates SEO-optimized collections with brand logos, meta descriptions, and year-range titles.", stat: "3 strategies" },
  { icon: Icons.grid, title: "7 Storefront Widgets", desc: "YMME Search, Fitment Badge, Compatibility Table, Plate Lookup, VIN Decode, Wheel Finder, Vehicle Specs.", stat: "7 widgets" },
  { icon: Icons.file, title: "Provider Import", desc: "Import from CSV, XML, JSON, REST API, or FTP. Smart column mapper auto-detects and remembers fields.", stat: "5 formats" },
  { icon: Icons.truck, title: "Vehicle Spec Pages", desc: "Auto-generated SEO pages with 90+ engine specs as Shopify metaobjects. Power, torque, fuel type.", stat: "90+ fields" },
  { icon: Icons.tag, title: "Shopify Push", desc: "Pushes tags, metafields (make/model/year/engine), and activates Search & Discovery filters automatically.", stat: "5 metafields" },
  { icon: Icons.dollar, title: "Pricing Engine", desc: "Markup, margin, fixed, and MAP pricing rules. Scope by vendor, product type, provider, tag, or SKU.", stat: "4 rule types" },
];

/* ═══════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════ */

export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [tab, setTab] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const tabs = ["YMME Search", "Plate Lookup", "Compatibility", "Fitment Badge"];

  return (
    <div className="lp">
      {/* Nav */}
      <nav className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-container lp-nav-inner">
          <a href="#" className="lp-logo">{Icons.logo()} AutoSync</a>
          <div className="lp-nav-links">
            <a href="#widgets">Widgets</a>
            <a href="#systems">Systems</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="lp-btn lp-btn-primary lp-btn-sm">Start Free</a>
        </div>
      </nav>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-container lp-hero-content">
          <Fade>
            <div className="lp-badge">{Icons.zap} Built for Shopify</div>
            <h1>Vehicle Fitment<br /><span className="lp-gradient">Intelligence</span> for Shopify</h1>
            <p className="lp-hero-sub">Help customers find parts that fit their vehicle. Year, Make, Model, Engine search with auto-extraction, 7 storefront widgets, smart collections, and UK plate lookup.</p>
            <div className="lp-hero-ctas">
              <a href="#login" className="lp-btn lp-btn-primary lp-btn-lg">Start Free Trial</a>
              <a href="#widgets" className="lp-btn lp-btn-outline lp-btn-lg">See Widgets</a>
            </div>
          </Fade>
          <Fade delay={0.2}>
            <div className="lp-stats">
              <Stat value={stats.makes} label="Vehicle Makes" />
              <Stat value={stats.models} label="Models" />
              <Stat value={stats.engines} label="Engines" />
              <Stat value={stats.specs} label="Vehicle Specs" />
            </div>
          </Fade>
        </div>
      </section>

      {/* Trust */}
      <div className="lp-trust">
        <div className="lp-container lp-trust-inner">
          {[{ icon: Icons.shield, t: "Built for Shopify" }, { icon: Icons.zap, t: "Edge Function Processing" }, { icon: Icons.globe, t: "Multi-tenant SaaS" }, { icon: Icons.code, t: "Zero Code Required" }, { icon: Icons.database, t: "App-owned Metafields" }].map((x, i) => (
            <div key={i} className="lp-trust-item">{x.icon} {x.t}</div>
          ))}
        </div>
      </div>

      {/* Widget Demos */}
      <section id="widgets" className="lp-section">
        <div className="lp-container">
          <Fade><div className="lp-section-header">
            <span className="lp-tag">Storefront Widgets</span>
            <div className="lp-section-title">Interactive Widget Demos</div>
            <p className="lp-section-sub">7 embeddable widgets that install into any Shopify theme with zero code changes. Try them below.</p>
          </div></Fade>
          <Fade delay={0.1}>
            <div className="lp-demo-tabs">
              {tabs.map((t, i) => <button key={i} className={`lp-demo-tab ${tab === i ? "active" : ""}`} onClick={() => setTab(i)}>{t}</button>)}
            </div>
            <div className="lp-demo-frame">
              <div className="lp-demo-chrome"><span className="lp-demo-dot" /><span className="lp-demo-dot" /><span className="lp-demo-dot" /></div>
              <div className="lp-demo-body">
                {tab === 0 && <YMMEDemo />}
                {tab === 1 && <PlateDemo />}
                {tab === 2 && <CompatDemo />}
                {tab === 3 && <BadgeDemo />}
              </div>
            </div>
          </Fade>
        </div>
      </section>

      {/* How It Works */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <Fade><div className="lp-section-header">
            <span className="lp-tag">How It Works</span>
            <div className="lp-section-title">From Install to Sales in 4 Steps</div>
          </div></Fade>
          <div className="lp-steps">
            {[{ n: "1", t: "Install & Import", d: "Install from Shopify App Store. Fetch your products or import from CSV/XML/API/FTP suppliers." },
              { n: "2", t: "Auto-Extract Fitments", d: "Smart extraction scans product data and detects vehicle compatibility with 80%+ accuracy." },
              { n: "3", t: "Push to Shopify", d: "Push tags, metafields, and smart collections. Search & Discovery filters activate automatically." },
              { n: "4", t: "Sell More Parts", d: "Customers find parts that fit their vehicle. Fewer returns, higher conversions." },
            ].map((s, i) => <Fade key={i} delay={i * 0.1}><div className="lp-step"><div className="lp-step-num">{s.n}</div><h3>{s.t}</h3><p>{s.d}</p></div></Fade>)}
          </div>
        </div>
      </section>

      {/* Systems */}
      <section id="systems" className="lp-section">
        <div className="lp-container">
          <Fade><div className="lp-section-header">
            <span className="lp-tag">Platform Capabilities</span>
            <div className="lp-section-title">Every System, Explained</div>
            <p className="lp-section-sub">AutoSync is a complete platform with 14+ integrated systems.</p>
          </div></Fade>
          <div className="lp-systems">
            {SYSTEMS.map((sys, i) => (
              <Fade key={i} delay={i * 0.05}><div className="lp-system">
                <span className="lp-system-icon">{sys.icon}</span>
                <h3>{sys.title}</h3>
                <p>{sys.desc}</p>
                <span className="lp-system-stat">{sys.stat}</span>
              </div></Fade>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="lp-section lp-section-alt">
        <div className="lp-container">
          <Fade><div className="lp-section-header">
            <span className="lp-tag">Pricing</span>
            <div className="lp-section-title">Simple, Transparent Pricing</div>
            <p className="lp-section-sub">Start free. Upgrade as you grow. Cancel anytime.</p>
          </div></Fade>
          <div className="lp-pricing">
            {PLANS.map((p, i) => (
              <Fade key={i} delay={i * 0.05}><div className={`lp-price-card ${p.popular ? "popular" : ""}`}>
                {p.popular && <div className="lp-price-badge">Most Popular</div>}
                <div className="lp-price-name">{p.name}</div>
                <div style={{ marginBottom: 16 }}>
                  {p.price === 0 ? <span className="lp-price-amount">Free</span> : <><span className="lp-price-amount">${p.price}</span><span className="lp-price-period">/mo</span></>}
                </div>
                <div className="lp-price-limits">
                  <div>{p.products} products</div>
                  <div>{p.fitments} fitments</div>
                  <div>{p.providers} providers</div>
                </div>
                <ul className="lp-price-features">
                  {p.features.map((f, j) => <li key={j}>{Icons.check} {f}</li>)}
                </ul>
                <a href="#login" className={`lp-btn ${p.popular ? "lp-btn-primary" : "lp-btn-outline"}`} style={{ width: "100%" }}>
                  {p.price === 0 ? "Get Started" : "Start Free Trial"}
                </a>
              </div></Fade>
            ))}
          </div>
        </div>
      </section>

      {/* Compare */}
      <section id="compare" className="lp-section">
        <div className="lp-container">
          <Fade><div className="lp-section-header">
            <span className="lp-tag">Comparison</span>
            <div className="lp-section-title">AutoSync vs The Competition</div>
          </div></Fade>
          <Fade delay={0.1}><div className="lp-compare-wrap">
            <table className="lp-compare">
              <thead><tr>
                <th>Feature</th>
                {COMPETITORS.map((c, i) => <th key={i} className={c.hl ? "hl" : ""}>{c.name}</th>)}
              </tr></thead>
              <tbody>
                <tr><td>Price</td>{COMPETITORS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.price}</td>)}</tr>
                {(["db", "extract", "collections", "plate", "vin", "wheel", "api", "analytics", "pages"] as const).map(k => (
                  <tr key={k}><td>{{db:"YMME Database",extract:"Auto Extraction",collections:"Smart Collections",plate:"UK Plate Lookup",vin:"VIN Decode",wheel:"Wheel Finder",api:"API/FTP Import",analytics:"Analytics",pages:"Vehicle Pages"}[k]}</td>
                    {COMPETITORS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c[k] === true ? Icons.check : c[k] === false ? Icons.cross : c[k]}</td>)}
                  </tr>
                ))}
                <tr><td>Widgets</td>{COMPETITORS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.widgets}</td>)}</tr>
              </tbody>
            </table>
          </div></Fade>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="lp-section lp-section-alt">
        <div className="lp-container">
          <Fade><div className="lp-section-header">
            <span className="lp-tag">FAQ</span>
            <div className="lp-section-title">Frequently Asked Questions</div>
          </div></Fade>
          <div className="lp-faq-list">
            {FAQS.map((item, i) => (
              <Fade key={i} delay={i * 0.03}><div className={`lp-faq ${faq === i ? "open" : ""}`}>
                <button className="lp-faq-q" onClick={() => setFaq(faq === i ? null : i)}>
                  {item.q}
                  <span className="lp-faq-arrow">+</span>
                </button>
                {faq === i && <div className="lp-faq-a">{item.a}</div>}
              </div></Fade>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta">
        <div className="lp-container" style={{ textAlign: "center" }}>
          <Fade>
            <div className="lp-section-title">Ready to Sell More Parts?</div>
            <p style={{ fontSize: 17, color: "var(--lp-text-secondary)", marginBottom: 32, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>Join automotive stores using AutoSync to help customers find parts that fit.</p>
            <a href="#login" className="lp-btn lp-btn-primary lp-btn-lg">Start Your Free Trial</a>
          </Fade>
        </div>
      </section>

      {/* Login */}
      <section id="login" className="lp-section">
        <div className="lp-container" style={{ maxWidth: 480, textAlign: "center" }}>
          {Icons.logo(48)}
          <div style={{ fontSize: 22, fontWeight: 700, margin: "16px 0 8px" }}>AutoSync</div>
          <p style={{ fontSize: 14, color: "var(--lp-text-muted)", marginBottom: 24 }}>Enter your Shopify store domain to get started</p>
          {showForm && (
            <Form method="post" action="/auth/login">
              <div style={{ display: "flex", gap: 8 }}>
                <input name="shop" className="lp-login-input" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)} />
                <button type="submit" className="lp-btn lp-btn-primary">Install</button>
              </div>
            </Form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div>
              <div className="lp-footer-brand">{Icons.logo(20)} AutoSync</div>
              <p className="lp-footer-desc">Vehicle fitment intelligence for Shopify automotive stores.</p>
            </div>
            <div><h4>Product</h4><div className="lp-footer-links"><a href="#widgets">Widgets</a><a href="#systems">Systems</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a></div></div>
            <div><h4>Support</h4><div className="lp-footer-links"><a href="#faq">FAQ</a><a href="mailto:support@autosync.app">Contact</a></div></div>
            <div><h4>Legal</h4><div className="lp-footer-links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a></div></div>
          </div>
          <div className="lp-footer-bottom">&copy; {new Date().getFullYear()} AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
