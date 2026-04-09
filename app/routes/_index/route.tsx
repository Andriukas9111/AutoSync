import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";
import "./landing.css";

/* ═══════════════════════════════════════
   LOADER
   ═══════════════════════════════════════ */
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

/* ═══════════════════════════════════════
   ICONS (SVG — no emojis per ui-ux-pro-max)
   ═══════════════════════════════════════ */
const Logo = (s = 24) => <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>;

const Chk = <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Xic = <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/></svg>;
const Chev = <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>;
const SearchIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;

/* ═══════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════ */
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
        const tick = (now: number) => {
          const p = Math.min((now - t0) / dur, 1);
          setV(Math.floor((1 - Math.pow(2, -14 * p)) * end));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [end, dur]);
  return { v, ref };
}

function Rv({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVis(true); obs.disconnect(); }
    }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={`rv ${vis ? "v" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return (
    <div ref={c.ref} className="st">
      <div className="st__v">{c.v.toLocaleString()}+</div>
      <div className="st__l">{label}</div>
    </div>
  );
}

/* ═══════════════════════════════════════
   DATA
   ═══════════════════════════════════════ */
const MAKES = [
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
  { t: "Smart Extraction", d: "AI pattern-matching with 55 make patterns and 3-tier confidence routing. Automatically detects vehicle compatibility from product titles.", s: "80%+ accuracy", wide: true },
  { t: "YMME Database", d: "Pre-loaded worldwide vehicle database with every make, model, and engine. Ready to use from day one.", s: "29K+ engines", wide: true },
  { t: "Smart Collections", d: "Auto-creates SEO-optimized Shopify collections with brand logos and descriptions.", s: "3 strategies", wide: false },
  { t: "7 Storefront Widgets", d: "YMME, Badge, Compat, Garage, Wheels, Plate, VIN — all native Shopify blocks.", s: "7 widgets", wide: false },
  { t: "Provider Import", d: "CSV, XML, JSON, API, FTP with smart column mapping and scheduled auto-imports.", s: "5 formats", wide: false },
  { t: "Vehicle Spec Pages", d: "Auto-generated SEO pages with 90+ engine specs as Shopify metaobjects.", s: "90+ fields", wide: false },
  { t: "Push Engine", d: "Tags, 5 metafield types, and Search & Discovery filters — all automatic.", s: "5 metafields", wide: false },
  { t: "Pricing Engine", d: "Markup, margin, fixed, MAP rules scoped by vendor, type, or tag.", s: "4 rules", wide: false },
];

const STEPS = [
  { n: "1", t: "Install & Import", d: "Install from the Shopify App Store. Fetch products or import from CSV, XML, API, or FTP suppliers." },
  { n: "2", t: "Auto-Extract", d: "Smart extraction scans your product data and detects vehicle compatibility with 80%+ accuracy." },
  { n: "3", t: "Push to Shopify", d: "Tags, metafields, and smart collections. Search & Discovery filters activate automatically." },
  { n: "4", t: "Sell More Parts", d: "Customers find exact-fit parts. Fewer returns, higher conversions, better SEO." },
];

const PLANS = [
  { name: "Free", price: 0, products: "50", fitments: "200", features: ["Manual mapping", "Product browser", "YMME data access", "Basic support"], pop: false },
  { name: "Starter", price: 19, products: "1,000", fitments: "5,000", features: ["Push tags & metafields", "YMME Search widget", "Fitment Badge", "1 provider import"], pop: false },
  { name: "Growth", price: 49, products: "10,000", fitments: "50,000", features: ["All 7 widgets", "Smart auto-extraction", "Make collections", "Bulk operations"], pop: true },
  { name: "Professional", price: 99, products: "50,000", fitments: "250,000", features: ["API & FTP import", "Wheel Finder", "Vehicle Spec Pages", "Priority support"], pop: false },
  { name: "Business", price: 179, products: "200,000", fitments: "1,000,000", features: ["Pricing Engine", "Year-range collections", "My Garage widget", "Dedicated support"], pop: false },
  { name: "Enterprise", price: 299, products: "Unlimited", fitments: "Unlimited", features: ["UK Plate Lookup (DVLA)", "VIN Decode", "SLA guarantee", "White-glove onboarding"], pop: false },
];

const COMPS = [
  { n: "AutoSync", p: "Free\u2013$299", hl: true, db: 1, ext: 1, col: 1, w: "7", pl: 1, vin: 1, wh: 1 },
  { n: "Convermax", p: "$250\u2013$850", hl: false, db: 0, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 1 },
  { n: "EasySearch", p: "$19\u2013$75", hl: false, db: 1, ext: 0, col: 0, w: "2", pl: 0, vin: 0, wh: 0 },
  { n: "PCFitment", p: "$15\u2013$150", hl: false, db: 1, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 0 },
];

const FAQS = [
  { q: "What is YMME and why does my store need it?", a: "YMME (Year, Make, Model, Engine) is the industry standard for vehicle parts compatibility. It helps customers find parts that fit their specific vehicle, reducing returns by up to 80% and increasing conversions." },
  { q: "Do I need to manually enter all vehicle data?", a: "No. AutoSync includes a pre-loaded database of 374+ makes, 3,686 models, and 29,515 engines. Our smart extraction engine automatically detects vehicle compatibility from your existing product titles and descriptions." },
  { q: "How does the UK plate lookup work?", a: "Enterprise plan includes DVLA integration. Customers enter their UK registration number and instantly see their vehicle details, MOT history, tax status, and compatible parts from your store." },
  { q: "Will the widgets work with my Shopify theme?", a: "Yes. All widgets are Shopify Theme App Extension blocks that work with any Online Store 2.0 theme. Drag and drop in the theme editor, zero code changes required." },
  { q: "How is AutoSync different from Convermax?", a: "Convermax starts at $250/month with complex setup. AutoSync offers more features including plate lookup, VIN decode, smart collections, auto-extraction, and 7 widgets, starting free with self-service setup." },
  { q: "Can I import products from supplier feeds?", a: "Yes. AutoSync supports CSV, XML, JSON, REST API, and FTP imports with smart column mapping that auto-detects fields and remembers your mappings for future imports." },
  { q: "Is there a free trial?", a: "The Free plan lets you try AutoSync with 50 products at no cost, forever. All paid plans include a 14-day free trial." },
];

const TESTIMONIALS = [
  { q: "AutoSync completely transformed how we sell parts online. Our customers find exact-fit parts in seconds instead of scrolling through pages.", n: "James Mitchell", r: "Mitchell Performance Parts" },
  { q: "The YMME search widget alone was worth the switch. We saw a 40% reduction in returns within the first month of installing AutoSync.", n: "Sarah Thompson", r: "UK Auto Spares" },
  { q: "Moving from Convermax saved us over $600/month and we actually got more features. The plate lookup is incredible for our UK customers.", n: "David Chen", r: "DriveSpec Ltd" },
];

/* ═══════════════════════════════════════
   DASHBOARD COMPONENT (rebuilt)
   ═══════════════════════════════════════ */
function Dashboard() {
  const [pg, setPg] = useState(0);
  const pages = ["Dashboard", "Products", "Push", "Collections"];
  const navIcons = [
    <svg key="0" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
    <svg key="1" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4l6-2 6 2v8l-6 2-6-2z"/><path d="M8 6v8"/></svg>,
    <svg key="2" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 12V4"/><path d="M5 7l3-3 3 3"/><path d="M3 14h10"/></svg>,
    <svg key="3" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="4" width="14" height="10" rx="1.5"/><path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1"/></svg>,
  ];

  return (
    <div className="dash">
      <div className="dash__s">
        <div className="dash__logo">{Logo(15)} AutoSync</div>
        <div className="dash__n">
          {pages.map((p, i) => (
            <div key={p} className={`dash__item ${pg === i ? "on" : ""}`} onClick={() => setPg(i)} style={{ cursor: "pointer" }}>
              {navIcons[i]} {p}
            </div>
          ))}
        </div>
      </div>
      <div className="dash__m">
        {pg === 0 && <>
          <div className="d-t">Dashboard</div>
          <div className="d-l">Quick Actions</div>
          <div className="d-acts">
            <div className="d-act"><span className="d-dot" style={{ background: "#2563eb" }}/> Fetch Products</div>
            <div className="d-act"><span className="d-dot" style={{ background: "#ea580c" }}/> Auto Extract</div>
            <div className="d-act"><span className="d-dot" style={{ background: "#16a34a" }}/> Manual Map</div>
            <div className="d-act d-act--ac"><span className="d-dot" style={{ background: "rgba(255,255,255,.5)" }}/> Push to Shopify</div>
          </div>
          <div className="d-row">
            {[["2,844", "Products"], ["5,827", "Fitments"], ["1,251", "Mapped"], ["44%", "Coverage"]].map(([n, l], i) =>
              <div key={i} className="d-c"><div className="d-c__n">{n}</div><div className="d-c__l">{l}</div></div>
            )}
          </div>
          <div className="d-l">Fitment Coverage</div>
          <div className="d-bar"><div className="d-bar__f" style={{ width: "44%" }}/></div>
          <div className="d-meta"><span>1,593 Needs Review</span><span>1,251 Mapped</span></div>
        </>}
        {pg === 1 && <>
          <div className="d-t">Products</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Product", "Status", "Fits"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid var(--border)", color: "var(--text-4)", fontSize: 10, textTransform: "uppercase" as const, letterSpacing: ".05em", fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {[["Eibach Pro-Kit Springs", "mapped", "var(--green)", 12], ["MST BMW Intake", "mapped", "var(--green)", 8], ["Scorpion Exhaust", "unmapped", "var(--text-4)", 0], ["Bilstein B14 Kit", "flagged", "var(--orange)", 3]].map(([n, s, c, f], i) =>
                <tr key={i}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", fontWeight: 500, color: "var(--text)" }}>{n as string}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: `color-mix(in srgb, ${c} 10%, transparent)`, color: c as string }}>{s as string}</span>
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", textAlign: "center", fontWeight: 600 }}>{f as number}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>}
        {pg === 2 && <>
          <div className="d-t">Push to Shopify</div>
          <button className="dm-btn" style={{ width: "100%", marginBottom: 14, borderRadius: "var(--r)", padding: "12px" }}>Push All Mapped Products</button>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
            {["Push Tags", "Push Metafields", "Create Collections"].map(t => (
              <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" defaultChecked readOnly style={{ accentColor: "var(--ac)", width: 16, height: 16 }}/> {t}
              </label>
            ))}
          </div>
        </>}
        {pg === 3 && <>
          <div className="d-t">Collections</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {MAKES.slice(0, 4).map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: "var(--r)", border: "1px solid var(--border)", background: "var(--bg)" }}>
                <img src={m.l} alt="" style={{ width: 28, height: 28, objectFit: "contain" }}/>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{m.n} Parts</div>
                  <div style={{ fontSize: 11, color: "var(--text-4)" }}>{[423, 312, 189, 156][i]} products</div>
                </div>
              </div>
            ))}
          </div>
        </>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   FEATURE ROW VISUALS
   Each is a unique mini-demo for alternating rows
   ═══════════════════════════════════════ */
function YmmeVisual() {
  return (
    <div>
      <div className="chr"><span/><span/><span/></div>
      <div className="di">
        <div className="dm-t">Find Parts for Your Vehicle</div>
        <div className="dm-g4">
          {[["Make", "BMW"], ["Model", "3 Series"], ["Year", "2022"], ["Engine", "M340i"]].map(([label, val]) => (
            <div key={label}>
              <div className="dm-lb">{label}</div>
              <div className="dm-sel dm-anim">
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {label === "Make" && <img src={MAKES[0].l} alt="" width="18" height="18" style={{ objectFit: "contain" }}/>}
                  {val}
                </span>
                {Chev}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="dm-btn" style={{ flex: 1, height: 40 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            Find Parts
          </button>
          <div style={{ width: 40, height: 40, borderRadius: "var(--r)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <span style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "var(--ac)", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
          </div>
        </div>
        <div className="dm-foot">{Logo(11)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function PlateVisual() {
  return (
    <div>
      <div className="chr"><span/><span/><span/></div>
      <div className="di">
        <div className="dm-t" style={{ textAlign: "center" }}>UK Plate Lookup</div>
        <div className="dm-s" style={{ textAlign: "center" }}>Enter your registration number</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div className="dm-plate" style={{ flex: 1 }}>
            <div className="dm-plate__gb">
              <svg width="22" height="15" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3"/><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10"/><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6"/></svg>
            </div>
            <input className="dm-plate__in" value="AL61 EAJ" readOnly/>
          </div>
          <button className="dm-btn" style={{ height: 44, padding: "0 18px" }}>Look Up</button>
        </div>
        <div style={{ fontFamily: "var(--heading)", fontSize: 16, fontWeight: 700, marginBottom: 3, color: "var(--text)" }}>BMW M340I XDRIVE MHEV AUTO</div>
        <div style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 12 }}>2022 · ORANGE · HYBRID ELECTRIC</div>
        {[["Year", "2022"], ["Engine", "2998cc"], ["Fuel", "HYBRID ELECTRIC"], ["CO\u2082", "176 g/km"]].map(([k, v], i) =>
          <div key={i} className="dm-sr"><span>{k}</span><span>{v}</span></div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "12px 0" }}>
          {[["MOT", "Valid", "var(--green)"], ["TAX", "Taxed", "var(--green)"]].map(([l, v, c]) => (
            <div key={l as string} style={{ padding: 10, borderRadius: "var(--r)", background: "var(--bg-alt)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-4)", textTransform: "uppercase" as const, letterSpacing: ".05em" }}>{l as string}</div>
              <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, color: "var(--text)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: c as string }}/>{v as string}
              </div>
            </div>
          ))}
        </div>
        <button className="dm-btn" style={{ width: "100%" }}>Find Parts for This Vehicle</button>
        <div className="dm-foot">{Logo(11)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function VinVisual() {
  return (
    <div>
      <div className="chr"><span/><span/><span/></div>
      <div className="di" style={{ textAlign: "center" }}>
        <div className="dm-t">VIN Decode</div>
        <div className="dm-s">Decode any 17-character VIN worldwide</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <span style={{ padding: "5px 10px", background: "var(--ac-light)", color: "var(--ac)", fontSize: 10, fontWeight: 700, borderRadius: 6, letterSpacing: ".05em", border: "1px solid rgba(37,99,235,.08)" }}>VIN</span>
          <div className="dm-vf">
            <input value="WBAPH5C55BA123456" readOnly style={{ letterSpacing: 1.2 }}/>
            <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600, fontFamily: "var(--mono)" }}>17/17</span>
          </div>
          <button className="dm-btn">Decode</button>
        </div>
        <div style={{ fontFamily: "var(--heading)", fontSize: 16, fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>2011 BMW 5 Series 528i</div>
        <div className="dm-vg">
          {[["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Body", "Sedan"], ["Drive", "RWD"], ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Trans", "Auto"], ["Country", "Germany"], ["Trim", "528i"]].map(([k, v], i) =>
            <div key={i} className="dm-vc"><div className="dm-vk">{k}</div><div className="dm-vv">{v}</div></div>
          )}
        </div>
        <div className="dm-foot">{Logo(11)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

function BadgeVisual() {
  return (
    <div>
      <div className="chr"><span/><span/><span/></div>
      <div className="di" style={{ textAlign: "center" }}>
        <div className="dm-t">Fitment Badge</div>
        <div className="dm-s">Appears on every product page automatically</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="dm-badge dm-badge--green">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#16a34a" strokeWidth="2" strokeLinecap="round"/></svg>
            Fits your 2022 BMW 3 Series
          </div>
          <div className="dm-badge dm-badge--red">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/></svg>
            May not fit your vehicle
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="dm-vcg">
            {[{ m: "BMW", n: "3 Series", hp: "102 HP" }, { m: "Audi", n: "A3", hp: "115 HP" }].map((v, i) => (
              <div key={i} className="dm-vcd">
                <div className="dm-vcd__m"><img src={MAKES[i].l} alt="" />{v.m}</div>
                <h4>{v.n}</h4>
                <div className="dm-vcd__p">
                  <span className="dm-vcd__pl dm-vcard__pill--ac">{v.hp}</span>
                  <span className="dm-vcard__pill">Petrol</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="dm-foot">{Logo(11)} Powered by AutoSync</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════ */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [showBtt, setShowBtt] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const stepsRef = useRef<HTMLDivElement>(null);
  const bentoRef = useRef<HTMLDivElement>(null);

  // Scroll
  useEffect(() => {
    const fn = () => { setScrolled(window.scrollY > 20); setShowBtt(window.scrollY > 600); };
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Hero word stagger
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.querySelectorAll(".hero__word").forEach((w, i) => {
      setTimeout(() => w.classList.add("v"), 400 + i * 130);
    });
  }, []);

  // GSAP: steps line + product frame scale
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
          if (stepsRef.current) {
            gsap.to(stepsRef.current, {
              width: "100%", ease: "none",
              scrollTrigger: { trigger: stepsRef.current.parentElement, start: "top 70%", end: "bottom 50%", scrub: true },
            });
          }
          // Product frame scale on scroll
          const frame = document.querySelector(".product__frame");
          if (frame) {
            gsap.fromTo(frame, { scale: 0.92, rotateX: 6 }, {
              scale: 1, rotateX: 0, ease: "none",
              scrollTrigger: { trigger: frame, start: "top 85%", end: "top 30%", scrub: true },
            });
          }
        });
      } catch (_) { /* GSAP not available */ }
    })();
    return () => { if (ctx) ctx.revert(); };
  }, []);

  // Bento staggered reveal
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = bentoRef.current; if (!el) return;
    const cards = el.querySelectorAll(".bc");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const card = entry.target as HTMLElement;
          const idx = Array.from(cards).indexOf(card);
          setTimeout(() => card.classList.add("vis"), idx * 100);
          obs.unobserve(card);
        }
      });
    }, { threshold: 0.1 });
    cards.forEach(c => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="L">

      {/* ══════ 1. NAV ══════ */}
      <nav className={`N ${scrolled ? "scrolled" : ""}`}>
        <div className="N__i">
          <a href="#" className="N__logo">{Logo()} AutoSync</a>
          <div className="N__links">
            <a href="#features">Features</a>
            <a href="#how">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="B B--dark B--sm">Start Free Trial</a>
        </div>
      </nav>

      {/* ══════ 2. HERO ══════ */}
      <section className="hero">
        <div className="hero__inner">
          <div className="hero__tag"><span className="tag">Vehicle Fitment Intelligence</span></div>
          <h1 className="hero__title">
            {["Vehicle", "fitment"].map((w, i) => <span key={i} className="hero__word">{w}</span>)}
            <span className="hero__word hero__word--ac">intelligence</span>
            {["for", "Shopify"].map((w, i) => <span key={i + 3} className="hero__word">{w}</span>)}
          </h1>
          <p className="hero__sub">The only app that automatically maps vehicle fitments to your products, creates smart collections, and adds Search & Discovery filters — so customers find exact-fit parts instantly.</p>
          <div className="hero__ctas">
            <a href="#login" className="B B--dark B--lg">Start Free Trial</a>
            <a href="#features" className="B B--ghost B--lg">See How It Works</a>
          </div>
        </div>
        <div className="hero__stats">
          <Stat value={stats.makes} label="Vehicle Makes"/>
          <Stat value={stats.models} label="Models"/>
          <Stat value={stats.engines} label="Engines"/>
          <Stat value={stats.specs} label="Vehicle Specs"/>
        </div>
      </section>

      {/* ══════ 3. 3D PRODUCT HERO ══════ */}
      <div className="product-hero">
        <div className="product-frame">
          <Dashboard/>
        </div>
      </div>

      {/* ══════ 4. TRUST MARQUEE ══════ */}
      <section className="trust">
        <div className="W"><p className="trust__l">Trusted by parts retailers using these vehicle brands</p></div>
        <div style={{ overflow: "hidden" }}>
          <div className="marquee">
            {[...MAKES, ...MAKES].map((m, i) => <img key={i} src={m.l} alt={m.n} title={m.n} loading="lazy"/>)}
          </div>
        </div>
      </section>

      {/* ══════ 5. BENTO GRID — 8 Systems ══════ */}
      <section id="features" className="sec">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">Platform</span>
              <div className="h2">8 integrated systems</div>
              <p className="p2">A complete platform where every system works together seamlessly.</p>
            </div>
          </Rv>
          <div className="bento" ref={bentoRef}>
            {SYSTEMS.map((sys, i) => (
              <div key={i} className={`bento__card ${sys.wide ? "bento__card--wide" : ""}`}>
                <h3>{sys.t}</h3>
                <p>{sys.d}</p>
                <span className="bc__stat">{sys.s}</span>
                {sys.wide && (
                  <div className="bc__vis">
                    {i === 0 ? (
                      [["Auto Mapped", "#16a34a", "72%"], ["Flagged", "#ea580c", "18%"], ["No Match", "#94a3b8", "10%"]].map(([l, c, w], j) => (
                        <div key={j} className="bc__vr">
                          <span className="bc__vd" style={{ background: c as string }}/>
                          <span style={{ flex: "0 0 90px", fontSize: 13 }}>{l}</span>
                          <div className="bc__vb"><div className="bc__vf" style={{ width: w as string, background: c as string }}/></div>
                        </div>
                      ))
                    ) : (
                      [["Makes", "374"], ["Models", "3,888"], ["Engines", "29,515"]].map(([l, v], j) => (
                        <div key={j} className="d-kv"><span>{l}</span><strong>{v}</strong></div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ 6. ALTERNATING FEATURE ROWS ══════ */}
      <section className="sec sec--alt">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">Storefront Widgets</span>
              <div className="h2">7 widgets your store needs</div>
              <p className="p2">Native Shopify Theme App Extension blocks. Drag and drop, zero code.</p>
            </div>
          </Rv>

          {/* Row 1: YMME (text left, visual right) */}
          <Rv>
            <div className="fr">
              <div className="fr__text">
                <span className="tag">YMME Search</span>
                <h3>Find parts by vehicle</h3>
                <p>Cascading Make, Model, Year, Engine dropdowns with brand logos, My Garage for saved vehicles, and instant search results.</p>
                <ul>
                  <li>{Chk} 374+ vehicle makes with logos</li>
                  <li>{Chk} My Garage saves multiple vehicles</li>
                  <li>{Chk} Search & Discovery integration</li>
                </ul>
              </div>
              <div className="fr__visual"><YmmeVisual/></div>
            </div>
          </Rv>

          {/* Row 2: Plate (reversed) */}
          <Rv>
            <div className="fr feat-row--rev">
              <div className="fr__text">
                <span className="tag">Plate Lookup</span>
                <h3>UK registration lookup</h3>
                <p>DVLA integration with MOT history, tax status, and instant vehicle identification from a UK number plate.</p>
                <ul>
                  <li>{Chk} Real-time DVLA API</li>
                  <li>{Chk} MOT history & tax status</li>
                  <li>{Chk} Recent searches saved</li>
                </ul>
              </div>
              <div className="fr__visual"><PlateVisual/></div>
            </div>
          </Rv>

          {/* Row 3: VIN */}
          <Rv>
            <div className="fr">
              <div className="fr__text">
                <span className="tag">VIN Decode</span>
                <h3>Decode any vehicle worldwide</h3>
                <p>17-character VIN decoder covering 60+ manufacturers with full spec breakdown and one-click part search.</p>
                <ul>
                  <li>{Chk} 60+ manufacturers supported</li>
                  <li>{Chk} Full specification breakdown</li>
                  <li>{Chk} One-click compatible parts search</li>
                </ul>
              </div>
              <div className="fr__visual"><VinVisual/></div>
            </div>
          </Rv>

          {/* Row 4: Badge & Specs (reversed) */}
          <Rv>
            <div className="fr feat-row--rev">
              <div className="fr__text">
                <span className="tag">Badge & Specs</span>
                <h3>Compatibility everywhere</h3>
                <p>Fitment badges on every product page and SEO-optimized vehicle specification galleries with 90+ fields per vehicle.</p>
                <ul>
                  <li>{Chk} Real-time fits / doesn't fit badge</li>
                  <li>{Chk} 90+ spec fields per vehicle</li>
                  <li>{Chk} Auto-generated SEO pages</li>
                </ul>
              </div>
              <div className="fr__visual"><BadgeVisual/></div>
            </div>
          </Rv>
        </div>
      </section>

      {/* ══════ 7. HOW IT WORKS ══════ */}
      <section id="how" className="sec">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">How It Works</span>
              <div className="h2">From install to sales in 4 steps</div>
            </div>
          </Rv>
          <div className="steps">
            <div className="steps__ln"><div ref={stepsRef} className="steps__fl"/></div>
            {STEPS.map((s, i) => (
              <Rv key={i} delay={i * 0.12}>
                <div className="step">
                  <div className="step__n">{s.n}</div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              </Rv>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ 8. PRICING ══════ */}
      <section id="pricing" className="sec sec--alt">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">Pricing</span>
              <div className="h2">Simple, transparent pricing</div>
              <p className="p2">Start free. Scale as you grow. All paid plans include a 14-day free trial.</p>
            </div>
          </Rv>
          <div className="pricing">
            {PLANS.map((p, i) => (
              <Rv key={p.name} delay={i * 0.06}>
                <div className={`pr ${p.pop ? "pr--pop" : ""}`}>
                  {p.pop && <div className="pr__badge">Most Popular</div>}
                  <div className="pr__name">{p.name}</div>
                  <div style={{ marginBottom: 16 }}>
                    {p.price === 0
                      ? <span className="pr__amt">Free</span>
                      : <><span className="pr__amt">${p.price}</span><span className="pr__per">/mo</span></>
                    }
                  </div>
                  <div className="pr__limits">
                    <div><strong>{p.products}</strong> products</div>
                    <div><strong>{p.fitments}</strong> fitments</div>
                  </div>
                  <ul className="pr__feat">
                    {p.features.map((f, j) => <li key={j}>{Chk} {f}</li>)}
                  </ul>
                  <a href="#login" className={`B ${p.pop ? "B--ac" : "B--ghost"}`} style={{ width: "100%", justifyContent: "center" }}>
                    {p.price === 0 ? "Get Started" : "Start Free Trial"}
                  </a>
                </div>
              </Rv>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ 9. COMPARISON ══════ */}
      <section id="compare" className="sec">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">Comparison</span>
              <div className="h2">AutoSync vs the competition</div>
            </div>
          </Rv>
          <Rv delay={0.1}>
            <div className="cmp">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Feature</th>
                    {COMPS.map((c, i) => <th key={i} className={c.hl ? "hl" : ""}>{c.hl ? <strong>{c.n}</strong> : c.n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Price</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.p}</td>)}</tr>
                  {(["db", "ext", "col", "pl", "vin", "wh"] as const).map(k => (
                    <tr key={k}>
                      <td>{{ db: "YMME Database", ext: "Auto Extract", col: "Collections", pl: "Plate Lookup", vin: "VIN Decode", wh: "Wheel Finder" }[k]}</td>
                      {COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{(c as any)[k] === 1 ? Chk : (c as any)[k] === 0 ? Xic : (c as any)[k]}</td>)}
                    </tr>
                  ))}
                  <tr><td>Widgets</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.w}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </Rv>
        </div>
      </section>

      {/* ══════ 10. TESTIMONIALS ══════ */}
      <section className="sec sec--alt">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">Testimonials</span>
              <div className="h2">What parts retailers say</div>
            </div>
          </Rv>
          <div className="tss">
            {TESTIMONIALS.map((t, i) => (
              <Rv key={i} delay={i * 0.1}>
                <div className="ts">
                  <div className="ts__stars">★★★★★</div>
                  <div className="ts__q">"{t.q}"</div>
                  <div className="ts__n">{t.n}</div>
                  <div className="ts__r">{t.r}</div>
                </div>
              </Rv>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ 11. FAQ ══════ */}
      <section id="faq" className="sec">
        <div className="W">
          <Rv>
            <div className="shdr c">
              <span className="tag">FAQ</span>
              <div className="h2">Frequently asked questions</div>
            </div>
          </Rv>
          <div className="faq-list">
            {FAQS.map((item, i) => (
              <Rv key={i} delay={i * 0.03}>
                <div className={`faq ${faq === i ? "open" : ""}`}>
                  <button className="faq__q" onClick={() => setFaq(faq === i ? null : i)}>
                    {item.q}
                    <span className="faq__ico">+</span>
                  </button>
                  {faq === i && <div className="faq__a">{item.a}</div>}
                </div>
              </Rv>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ 12. CTA ══════ */}
      <section className="cta">
        <div className="W" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <Rv>
            <div className="h2">Ready to sell more parts?</div>
            <p className="p2" style={{ margin: "16px auto 32px", color: "rgba(255,255,255,.75)" }}>
              Join automotive stores using AutoSync to help customers find exact-fit parts.
            </p>
            <a href="#login" className="B B--white B--lg">Start Your Free Trial</a>
          </Rv>
        </div>
      </section>

      {/* ══════ 13. LOGIN ══════ */}
      <section id="login" className="sec" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="W" style={{ maxWidth: 440, textAlign: "center" }}>
          {Logo(44)}
          <div style={{ fontFamily: "var(--heading)", fontSize: 20, fontWeight: 700, margin: "16px 0 6px", letterSpacing: "-.02em" }}>AutoSync</div>
          <p style={{ fontSize: 14, color: "var(--text-3)", marginBottom: 24 }}>Enter your Shopify store domain to get started</p>
          {showForm && (
            <Form method="post" action="/auth/login">
              <div style={{ display: "flex", gap: 8 }}>
                <input name="shop" className="login-i" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)}/>
                <button type="submit" className="B B--ac">Install</button>
              </div>
            </Form>
          )}
        </div>
      </section>

      {/* ══════ BACK TO TOP ══════ */}
      {showBtt && (
        <button className="btt" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
      )}

      {/* ══════ 14. FOOTER ══════ */}
      <footer className="foot">
        <div className="W">
          <div className="foot__g">
            <div>
              <div className="foot__brand">{Logo(18)} AutoSync</div>
              <p className="foot__desc">Vehicle fitment intelligence for Shopify. Help customers find parts that fit their vehicle.</p>
            </div>
            <div>
              <h4>Product</h4>
              <div className="foot__lk">
                <a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a>
              </div>
            </div>
            <div>
              <h4>Company</h4>
              <div className="foot__lk">
                <a href="#">About</a><a href="#">Blog</a><a href="#">Changelog</a>
              </div>
            </div>
            <div>
              <h4>Legal</h4>
              <div className="foot__lk">
                <a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="mailto:support@autosync.app">Contact</a>
              </div>
            </div>
          </div>
          <div className="foot__b">&copy; {new Date().getFullYear()} AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
