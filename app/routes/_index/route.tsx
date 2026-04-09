import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";
import "./landing.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const [m, mo, e, s] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
  ]);
  return { showForm: Boolean(login), stats: { makes: m.count ?? 0, models: mo.count ?? 0, engines: e.count ?? 0, specs: s.count ?? 0 } };
};

/* ═══ ICONS ═══ */
const Logo = (sz = 24) => <svg width={sz} height={sz} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>;
const Check = <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#0099ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Cross = <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/></svg>;
const ChevDown = <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>;
const Arrow = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>;

/* ═══ HOOKS ═══ */
function useCounter(end: number) {
  const dur = end > 1000 ? 1400 : 1000;
  const [v, setV] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        const t0 = performance.now();
        const tick = (now: number) => { const p = Math.min((now - t0) / dur, 1); setV(Math.floor((1 - Math.pow(2, -14 * p)) * end)); if (p < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.15 });
    obs.observe(el); return () => obs.disconnect();
  }, [end, dur]);
  return { v, ref };
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.05 });
    obs.observe(el); return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${vis ? "reveal--visible" : ""}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>;
}

function StatCell({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return <div ref={c.ref} className="stats-strip__cell"><div className="stats-strip__value">{c.v.toLocaleString()}+</div><div className="stats-strip__label">{label}</div></div>;
}

/* ═══ DATA ═══ */
const BRANDS = [
  { n: "BMW", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" },
  { n: "Audi", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/audi.png" },
  { n: "Mercedes", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/mercedes-benz.png" },
  { n: "VW", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/volkswagen.png" },
  { n: "Toyota", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/toyota.png" },
  { n: "Ford", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/ford.png" },
  { n: "Porsche", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/porsche.png" },
  { n: "Honda", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/honda.png" },
  { n: "Chevrolet", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/chevrolet.png" },
  { n: "Nissan", l: "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/nissan.png" },
];

const SYSTEMS = [
  { title: "Smart Extraction", desc: "AI pattern-matching with 55 make patterns and 3-tier confidence routing. Auto-detects vehicle compatibility from product titles.", stat: "80%+ accuracy", wide: true },
  { title: "YMME Database", desc: "Pre-loaded worldwide vehicle database. Every make, model, engine — ready from day one.", stat: "29K+ engines", wide: true },
  { title: "Smart Collections", desc: "Auto-creates SEO-optimized Shopify collections with brand logos.", stat: "3 strategies", wide: false },
  { title: "7 Storefront Widgets", desc: "YMME, Badge, Compat, Garage, Wheels, Plate, VIN — native blocks.", stat: "7 widgets", wide: false },
  { title: "Provider Import", desc: "CSV, XML, JSON, API, FTP with smart column mapping.", stat: "5 formats", wide: false },
  { title: "Vehicle Spec Pages", desc: "Auto-generated SEO pages with 90+ specs as metaobjects.", stat: "90+ fields", wide: false },
  { title: "Push Engine", desc: "Tags, 5 metafield types, Search & Discovery filters — automatic.", stat: "5 metafields", wide: false },
  { title: "Pricing Engine", desc: "Markup, margin, fixed, MAP rules by vendor, type, or tag.", stat: "4 rules", wide: false },
];

const STEPS = [
  { num: "01", title: "Install & Import", desc: "Install from Shopify App Store. Fetch products or import from suppliers." },
  { num: "02", title: "Auto-Extract", desc: "Smart extraction detects vehicle compatibility with 80%+ accuracy." },
  { num: "03", title: "Push to Shopify", desc: "Tags, metafields, collections. Search & Discovery auto-activates." },
  { num: "04", title: "Sell More Parts", desc: "Customers find exact-fit parts. Fewer returns, better SEO." },
];

const PLANS = [
  { name: "Free", price: 0, products: "50", fitments: "200", features: ["Manual mapping", "Product browser", "YMME access", "Basic support"], pop: false },
  { name: "Starter", price: 19, products: "1,000", fitments: "5,000", features: ["Push tags & metafields", "YMME Search", "Fitment Badge", "1 provider"], pop: false },
  { name: "Growth", price: 49, products: "10,000", fitments: "50,000", features: ["All 7 widgets", "Smart extraction", "Make collections", "Bulk ops"], pop: true },
  { name: "Professional", price: 99, products: "50,000", fitments: "250,000", features: ["API/FTP import", "Wheel Finder", "Spec Pages", "Priority"], pop: false },
  { name: "Business", price: 179, products: "200,000", fitments: "1M", features: ["Pricing Engine", "Year collections", "My Garage", "Dedicated"], pop: false },
  { name: "Enterprise", price: 299, products: "Unlimited", fitments: "Unlimited", features: ["Plate Lookup", "VIN Decode", "SLA guarantee", "White-glove"], pop: false },
];

const COMPS = [
  { n: "AutoSync", p: "Free\u2013$299", hl: true, db: 1, ext: 1, col: 1, w: "7", pl: 1, vin: 1, wh: 1 },
  { n: "Convermax", p: "$250\u2013$850", hl: false, db: 0, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 1 },
  { n: "EasySearch", p: "$19\u2013$75", hl: false, db: 1, ext: 0, col: 0, w: "2", pl: 0, vin: 0, wh: 0 },
  { n: "PCFitment", p: "$15\u2013$150", hl: false, db: 1, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 0 },
];

const FAQS = [
  { q: "What is YMME and why does my store need it?", a: "YMME (Year, Make, Model, Engine) is the industry standard for vehicle parts compatibility. It reduces returns by up to 80% and increases conversions." },
  { q: "Do I need to manually enter vehicle data?", a: "No. AutoSync includes 374+ makes, 3,686 models, and 29,515 engines pre-loaded. Smart extraction auto-detects compatibility from product titles." },
  { q: "Will widgets work with my Shopify theme?", a: "Yes. All widgets are Theme App Extension blocks for any OS 2.0 theme. Drag and drop, zero code." },
  { q: "How is AutoSync different from Convermax?", a: "Convermax starts at $250/month. AutoSync offers more features — plate lookup, VIN decode, smart collections, 7 widgets — starting free." },
  { q: "Can I import from supplier feeds?", a: "Yes. CSV, XML, JSON, REST API, and FTP with smart column mapping that auto-detects fields." },
  { q: "Is there a free trial?", a: "Free plan is forever free (50 products). All paid plans include a 14-day free trial." },
];

const REVIEWS = [
  { q: "AutoSync completely transformed how we sell parts. Customers find exact-fit parts in seconds.", n: "James Mitchell", r: "Mitchell Performance" },
  { q: "The YMME widget alone reduced returns by 40% in the first month.", n: "Sarah Thompson", r: "UK Auto Spares" },
  { q: "Saved $600/month switching from Convermax. Plate lookup is incredible.", n: "David Chen", r: "DriveSpec Ltd" },
];

/* ═══ DASHBOARD (rich embedded UI like Opscale) ═══ */
function AppDashboard() {
  const [pg, setPg] = useState(0);
  const pages = ["Dashboard", "Products", "Push", "Collections"];
  const icons = [
    <svg key="0" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
    <svg key="1" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4l6-2 6 2v8l-6 2-6-2z"/><path d="M8 6v8"/></svg>,
    <svg key="2" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 12V4"/><path d="M5 7l3-3 3 3"/><path d="M3 14h10"/></svg>,
    <svg key="3" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="4" width="14" height="10" rx="1.5"/><path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1"/></svg>,
  ];
  return (
    <div className="app-dash">
      <div className="app-dash__rail">
        <div className="app-dash__brand">{Logo(16)} AutoSync</div>
        <div className="app-dash__nav">
          {pages.map((p, i) => <div key={p} className={`app-dash__nav-item ${pg === i ? "app-dash__nav-item--active" : ""}`} onClick={() => setPg(i)} style={{ cursor: "pointer" }}>{icons[i]} {p}</div>)}
        </div>
      </div>
      <div className="app-dash__body">
        {pg === 0 && <>
          <div className="app-dash__title">Dashboard</div>
          <div className="app-dash__label">Quick Actions</div>
          <div className="app-dash__actions">
            <div className="app-dash__action"><span className="app-dash__action-dot" style={{ background: "#0099ff" }}/> Fetch Products</div>
            <div className="app-dash__action"><span className="app-dash__action-dot" style={{ background: "#d97706" }}/> Auto Extract</div>
            <div className="app-dash__action"><span className="app-dash__action-dot" style={{ background: "#059669" }}/> Manual Map</div>
            <div className="app-dash__action app-dash__action--highlight"><span className="app-dash__action-dot" style={{ background: "rgba(255,255,255,.5)" }}/> Push to Shopify</div>
          </div>
          <div className="app-dash__metrics">
            {[["2,844", "Products"], ["5,827", "Fitments"], ["1,251", "Mapped"], ["44%", "Coverage"]].map(([n, l], i) =>
              <div key={i} className="app-dash__metric"><div className="app-dash__metric-value">{n}</div><div className="app-dash__metric-label">{l}</div></div>
            )}
          </div>
          <div className="app-dash__label">Fitment Coverage</div>
          <div className="app-dash__bar"><div className="app-dash__bar-fill" style={{ width: "44%" }}/></div>
          <div className="app-dash__bar-labels"><span>1,593 Needs Review</span><span>1,251 Mapped</span></div>
        </>}
        {pg === 1 && <>
          <div className="app-dash__title">Products</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Product", "Status", "Fits"].map(h => <th key={h} style={{ textAlign: "left", padding: "12px 10px", borderBottom: "1px solid var(--silk)", color: "var(--slate)", fontSize: 10, textTransform: "uppercase" as const, letterSpacing: ".06em", fontWeight: 700 }}>{h}</th>)}</tr></thead>
            <tbody>
              {[["Eibach Pro-Kit Springs", "mapped", "#059669", 12], ["MST BMW Intake", "mapped", "#059669", 8], ["Scorpion Exhaust", "unmapped", "#9ca3af", 0], ["Bilstein B14 Kit", "flagged", "#d97706", 3]].map(([n, s, c, f], i) =>
                <tr key={i}><td style={{ padding: "14px 10px", borderBottom: "1px solid var(--silk)", fontWeight: 500, fontSize: 14 }}>{n as string}</td><td style={{ padding: "14px 10px", borderBottom: "1px solid var(--silk)" }}><span style={{ fontSize: 11, fontWeight: 700, padding: "4px 14px", borderRadius: 999, background: `${c}0d`, color: c as string }}>{s as string}</span></td><td style={{ padding: "14px 10px", borderBottom: "1px solid var(--silk)", textAlign: "center", fontWeight: 600 }}>{f as number}</td></tr>
              )}
            </tbody>
          </table>
        </>}
        {pg === 2 && <>
          <div className="app-dash__title">Push to Shopify</div>
          <button className="btn btn--azure" style={{ width: "100%", marginBottom: 16, borderRadius: 14, padding: 16 }}>Push All Mapped Products</button>
          {["Push Tags", "Push Metafields", "Create Collections"].map(t => <label key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--charcoal)", marginBottom: 10, cursor: "pointer" }}><input type="checkbox" defaultChecked readOnly style={{ accentColor: "var(--azure)", width: 18, height: 18 }}/> {t}</label>)}
        </>}
        {pg === 3 && <>
          <div className="app-dash__title">Collections</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {BRANDS.slice(0, 4).map((m, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, border: "1px solid var(--silk)" }}><img src={m.l} alt="" style={{ width: 32, height: 32, objectFit: "contain" }}/><div><div style={{ fontSize: 14, fontWeight: 600 }}>{m.n} Parts</div><div style={{ fontSize: 11, color: "var(--slate)" }}>{[423, 312, 189, 156][i]} products</div></div></div>)}
          </div>
        </>}
      </div>
    </div>
  );
}

/* ═══ FEATURE DEMOS — ALL NEW VISUAL FORMATS ═══ */

/* YMME: Brand logo grid + cascade selection (NOT dropdowns) */
function YmmeDemo() {
  const [selected, setSelected] = useState(0);
  return <>
    <div className="demo-chrome"><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/></div>
    <div className="demo-body">
      <div className="demo-title">Select Your Vehicle</div>
      <div className="demo-subtitle">Choose a make to find compatible parts</div>
      <div className="ymme-brands">
        {BRANDS.slice(0, 10).map((b, i) => (
          <div key={i} className={`ymme-brand ${selected === i ? "ymme-brand--selected" : ""}`} onClick={() => setSelected(i)}>
            <img src={b.l} alt={b.n}/><span>{b.n}</span>
          </div>
        ))}
      </div>
      <div className="ymme-cascade">
        <div className="ymme-cascade__step ymme-cascade__step--active"><span>BMW</span> {ChevDown}</div>
        <div className="ymme-cascade__step ymme-cascade__step--active"><span>3 Series</span> {ChevDown}</div>
        <div className="ymme-cascade__step ymme-cascade__step--active"><span>2022</span> {ChevDown}</div>
        <div className="ymme-cascade__step"><span style={{ color: "var(--slate)" }}>Engine...</span> {ChevDown}</div>
      </div>
      <button className="ymme-search-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        Find Compatible Parts
      </button>
      <div className="demo-footer">{Logo(12)} Powered by AutoSync</div>
    </div>
  </>;
}

/* Plate: Realistic UK plate display + decoded result card */
function PlateDemo() {
  return <>
    <div className="demo-chrome"><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/></div>
    <div className="demo-body">
      <div className="plate-container">
        <div className="demo-title" style={{ marginBottom: 16 }}>UK Plate Lookup</div>
        <div className="plate-display">
          <div className="plate-display__flag">
            <svg width="24" height="16" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3"/><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10"/><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6"/></svg>
          </div>
          <div className="plate-display__text">AL61 EAJ</div>
        </div>
        <div className="plate-result">
          <div className="plate-result__vehicle">BMW M340I XDRIVE MHEV AUTO</div>
          <div className="plate-result__meta">2022 &middot; ORANGE &middot; HYBRID ELECTRIC &middot; 2998cc</div>
          <div className="plate-result__grid">
            <div className="plate-result__status">
              <div className="plate-result__status-label">MOT Status</div>
              <div className="plate-result__status-value"><span className="plate-result__status-dot" style={{ background: "#059669" }}/> Valid until Nov 2026</div>
            </div>
            <div className="plate-result__status">
              <div className="plate-result__status-label">Tax Status</div>
              <div className="plate-result__status-value"><span className="plate-result__status-dot" style={{ background: "#059669" }}/> Taxed until Nov 2026</div>
            </div>
          </div>
        </div>
      </div>
      <div className="demo-footer">{Logo(12)} Powered by AutoSync</div>
    </div>
  </>;
}

/* VIN: Decoded specification waterfall */
function VinDemo() {
  return <>
    <div className="demo-chrome"><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/></div>
    <div className="demo-body">
      <div className="vin-decoder">
        <div className="demo-title">VIN Decode</div>
        <div className="demo-subtitle">Decode any 17-character VIN worldwide</div>
        <div className="vin-input-row">
          <span className="vin-badge">VIN</span>
          <div className="vin-field">
            <input value="WBAPH5C55BA123456" readOnly/>
            <span className="vin-field__counter">17/17</span>
          </div>
          <button className="btn btn--azure btn--sm">Decode</button>
        </div>
        <div style={{ fontFamily: "var(--heading)", fontSize: 18, fontWeight: 700, marginBottom: 10 }}>2011 BMW 5 Series 528i</div>
        <div className="vin-waterfall">
          {[["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Body", "Sedan"], ["Drive", "RWD"], ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Trans", "Auto"], ["Origin", "Germany"], ["Trim", "528i"]].map(([k, v], i) =>
            <div key={i} className="vin-waterfall__cell"><div className="vin-waterfall__key">{k}</div><div className="vin-waterfall__value">{v}</div></div>
          )}
        </div>
      </div>
      <div className="demo-footer">{Logo(12)} Powered by AutoSync</div>
    </div>
  </>;
}

/* Badge: Product card with live fit/no-fit + vehicle cards */
function BadgeDemo() {
  return <>
    <div className="demo-chrome"><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/><span className="demo-chrome__dot"/></div>
    <div className="demo-body">
      <div className="badge-demo">
        <div className="demo-title">Fitment Badge</div>
        <div className="demo-subtitle">Appears on every product page automatically</div>
        <div className="badge-fit badge-fit--yes">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"/></svg>
          Fits your 2022 BMW 3 Series
        </div>
        <div className="badge-fit badge-fit--no">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/></svg>
          May not fit your vehicle
        </div>
        <div className="badge-vehicles">
          {[{ m: "BMW", n: "3 Series", e: "M340i · 382 HP" }, { m: "Audi", n: "A4", e: "2.0 TFSI · 261 HP" }].map((v, i) => (
            <div key={i} className="badge-vehicle">
              <div className="badge-vehicle__make"><img src={BRANDS[i].l} alt=""/>{v.m}</div>
              <h4>{v.n}</h4>
              <div className="badge-vehicle__tags">
                <span className="badge-vehicle__tag badge-vehicle__tag--accent">{v.e}</span>
                <span className="badge-vehicle__tag">Petrol</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="demo-footer">{Logo(12)} Powered by AutoSync</div>
    </div>
  </>;
}

/* ═══ PAGE ═══ */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [showBtt, setShowBtt] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const stepsRef = useRef<HTMLDivElement>(null);
  const bentoRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const fn = () => { setScrolled(window.scrollY > 30); setShowBtt(window.scrollY > 700); }; window.addEventListener("scroll", fn); return () => window.removeEventListener("scroll", fn); }, []);
  useEffect(() => { if (typeof window === "undefined") return; document.querySelectorAll(".hero__word").forEach((w, i) => { setTimeout(() => w.classList.add("hero__word--visible"), 500 + i * 150); }); }, []);
  useEffect(() => { if (typeof window === "undefined") return; let ctx: any; (async () => { try { const { gsap } = await import("gsap"); const { ScrollTrigger } = await import("gsap/ScrollTrigger"); gsap.registerPlugin(ScrollTrigger); ctx = gsap.context(() => { if (stepsRef.current) gsap.to(stepsRef.current, { width: "100%", ease: "none", scrollTrigger: { trigger: stepsRef.current.parentElement, start: "top 70%", end: "bottom 50%", scrub: true } }); const f = document.querySelector(".product-frame"); if (f) gsap.fromTo(f, { scale: 0.9, rotateX: 6 }, { scale: 1, rotateX: 0, ease: "none", scrollTrigger: { trigger: f, start: "top 95%", end: "top 20%", scrub: true } }); }); } catch (_) {} })(); return () => { if (ctx) ctx.revert(); }; }, []);
  useEffect(() => { if (typeof window === "undefined") return; const el = bentoRef.current; if (!el) return; const cards = el.querySelectorAll(".bento__card"); const obs = new IntersectionObserver((entries) => { entries.forEach((entry) => { if (entry.isIntersecting) { setTimeout(() => entry.target.classList.add("bento__card--visible"), Array.from(cards).indexOf(entry.target) * 130); obs.unobserve(entry.target); } }); }, { threshold: 0.08 }); cards.forEach(c => obs.observe(c)); return () => obs.disconnect(); }, []);

  return (
    <div>
      {/* NAV */}
      <nav className={`nav ${scrolled ? "nav--scrolled" : ""}`}>
        <div className="nav__inner container">
          <a href="#" className="nav__brand">{Logo(28)} AutoSync</a>
          <div className="nav__links">
            <a href="#features">Features</a>
            <a href="#how">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="btn btn--primary btn--sm">Start Free Trial</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero__content">
          <div className="hero__pill"><span className="pill"><span className="pill__dot"/> Vehicle Fitment Intelligence</span></div>
          <h1 className="hero__title display display--hero">
            {["Vehicle", "fitment"].map((w, i) => <span key={i} className="hero__word">{w}</span>)}
            <span className="hero__word hero__word--accent">intelligence</span>
            {["for", "Shopify"].map((w, i) => <span key={i + 3} className="hero__word">{w}</span>)}
          </h1>
          <p className="hero__subtitle">The only app that automatically maps vehicle fitments to your products, creates smart collections, and adds Search & Discovery filters.</p>
          <div className="hero__actions">
            <a href="#login" className="btn btn--primary btn--lg">Start Free Trial {Arrow}</a>
            <a href="#features" className="btn btn--secondary btn--lg">See How It Works</a>
          </div>
        </div>
        <div className="stats-strip">
          <StatCell value={stats.makes} label="Vehicle Makes"/>
          <StatCell value={stats.models} label="Models"/>
          <StatCell value={stats.engines} label="Engines"/>
          <StatCell value={stats.specs} label="Vehicle Specs"/>
        </div>
      </section>

      {/* PRODUCT SHOWCASE */}
      <div className="product-showcase">
        <div className="product-frame"><AppDashboard/></div>
      </div>

      {/* TRUST */}
      <section className="trust">
        <div className="container"><p className="trust__label">Trusted by parts retailers using these vehicle brands</p></div>
        <div style={{ overflow: "hidden" }}>
          <div className="trust__track">{[...BRANDS, ...BRANDS].map((m, i) => <img key={i} src={m.l} alt={m.n} title={m.n} loading="lazy"/>)}</div>
        </div>
      </section>

      {/* BENTO */}
      <section id="features" className="section">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> Platform</span><div className="display display--section" style={{ marginTop: 20 }}>8 integrated systems</div><p className="text-body" style={{ maxWidth: 520, margin: "16px auto 0" }}>A complete platform where every system works together seamlessly.</p></div></Reveal>
          <div className="bento" ref={bentoRef}>
            {SYSTEMS.map((sys, i) => (
              <div key={i} className={`bento__card ${sys.wide ? "bento__card--span-2" : ""}`}>
                <h3>{sys.title}</h3>
                <p>{sys.desc}</p>
                <span className="bento__tag">{sys.stat}</span>
                {sys.wide && <div className="bento__mini-chart">
                  {i === 0 ? [["Auto Mapped", "#059669", "72%"], ["Flagged", "#d97706", "18%"], ["No Match", "#9ca3af", "10%"]].map(([l, c, w], j) =>
                    <div key={j} className="bento__data-row"><span className="bento__data-dot" style={{ background: c as string }}/><span style={{ flex: "0 0 110px" }}>{l}</span><div className="bento__data-bar"><span style={{ width: w as string, background: c as string }}/></div></div>
                  ) : [["Makes", "374"], ["Models", "3,888"], ["Engines", "29,515"]].map(([l, v], j) =>
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: j < 2 ? "1px solid var(--silk)" : "none", fontSize: 14, color: "var(--graphite)" }}><span>{l}</span><strong style={{ color: "var(--obsidian)" }}>{v}</strong></div>
                  )}
                </div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURE ROWS */}
      <section className="section section--tinted">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> Storefront Widgets</span><div className="display display--section" style={{ marginTop: 20 }}>7 widgets your store needs</div><p className="text-body" style={{ maxWidth: 520, margin: "16px auto 0" }}>Native Shopify blocks. Drag and drop, zero code.</p></div></Reveal>

          <Reveal><div className="feature-row">
            <div className="feature-row__text"><span className="pill" style={{ marginBottom: 20 }}><span className="pill__dot"/> YMME Search</span><h3 className="display--feature">Find parts by vehicle</h3><p className="text-body">Cascading Make, Model, Year, Engine selection with brand logos, My Garage for saved vehicles, and instant compatible parts.</p><ul><li>{Check} 374+ vehicle makes with logos</li><li>{Check} My Garage saves multiple vehicles</li><li>{Check} Search & Discovery integration</li></ul></div>
            <div className="feature-row__visual"><YmmeDemo/></div>
          </div></Reveal>

          <Reveal><div className="feature-row feature-row--flip">
            <div className="feature-row__text"><span className="pill" style={{ marginBottom: 20 }}><span className="pill__dot"/> Plate Lookup</span><h3 className="display--feature">UK registration lookup</h3><p className="text-body">DVLA integration with MOT history, tax status, and instant vehicle identification from any UK registration number.</p><ul><li>{Check} Real-time DVLA API</li><li>{Check} MOT history & tax status</li><li>{Check} Instant vehicle identification</li></ul></div>
            <div className="feature-row__visual"><PlateDemo/></div>
          </div></Reveal>

          <Reveal><div className="feature-row">
            <div className="feature-row__text"><span className="pill" style={{ marginBottom: 20 }}><span className="pill__dot"/> VIN Decode</span><h3 className="display--feature">Decode any vehicle worldwide</h3><p className="text-body">17-character VIN decoder covering 60+ manufacturers with full specification breakdown and one-click parts search.</p><ul><li>{Check} 60+ manufacturers supported</li><li>{Check} Full specification waterfall</li><li>{Check} One-click compatible parts</li></ul></div>
            <div className="feature-row__visual"><VinDemo/></div>
          </div></Reveal>

          <Reveal><div className="feature-row feature-row--flip">
            <div className="feature-row__text"><span className="pill" style={{ marginBottom: 20 }}><span className="pill__dot"/> Badge & Specs</span><h3 className="display--feature">Compatibility everywhere</h3><p className="text-body">Fitment badges on every product page and SEO-optimized vehicle specification galleries with 90+ fields per vehicle.</p><ul><li>{Check} Real-time fits / doesn't fit badge</li><li>{Check} 90+ spec fields per vehicle</li><li>{Check} Auto-generated SEO pages</li></ul></div>
            <div className="feature-row__visual"><BadgeDemo/></div>
          </div></Reveal>
        </div>
      </section>

      {/* STEPS */}
      <section id="how" className="section">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> How It Works</span><div className="display display--section" style={{ marginTop: 20 }}>From install to sales in 4 steps</div></div></Reveal>
          <div className="steps-grid">
            <div className="steps-line"><div ref={stepsRef} className="steps-line__fill"/></div>
            {STEPS.map((s, i) => <Reveal key={i} delay={i * 0.12}><div className="step-card"><div className="step-card__number">{s.num}</div><h3>{s.title}</h3><p>{s.desc}</p></div></Reveal>)}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="section section--tinted">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> Pricing</span><div className="display display--section" style={{ marginTop: 20 }}>Simple, transparent pricing</div><p className="text-body" style={{ maxWidth: 520, margin: "16px auto 0" }}>Start free. Scale as you grow. 14-day trial on all paid plans.</p></div></Reveal>
          <div className="pricing-grid">
            {PLANS.map((p, i) => <Reveal key={p.name} delay={i * 0.07}><div className={`pricing-card ${p.pop ? "pricing-card--featured" : ""}`}>
              {p.pop && <div className="pricing-card__badge">Most Popular</div>}
              <div className="pricing-card__name">{p.name}</div>
              <div style={{ marginBottom: 20 }}>{p.price === 0 ? <span className="pricing-card__price">Free</span> : <><span className="pricing-card__price">${p.price}</span><span className="pricing-card__period">/mo</span></>}</div>
              <div className="pricing-card__limits"><div><strong>{p.products}</strong> products</div><div><strong>{p.fitments}</strong> fitments</div></div>
              <ul className="pricing-card__features">{p.features.map((f, j) => <li key={j}>{Check} {f}</li>)}</ul>
              <a href="#login" className={`btn ${p.pop ? "btn--azure" : "btn--secondary"}`} style={{ width: "100%", justifyContent: "center" }}>{p.price === 0 ? "Get Started" : "Start Free Trial"}</a>
            </div></Reveal>)}
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section id="compare" className="section">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> Comparison</span><div className="display display--section" style={{ marginTop: 20 }}>AutoSync vs competition</div></div></Reveal>
          <Reveal delay={0.1}><div className="compare-wrap"><table className="compare-table"><thead><tr><th>Feature</th>{COMPS.map((c, i) => <th key={i} className={c.hl ? "compare--hl" : ""}>{c.hl ? <strong>{c.n}</strong> : c.n}</th>)}</tr></thead><tbody>
            <tr><td>Price</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "compare--hl" : ""}>{c.p}</td>)}</tr>
            {(["db", "ext", "col", "pl", "vin", "wh"] as const).map(k => <tr key={k}><td>{{ db: "YMME Database", ext: "Auto Extract", col: "Collections", pl: "Plate Lookup", vin: "VIN Decode", wh: "Wheel Finder" }[k]}</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "compare--hl" : ""}>{(c as any)[k] === 1 ? Check : (c as any)[k] === 0 ? Cross : (c as any)[k]}</td>)}</tr>)}
            <tr><td>Widgets</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "compare--hl" : ""}>{c.w}</td>)}</tr>
          </tbody></table></div></Reveal>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="section section--tinted">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> Testimonials</span><div className="display display--section" style={{ marginTop: 20 }}>What parts retailers say</div></div></Reveal>
          <div className="testimonials-grid">{REVIEWS.map((t, i) => <Reveal key={i} delay={i * 0.1}><div className="testimonial-card"><div className="testimonial-card__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div className="testimonial-card__quote">&ldquo;{t.q}&rdquo;</div><div className="testimonial-card__name">{t.n}</div><div className="testimonial-card__role">{t.r}</div></div></Reveal>)}</div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="section">
        <div className="container">
          <Reveal><div className="section-header section-header--center"><span className="pill"><span className="pill__dot"/> FAQ</span><div className="display display--section" style={{ marginTop: 20 }}>Frequently asked questions</div></div></Reveal>
          <div className="faq-list">{FAQS.map((item, i) => <Reveal key={i} delay={i * 0.04}><div className={`faq-item ${faq === i ? "faq-item--open" : ""}`}><button className="faq-item__trigger" onClick={() => setFaq(faq === i ? null : i)}>{item.q}<span className="faq-item__icon">+</span></button>{faq === i && <div className="faq-item__answer">{item.a}</div>}</div></Reveal>)}</div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="container" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <Reveal><div className="display display--section">Ready to sell more parts?</div><p className="text-body text-body--lg" style={{ margin: "20px auto 40px", maxWidth: 480, color: "rgba(255,255,255,.7)" }}>Join automotive stores using AutoSync to help customers find exact-fit parts.</p><a href="#login" className="btn btn--white btn--lg">Start Your Free Trial {Arrow}</a></Reveal>
        </div>
      </section>

      {/* LOGIN */}
      <section id="login" className="section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="container" style={{ maxWidth: 480, textAlign: "center" }}>
          {Logo(52)}
          <div style={{ fontFamily: "var(--heading)", fontSize: 24, fontWeight: 800, margin: "20px 0 8px", letterSpacing: "-.02em" }}>AutoSync</div>
          <p style={{ fontSize: 15, color: "var(--graphite)", marginBottom: 32 }}>Enter your Shopify store domain to get started</p>
          {showForm && <Form method="post" action="/auth/login"><div style={{ display: "flex", gap: 10 }}><input name="shop" className="login-input" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)}/><button type="submit" className="btn btn--azure">Install</button></div></Form>}
        </div>
      </section>

      {showBtt && <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          <div className="footer__grid">
            <div><div className="footer__brand">{Logo(20)} AutoSync</div><p className="footer__desc">Vehicle fitment intelligence for Shopify. Help customers find parts that fit their vehicle.</p></div>
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
