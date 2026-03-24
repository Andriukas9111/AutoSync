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
    stats: {
      makes: makesRes.count ?? 0,
      models: modelsRes.count ?? 0,
      engines: enginesRes.count ?? 0,
      specs: specsRes.count ?? 0,
      tenants: tenantsRes.count ?? 0,
      products: productsRes.count ?? 0,
      fitments: fitmentsRes.count ?? 0,
      collections: collectionsRes.count ?? 0,
    },
  };
};

/* ─── SVG Logo ─── */
function Logo({ size = 32, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/>
      <path fill={color} d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/>
    </svg>
  );
}

/* ─── Icons ─── */
function CheckIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function CrossIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/></svg>; }
function DashIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8h8" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/></svg>; }

/* ─── Animated Counter ─── */
function useCounter(end: number, duration = 2000) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
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
    }, { threshold: 0.3 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);
  return { value, ref };
}

function StatCounter({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) {
  const counter = useCounter(value, 2000);
  return (
    <div ref={counter.ref} className="lp-stat">
      <div className="lp-stat__number">{counter.value.toLocaleString()}{suffix}</div>
      <div className="lp-stat__label">{label}</div>
    </div>
  );
}

/* ─── Scroll Fade-in ─── */
function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(30px)", transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s` }}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INTERACTIVE WIDGET DEMOS (mock data, fully functional UI)
   ═══════════════════════════════════════════════════════════════ */

const DEMO_MAKES = [
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
  const [showDropdown, setShowDropdown] = useState(false);
  const [search, setSearch] = useState("");
  const [garage, setGarage] = useState(false);
  const filtered = DEMO_MAKES.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="demo-widget demo-ymme">
      <h3 className="demo-widget__title">Find Parts for Your Vehicle</h3>
      <div className="demo-ymme__grid">
        <div className="demo-ymme__field" style={{ position: "relative" }}>
          <label>Make</label>
          <button className="demo-ymme__select" onClick={() => setShowDropdown(!showDropdown)}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src={DEMO_MAKES.find(m => m.name === make)?.logo} alt="" width="20" height="20" style={{ objectFit: "contain" }} />
              {make}
            </span>
            <span style={{ opacity: 0.4 }}>&#9660;</span>
          </button>
          {showDropdown && (
            <div className="demo-ymme__dropdown">
              <input className="demo-ymme__search" placeholder="Search makes..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              <ul className="demo-ymme__list">
                {filtered.map(m => (
                  <li key={m.name} className={`demo-ymme__option ${m.name === make ? "active" : ""}`} onClick={() => { setMake(m.name); setShowDropdown(false); setSearch(""); }}>
                    <img src={m.logo} alt="" width="20" height="20" style={{ objectFit: "contain" }} /> {m.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="demo-ymme__field"><label>Model</label><select className="demo-ymme__select"><option>3 Series 1975-present</option></select></div>
        <div className="demo-ymme__field"><label>Year</label><select className="demo-ymme__select"><option>2022</option></select></div>
        <div className="demo-ymme__field"><label>Engine</label><select className="demo-ymme__select"><option>M340i (382 Hp)</option></select></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="demo-btn demo-btn--primary" style={{ flex: 1 }}>&#128269; Find Parts</button>
        <button className="demo-btn demo-btn--ghost" onClick={() => setGarage(!garage)} style={{ position: "relative" }}>
          &#127968;
          <span style={{ position: "absolute", top: -6, right: -6, background: "#005bd2", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
        </button>
      </div>
      {garage && (
        <div className="demo-garage">
          <div className="demo-garage__header"><strong>My Garage</strong><button className="demo-garage__clear">&#128465;</button></div>
          {[{ y: 2013, mk: "Porsche", md: "Panamera", eng: "" }, { y: 2022, mk: "BMW", md: "3 Series", eng: "M340i (382 Hp) xDrive Steptronic (US)" }, { y: 2004, mk: "BMW", md: "6 Series", eng: "645Ci (333 Hp)" }].map((v, i) => (
            <div key={i} className="demo-garage__item">
              <div><strong>{v.y} {v.mk} {v.md}</strong>{v.eng && <div style={{ fontSize: 12, opacity: 0.6 }}>{v.eng}</div>}</div>
              <div style={{ display: "flex", gap: 4 }}><button className="demo-btn demo-btn--sm">Select</button><button className="demo-btn demo-btn--sm demo-btn--ghost">&times;</button></div>
            </div>
          ))}
        </div>
      )}
      <div className="demo-widget__footer">&#9650; Powered by <strong>AutoSync</strong></div>
    </div>
  );
}

function PlateDemo() {
  const [plate, setPlate] = useState("");
  const [result, setResult] = useState(false);
  return (
    <div className="demo-widget demo-plate">
      <h3 className="demo-widget__title" style={{ textAlign: "center" }}>Find Parts by Registration</h3>
      <p style={{ textAlign: "center", fontSize: 14, opacity: 0.6, marginBottom: 16 }}>Enter your UK registration number to find compatible parts</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1, display: "flex", borderRadius: 8, overflow: "hidden", border: "2px solid #fbbf24" }}>
          <div style={{ background: "#1e40af", color: "#fff", padding: "10px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 8 }}>&#9733;</span> GB
          </div>
          <input className="demo-plate__input" placeholder="Enter reg..." value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} style={{ flex: 1, background: "#fbbf24", color: "#000", fontWeight: 700, fontSize: 20, textAlign: "center", border: "none", padding: "10px 12px", fontFamily: "'UKNumberPlate', monospace" }} />
        </div>
        <button className="demo-btn demo-btn--primary" onClick={() => setResult(true)}>&#128269; Look Up</button>
      </div>
      {result && (
        <div className="demo-plate__result">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ background: "#1e40af", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>GB</span>
            <span style={{ background: "#fbbf24", color: "#000", padding: "2px 10px", borderRadius: 4, fontSize: 14, fontWeight: 700 }}>{plate || "AL61 EAJ"}</span>
          </div>
          <h4 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>BMW M340I XDRIVE MHEV AUTO</h4>
          <p style={{ fontSize: 13, opacity: 0.6, margin: "0 0 12px" }}>2022 &bull; ORANGE &bull; HYBRID ELECTRIC</p>
          <div className="demo-plate__specs">
            <div className="demo-plate__spec"><span>Year</span><strong>2022</strong></div>
            <div className="demo-plate__spec"><span>Colour</span><strong>ORANGE</strong></div>
            <div className="demo-plate__spec"><span>Fuel Type</span><strong>HYBRID ELECTRIC</strong></div>
            <div className="demo-plate__spec"><span>Engine</span><strong>2998cc</strong></div>
            <div className="demo-plate__spec"><span>CO&#8322; Emissions</span><strong>176 g/km</strong></div>
            <div className="demo-plate__spec"><span>Type Approval</span><strong>M1</strong></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "12px 0" }}>
            <div><div style={{ fontSize: 12, opacity: 0.6 }}>MOT</div><span style={{ color: "#22c55e", fontWeight: 600 }}>&#9679; Valid</span><div style={{ fontSize: 11, opacity: 0.5 }}>Expires: 11 Nov 2026</div></div>
            <div><div style={{ fontSize: 12, opacity: 0.6 }}>TAX</div><span style={{ color: "#22c55e", fontWeight: 600 }}>&#9679; Taxed</span><div style={{ fontSize: 11, opacity: 0.5 }}>Due: 1 Nov 2026</div></div>
          </div>
          <button className="demo-btn demo-btn--primary" style={{ width: "100%" }}>Find Parts for This Vehicle &rarr;</button>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><span style={{ opacity: 0.4 }}>&#128339;</span> <strong>MOT History</strong> <span style={{ fontSize: 12, opacity: 0.5 }}>2 tests</span></div>
            {[{ date: "12 Nov 2025", result: "PASS", miles: "87,329 MI" }, { date: "4 Apr 2025", result: "PASS", miles: "72,485 MI" }].map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <span style={{ fontSize: 13 }}>{t.date}</span>
                <span style={{ background: "#dcfce7", color: "#166534", padding: "1px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{t.result}</span>
                <span style={{ fontSize: 13, opacity: 0.5 }}>{t.miles}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="demo-widget__footer">&#9650; Powered by <strong>AutoSync</strong></div>
    </div>
  );
}

function CompatibilityDemo() {
  return (
    <div className="demo-widget">
      <h3 className="demo-widget__title">Vehicle Compatibility</h3>
      <table className="demo-table">
        <thead><tr><th>Make</th><th>Model</th><th>Years</th><th>Engine</th></tr></thead>
        <tbody>
          {[
            { make: "BMW", model: "3 Series (F30/F31)", years: "2012-2019", engine: "320i (184 Hp)" },
            { make: "BMW", model: "3 Series (G20/G21)", years: "2019-2024", engine: "320i (184 Hp)" },
            { make: "BMW", model: "4 Series (F32/F33)", years: "2013-2020", engine: "420i (184 Hp)" },
            { make: "Audi", model: "A4 (B9)", years: "2016-2024", engine: "2.0 TFSI (190 Hp)" },
            { make: "Mercedes-Benz", model: "C-Class (W205)", years: "2014-2021", engine: "C200 (184 Hp)" },
          ].map((r, i) => (
            <tr key={i}><td>{r.make}</td><td>{r.model}</td><td>{r.years}</td><td>{r.engine}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="demo-widget__footer">&#9650; Powered by <strong>AutoSync</strong></div>
    </div>
  );
}

function FitmentBadgeDemo() {
  const [fits, setFits] = useState<boolean | null>(true);
  return (
    <div className="demo-widget" style={{ textAlign: "center" }}>
      <h3 className="demo-widget__title">Fitment Badge on Product Pages</h3>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
        <button className={`demo-badge-btn ${fits === true ? "active" : ""}`} onClick={() => setFits(true)}>Fits</button>
        <button className={`demo-badge-btn ${fits === false ? "active" : ""}`} onClick={() => setFits(false)}>Doesn&apos;t Fit</button>
        <button className={`demo-badge-btn ${fits === null ? "active" : ""}`} onClick={() => setFits(null)}>No Vehicle</button>
      </div>
      <div className={`demo-fitment-badge ${fits === true ? "fits" : fits === false ? "no-fit" : "neutral"}`}>
        {fits === true && <><span className="demo-fitment-badge__icon">&#10003;</span> Fits your 2022 BMW 3 Series</>}
        {fits === false && <><span className="demo-fitment-badge__icon">&#10007;</span> May not fit your 2022 BMW 3 Series</>}
        {fits === null && <><span className="demo-fitment-badge__icon">&#128663;</span> Select a vehicle to check compatibility</>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PRICING DATA
   ═══════════════════════════════════════════════════════════════ */

const PLANS = [
  { name: "Free", price: 0, badge: "", products: "50", fitments: "200", providers: "0", features: ["Manual mapping only", "Basic product browser", "Community support"], highlight: false },
  { name: "Starter", price: 19, badge: "", products: "1,000", fitments: "5,000", providers: "1", features: ["Push tags & metafields", "YMME Search widget", "Fitment Badge widget", "Compatibility table", "Email support"], highlight: false },
  { name: "Growth", price: 49, badge: "Popular", products: "10,000", fitments: "50,000", providers: "3", features: ["Everything in Starter", "Smart auto-extraction", "All 4 storefront widgets", "Make-based collections", "Bulk operations", "Analytics dashboard"], highlight: true },
  { name: "Professional", price: 99, badge: "", products: "50,000", fitments: "250,000", providers: "5", features: ["Everything in Growth", "API data import", "Wheel Finder widget", "Vehicle Spec Pages", "Make + Model collections", "Custom vehicle support", "Priority support"], highlight: false },
  { name: "Business", price: 179, badge: "", products: "200,000", fitments: "1,000,000", providers: "15", features: ["Everything in Professional", "FTP data import", "Pricing Engine", "Full YMME collections", "Year-range collections", "Dedicated support"], highlight: false },
  { name: "Enterprise", price: 299, badge: "", products: "Unlimited", fitments: "Unlimited", providers: "Unlimited", features: ["Everything in Business", "UK Plate Lookup (DVLA)", "VIN Decode", "Full CSS customisation", "White-label option", "SLA guarantee"], highlight: false },
];

const COMPETITORS = [
  { name: "AutoSync", price: "Free - $299", products: "50 - Unlimited", ymmeDb: true, autoExtract: true, collections: true, widgets: "7", plate: true, vin: true, wheelFinder: true, apiFtp: true, analytics: true, vehiclePages: true, highlight: true },
  { name: "Convermax", price: "$250 - $850", products: "250K - 1M", ymmeDb: false, autoExtract: false, collections: false, widgets: "1", plate: false, vin: true, wheelFinder: true, apiFtp: false, analytics: false, vehiclePages: true, highlight: false },
  { name: "EasySearch", price: "$19 - $75", products: "Unlimited", ymmeDb: true, autoExtract: false, collections: false, widgets: "2", plate: false, vin: false, wheelFinder: false, apiFtp: false, analytics: false, vehiclePages: false, highlight: false },
  { name: "C: YMM", price: "$10 - $75", products: "1.5M rows", ymmeDb: false, autoExtract: false, collections: false, widgets: "1", plate: false, vin: false, wheelFinder: false, apiFtp: false, analytics: false, vehiclePages: false, highlight: false },
  { name: "PCFitment", price: "$15 - $150", products: "SKU-based", ymmeDb: true, autoExtract: false, collections: false, widgets: "1", plate: false, vin: true, wheelFinder: false, apiFtp: false, analytics: true, vehiclePages: false, highlight: false },
  { name: "VFitz", price: "$1 - $58", products: "Varies", ymmeDb: true, autoExtract: false, collections: false, widgets: "1", plate: false, vin: false, wheelFinder: false, apiFtp: false, analytics: true, vehiclePages: false, highlight: false },
  { name: "AutoFit AI", price: "$50 - $250", products: "2K - 25K", ymmeDb: false, autoExtract: true, collections: false, widgets: "2", plate: false, vin: false, wheelFinder: false, apiFtp: false, analytics: false, vehiclePages: false, highlight: false },
  { name: "PartFinder", price: "$49", products: "Unlimited", ymmeDb: false, autoExtract: false, collections: false, widgets: "1", plate: false, vin: false, wheelFinder: false, apiFtp: false, analytics: true, vehiclePages: false, highlight: false },
  { name: "SearchAuto", price: "$89 - $500", products: "Session-based", ymmeDb: false, autoExtract: false, collections: false, widgets: "1", plate: false, vin: false, wheelFinder: false, apiFtp: false, analytics: false, vehiclePages: false, highlight: false },
];

const FAQ_ITEMS = [
  { q: "What is YMME and why does my store need it?", a: "YMME (Year, Make, Model, Engine) is the industry standard for vehicle parts compatibility. It helps customers quickly find parts that fit their specific vehicle, reducing returns by up to 80% and boosting conversion rates." },
  { q: "Do I need to manually enter all vehicle data?", a: "No! AutoSync includes a pre-loaded database of 331 makes, 3,131 models, and 24,026 engines. Our smart extraction engine automatically detects vehicle compatibility from your product titles and descriptions." },
  { q: "How does the UK plate lookup work?", a: "Enterprise plan includes DVLA integration. Customers enter their UK registration number and instantly see their vehicle details, MOT history, and compatible parts from your store." },
  { q: "Will the widgets work with my Shopify theme?", a: "Yes! AutoSync widgets are built as Shopify Theme App Extension blocks. They work with any theme and require zero code changes. Simply drag and drop them in the theme editor." },
  { q: "How is AutoSync different from Convermax?", a: "Convermax starts at $250/month and requires custom setup. AutoSync offers more features (plate lookup, VIN decode, smart collections, auto-extraction) starting from free, with a self-service setup that takes minutes." },
  { q: "Can I import products from my supplier feeds?", a: "Yes! AutoSync supports CSV, XML, JSON, REST API, and FTP imports. Our smart column mapper automatically detects fields and remembers your mappings for future imports." },
  { q: "What happens if I exceed my plan limits?", a: "You'll get a notification before reaching limits. Upgrade anytime to a higher plan. Your data is never deleted — you just won't be able to add more until you upgrade." },
  { q: "Is there a free trial?", a: "Yes! The Free plan lets you try AutoSync with up to 50 products at no cost. Paid plans start at just $19/month — a fraction of what competitors charge." },
];

/* ═══════════════════════════════════════════════════════════════
   MAIN LANDING PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [activeDemo, setActiveDemo] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [shopDomain, setShopDomain] = useState("");

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const demoTabs = [
    { label: "YMME Search", icon: "&#128269;" },
    { label: "Plate Lookup", icon: "&#127468;&#127463;" },
    { label: "Compatibility", icon: "&#9745;" },
    { label: "Fitment Badge", icon: "&#10003;" },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      {/* ─── Navigation ─── */}
      <nav className={`lp-nav ${scrolled ? "lp-nav--scrolled" : ""}`}>
        <div className="lp-container lp-nav__inner">
          <a href="#" className="lp-nav__logo"><Logo size={28} color="#005bd2" /> <span>AutoSync</span></a>
          <div className="lp-nav__links">
            <a href="#widgets">Widgets</a>
            <a href="#systems">Systems</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="lp-btn lp-btn--sm">Start Free</a>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="lp-hero">
        <div className="lp-container">
          <FadeIn className="lp-hero__content">
            <div className="lp-hero__badge">&#10024; Built for Shopify</div>
            <h1 className="lp-hero__title">Vehicle Fitment<br /><span className="lp-gradient-text">Intelligence</span> for Shopify</h1>
            <p className="lp-hero__sub">Help customers find parts that fit their vehicle. Year, Make, Model, Engine search with auto-extraction, 7 storefront widgets, smart collections, and UK plate lookup.</p>
            <div className="lp-hero__ctas">
              <a href="#login" className="lp-btn lp-btn--lg">Start Free Trial</a>
              <a href="#widgets" className="lp-btn lp-btn--lg lp-btn--outline">See Widgets</a>
            </div>
          </FadeIn>
          <FadeIn className="lp-hero__stats" delay={0.2}>
            <StatCounter value={stats.makes} label="Vehicle Makes" />
            <StatCounter value={stats.models} label="Models" />
            <StatCounter value={stats.engines} label="Engines" />
            <StatCounter value={stats.specs} label="Vehicle Specs" />
          </FadeIn>
        </div>
      </section>

      {/* ─── Trust Bar ─── */}
      <section className="lp-trust">
        <div className="lp-container lp-trust__inner">
          {[
            { icon: "&#128737;", text: "Built for Shopify" },
            { icon: "&#128274;", text: "App-owned metafields" },
            { icon: "&#9889;", text: "Edge Function processing" },
            { icon: "&#127760;", text: "Multi-tenant SaaS" },
            { icon: "&#128736;", text: "Zero code required" },
          ].map((t, i) => (
            <div key={i} className="lp-trust__item"><span>{t.icon}</span> {t.text}</div>
          ))}
        </div>
      </section>

      {/* ─── Interactive Widget Demos ─── */}
      <section id="widgets" className="lp-section">
        <div className="lp-container">
          <FadeIn>
            <div className="lp-section__header">
              <span className="lp-section__tag">STOREFRONT WIDGETS</span>
              <h2 className="lp-section__title">Interactive Widget Demos</h2>
              <p className="lp-section__sub">7 embeddable widgets that install into any Shopify theme with zero code changes. Try them below.</p>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="lp-demo-tabs">
              {demoTabs.map((tab, i) => (
                <button key={i} className={`lp-demo-tab ${activeDemo === i ? "active" : ""}`} onClick={() => setActiveDemo(i)} dangerouslySetInnerHTML={{ __html: `${tab.icon} ${tab.label}` }} />
              ))}
            </div>
            <div className="lp-demo-frame">
              <div className="lp-demo-frame__dots"><span /><span /><span /></div>
              <div className="lp-demo-frame__content">
                {activeDemo === 0 && <YMMEDemo />}
                {activeDemo === 1 && <PlateDemo />}
                {activeDemo === 2 && <CompatibilityDemo />}
                {activeDemo === 3 && <FitmentBadgeDemo />}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="lp-section lp-section--alt">
        <div className="lp-container">
          <FadeIn>
            <div className="lp-section__header">
              <span className="lp-section__tag">HOW IT WORKS</span>
              <h2 className="lp-section__title">From Install to Sales in 4 Steps</h2>
            </div>
          </FadeIn>
          <div className="lp-steps">
            {[
              { num: "1", title: "Install & Import", desc: "Install from Shopify App Store. Fetch your products or import from CSV/XML/API/FTP suppliers." },
              { num: "2", title: "Auto-Extract Fitments", desc: "Our smart extraction engine scans product data and automatically detects vehicle compatibility with 80%+ accuracy." },
              { num: "3", title: "Push to Shopify", desc: "Push tags, metafields, and smart collections to Shopify. Search & Discovery filters activate automatically." },
              { num: "4", title: "Sell More Parts", desc: "Customers find parts that fit their vehicle. Fewer returns, higher conversions, professional storefront." },
            ].map((s, i) => (
              <FadeIn key={i} delay={i * 0.1} className="lp-step">
                <div className="lp-step__num">{s.num}</div>
                <h3 className="lp-step__title">{s.title}</h3>
                <p className="lp-step__desc">{s.desc}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── System Deep-Dive ─── */}
      <section id="systems" className="lp-section">
        <div className="lp-container">
          <FadeIn>
            <div className="lp-section__header">
              <span className="lp-section__tag">PLATFORM CAPABILITIES</span>
              <h2 className="lp-section__title">Every System, Explained</h2>
              <p className="lp-section__sub">AutoSync is a complete platform with 14+ integrated systems working together.</p>
            </div>
          </FadeIn>
          <div className="lp-systems-grid">
            {[
              { icon: "&#129302;", title: "Smart Extraction Engine", desc: "Pattern-matching engine with 55 make patterns, 3-tier confidence routing (auto/flagged/unmapped). No AI costs — pure regex and coded rules.", stat: "80%+ accuracy" },
              { icon: "&#128663;", title: "YMME Vehicle Database", desc: `Pre-loaded with ${stats.makes.toLocaleString()} makes, ${stats.models.toLocaleString()} models, ${stats.engines.toLocaleString()} engines sourced from auto-data.net.`, stat: `${stats.specs.toLocaleString()} specs` },
              { icon: "&#128194;", title: "Smart Collections", desc: "Auto-creates SEO-optimized collections by Make, Make+Model, or Make+Model+Year Range. Includes brand logos and meta descriptions.", stat: "3 strategies" },
              { icon: "&#128297;", title: "7 Storefront Widgets", desc: "YMME Search, Fitment Badge, Compatibility Table, Plate Lookup, VIN Decode, Wheel Finder, Vehicle Specs. All zero-code theme blocks.", stat: "7 widgets" },
              { icon: "&#128229;", title: "Provider Import System", desc: "Import from CSV, XML, JSON, REST API, or FTP. Smart column mapper auto-detects fields and remembers your mappings.", stat: "5 formats" },
              { icon: "&#128196;", title: "Vehicle Spec Pages", desc: "Auto-generated SEO pages with 90+ engine specs. Power, torque, displacement, fuel type — all as Shopify metaobjects.", stat: "90+ fields" },
              { icon: "&#127919;", title: "Push to Shopify", desc: "Pushes tags (_autosync_BMW), metafields (make/model/year/engine lists), and activates Search & Discovery filters.", stat: "5 metafields" },
              { icon: "&#128176;", title: "Pricing Engine", desc: "Markup, margin, fixed, and MAP pricing rules. Scope by vendor, product type, provider, tag, or SKU prefix.", stat: "4 rule types" },
            ].map((sys, i) => (
              <FadeIn key={i} delay={i * 0.05} className="lp-system-card">
                <div className="lp-system-card__icon" dangerouslySetInnerHTML={{ __html: sys.icon }} />
                <h3 className="lp-system-card__title">{sys.title}</h3>
                <p className="lp-system-card__desc">{sys.desc}</p>
                <div className="lp-system-card__stat">{sys.stat}</div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="lp-section lp-section--alt">
        <div className="lp-container">
          <FadeIn>
            <div className="lp-section__header">
              <span className="lp-section__tag">PRICING</span>
              <h2 className="lp-section__title">Simple, Transparent Pricing</h2>
              <p className="lp-section__sub">Start free. Upgrade as you grow. Cancel anytime. All plans include 30-day free trial.</p>
            </div>
          </FadeIn>
          <div className="lp-pricing-grid">
            {PLANS.map((plan, i) => (
              <FadeIn key={i} delay={i * 0.05} className={`lp-pricing-card ${plan.highlight ? "lp-pricing-card--popular" : ""}`}>
                {plan.badge && <div className="lp-pricing-card__badge">{plan.badge}</div>}
                <h3 className="lp-pricing-card__name">{plan.name}</h3>
                <div className="lp-pricing-card__price">
                  {plan.price === 0 ? <span className="lp-pricing-card__amount">Free</span> : <><span className="lp-pricing-card__amount">${plan.price}</span><span className="lp-pricing-card__period">/month</span></>}
                </div>
                <div className="lp-pricing-card__limits">
                  <div>{plan.products} products</div>
                  <div>{plan.fitments} fitments</div>
                  <div>{plan.providers} providers</div>
                </div>
                <ul className="lp-pricing-card__features">
                  {plan.features.map((f, j) => <li key={j}><CheckIcon /> {f}</li>)}
                </ul>
                <a href="#login" className={`lp-btn ${plan.highlight ? "" : "lp-btn--outline"}`} style={{ width: "100%" }}>
                  {plan.price === 0 ? "Get Started" : "Start Free Trial"}
                </a>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Competitor Comparison ─── */}
      <section id="compare" className="lp-section">
        <div className="lp-container">
          <FadeIn>
            <div className="lp-section__header">
              <span className="lp-section__tag">COMPARISON</span>
              <h2 className="lp-section__title">AutoSync vs The Competition</h2>
              <p className="lp-section__sub">See why AutoSync offers the best value for automotive parts stores on Shopify.</p>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="lp-compare-wrapper">
              <table className="lp-compare-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    {COMPETITORS.map((c, i) => <th key={i} className={c.highlight ? "highlight" : ""}>{c.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Price</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.price}</td>)}</tr>
                  <tr><td>Products</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.products}</td>)}</tr>
                  <tr><td>YMME Database</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.ymmeDb ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>Auto Extraction</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.autoExtract ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>Smart Collections</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.collections ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>Widgets</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.widgets}</td>)}</tr>
                  <tr><td>UK Plate Lookup</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.plate ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>VIN Decode</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.vin ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>Wheel Finder</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.wheelFinder ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>API/FTP Import</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.apiFtp ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>Analytics</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.analytics ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                  <tr><td>Vehicle Pages</td>{COMPETITORS.map((c, i) => <td key={i} className={c.highlight ? "highlight" : ""}>{c.vehiclePages ? <CheckIcon /> : <CrossIcon />}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="lp-section lp-section--alt">
        <div className="lp-container" style={{ maxWidth: 800 }}>
          <FadeIn>
            <div className="lp-section__header">
              <span className="lp-section__tag">FAQ</span>
              <h2 className="lp-section__title">Frequently Asked Questions</h2>
            </div>
          </FadeIn>
          <div className="lp-faq-list">
            {FAQ_ITEMS.map((item, i) => (
              <FadeIn key={i} delay={i * 0.03}>
                <div className={`lp-faq ${openFaq === i ? "lp-faq--open" : ""}`}>
                  <button className="lp-faq__q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    {item.q}
                    <span className="lp-faq__arrow">{openFaq === i ? "−" : "+"}</span>
                  </button>
                  {openFaq === i && <div className="lp-faq__a">{item.a}</div>}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="lp-cta-section">
        <div className="lp-container" style={{ textAlign: "center" }}>
          <FadeIn>
            <h2 style={{ fontSize: 36, fontWeight: 800, marginBottom: 16, color: "#fff" }}>Ready to Sell More Parts?</h2>
            <p style={{ fontSize: 18, opacity: 0.8, marginBottom: 32, color: "#fff" }}>Join automotive stores using AutoSync to help customers find parts that fit.</p>
            <a href="#login" className="lp-btn lp-btn--lg" style={{ background: "#fff", color: "#005bd2" }}>Start Your Free Trial &rarr;</a>
          </FadeIn>
        </div>
      </section>

      {/* ─── Login ─── */}
      <section id="login" className="lp-section">
        <div className="lp-container" style={{ maxWidth: 480, textAlign: "center" }}>
          <Logo size={48} color="#005bd2" />
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: "16px 0 8px" }}>AutoSync</h2>
          <p style={{ fontSize: 14, opacity: 0.6, marginBottom: 24 }}>Enter your Shopify store domain to get started</p>
          {showForm && (
            <Form method="post" action="/auth/login">
              <div style={{ display: "flex", gap: 8 }}>
                <input name="shop" className="lp-login-input" placeholder="your-store.myshopify.com" value={shopDomain} onChange={e => setShopDomain(e.target.value)} />
                <button type="submit" className="lp-btn">Install</button>
              </div>
            </Form>
          )}
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer__grid">
            <div>
              <div className="lp-footer__logo"><Logo size={24} color="#94a3b8" /> AutoSync</div>
              <p className="lp-footer__desc">Vehicle fitment intelligence for Shopify automotive stores.</p>
            </div>
            <div>
              <h4>Product</h4>
              <a href="#widgets">Widgets</a>
              <a href="#systems">Systems</a>
              <a href="#pricing">Pricing</a>
              <a href="#compare">Compare</a>
            </div>
            <div>
              <h4>Support</h4>
              <a href="#faq">FAQ</a>
              <a href="mailto:support@autosync.app">Contact</a>
            </div>
            <div>
              <h4>Legal</h4>
              <a href="/legal/privacy">Privacy Policy</a>
              <a href="/legal/terms">Terms of Service</a>
            </div>
          </div>
          <div className="lp-footer__bottom">&copy; {new Date().getFullYear()} AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CSS — Scoped to landing page only
   ═══════════════════════════════════════════════════════════════ */

const LANDING_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #fff; -webkit-font-smoothing: antialiased; }

/* ─── Layout ─── */
.lp-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.lp-section { padding: 96px 0; }
.lp-section--alt { background: #f8fafc; }

/* ─── Nav ─── */
.lp-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 16px 0; transition: all 0.3s; }
.lp-nav--scrolled { background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); box-shadow: 0 1px 3px rgba(0,0,0,0.06); padding: 12px 0; }
.lp-nav__inner { display: flex; align-items: center; justify-content: space-between; }
.lp-nav__logo { display: flex; align-items: center; gap: 8px; text-decoration: none; color: #0f172a; font-weight: 800; font-size: 18px; }
.lp-nav__links { display: flex; gap: 32px; }
.lp-nav__links a { text-decoration: none; color: #64748b; font-size: 14px; font-weight: 500; transition: color 0.2s; }
.lp-nav__links a:hover { color: #005bd2; }

/* ─── Buttons ─── */
.lp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; border: none; cursor: pointer; transition: all 0.2s; background: #005bd2; color: #fff; font-family: inherit; }
.lp-btn:hover { background: #004ab5; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,91,210,0.3); }
.lp-btn--outline { background: transparent; color: #005bd2; border: 1.5px solid #005bd2; }
.lp-btn--outline:hover { background: #005bd2; color: #fff; }
.lp-btn--sm { padding: 8px 16px; font-size: 13px; }
.lp-btn--lg { padding: 16px 32px; font-size: 16px; border-radius: 10px; }

/* ─── Hero ─── */
.lp-hero { padding: 160px 0 80px; background: linear-gradient(135deg, #f0f4ff 0%, #fff 50%, #f0f9ff 100%); }
.lp-hero__content { max-width: 720px; }
.lp-hero__badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; background: #e0f2fe; color: #005bd2; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
.lp-hero__title { font-size: 56px; font-weight: 900; line-height: 1.1; letter-spacing: -1.5px; margin-bottom: 20px; color: #0f172a; }
.lp-gradient-text { background: linear-gradient(135deg, #005bd2, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.lp-hero__sub { font-size: 18px; line-height: 1.6; color: #64748b; margin-bottom: 32px; max-width: 560px; }
.lp-hero__ctas { display: flex; gap: 12px; }
.lp-hero__stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 64px; padding-top: 48px; border-top: 1px solid #e2e8f0; }

/* ─── Stats ─── */
.lp-stat { text-align: center; }
.lp-stat__number { font-size: 36px; font-weight: 800; color: #005bd2; }
.lp-stat__label { font-size: 13px; color: #64748b; margin-top: 4px; font-weight: 500; }

/* ─── Trust Bar ─── */
.lp-trust { padding: 24px 0; border-bottom: 1px solid #e2e8f0; background: #fff; }
.lp-trust__inner { display: flex; justify-content: center; gap: 40px; flex-wrap: wrap; }
.lp-trust__item { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: #64748b; }

/* ─── Section Headers ─── */
.lp-section__header { text-align: center; margin-bottom: 56px; }
.lp-section__tag { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 2px; color: #005bd2; text-transform: uppercase; margin-bottom: 12px; }
.lp-section__title { font-size: 40px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 12px; }
.lp-section__sub { font-size: 17px; color: #64748b; max-width: 600px; margin: 0 auto; line-height: 1.6; }

/* ─── Demo Tabs ─── */
.lp-demo-tabs { display: flex; justify-content: center; gap: 8px; margin-bottom: 32px; flex-wrap: wrap; }
.lp-demo-tab { padding: 10px 20px; border-radius: 8px; border: 1.5px solid #e2e8f0; background: #fff; color: #64748b; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; font-family: inherit; }
.lp-demo-tab.active { background: #005bd2; color: #fff; border-color: #005bd2; }
.lp-demo-tab:hover:not(.active) { border-color: #005bd2; color: #005bd2; }

/* ─── Demo Frame (browser chrome) ─── */
.lp-demo-frame { max-width: 680px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 20px 60px rgba(0,0,0,0.08); overflow: hidden; background: #fff; }
.lp-demo-frame__dots { display: flex; gap: 6px; padding: 12px 16px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
.lp-demo-frame__dots span { width: 10px; height: 10px; border-radius: 50%; }
.lp-demo-frame__dots span:nth-child(1) { background: #ef4444; }
.lp-demo-frame__dots span:nth-child(2) { background: #f59e0b; }
.lp-demo-frame__dots span:nth-child(3) { background: #22c55e; }
.lp-demo-frame__content { padding: 24px; }

/* ─── Demo Widget Styles ─── */
.demo-widget { position: relative; }
.demo-widget__title { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
.demo-widget__footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 16px; padding-top: 12px; border-top: 1px solid #f1f5f9; }
.demo-btn { padding: 10px 16px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; font-family: inherit; }
.demo-btn--primary { background: #005bd2; color: #fff; border-color: #005bd2; }
.demo-btn--primary:hover { background: #004ab5; }
.demo-btn--ghost { background: transparent; }
.demo-btn--sm { padding: 4px 10px; font-size: 12px; background: #005bd2; color: #fff; border-color: #005bd2; border-radius: 4px; }

/* ─── YMME Demo ─── */
.demo-ymme__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.demo-ymme__field label { display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; font-weight: 500; }
.demo-ymme__select { width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-family: inherit; }
.demo-ymme__dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 10; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); margin-top: 4px; max-height: 220px; overflow-y: auto; }
.demo-ymme__search { width: 100%; padding: 10px 12px; border: none; border-bottom: 1px solid #e2e8f0; font-size: 14px; outline: none; font-family: inherit; }
.demo-ymme__list { list-style: none; padding: 4px; }
.demo-ymme__option { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px; transition: background 0.15s; }
.demo-ymme__option:hover, .demo-ymme__option.active { background: #f1f5f9; }

/* ─── Garage Demo ─── */
.demo-garage { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
.demo-garage__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.demo-garage__clear { background: none; border: none; cursor: pointer; font-size: 16px; opacity: 0.4; }
.demo-garage__item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }

/* ─── Plate Demo ─── */
.demo-plate__result { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #fff; }
.demo-plate__specs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.demo-plate__spec { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
.demo-plate__spec span { color: #64748b; }

/* ─── Table Demo ─── */
.demo-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.demo-table th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; font-size: 13px; color: #64748b; }
.demo-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }

/* ─── Fitment Badge Demo ─── */
.demo-badge-btn { padding: 6px 16px; border-radius: 100px; border: 1.5px solid #e2e8f0; background: #fff; font-size: 13px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
.demo-badge-btn.active { background: #005bd2; color: #fff; border-color: #005bd2; }
.demo-fitment-badge { padding: 14px 20px; border-radius: 8px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; justify-content: center; transition: all 0.3s; }
.demo-fitment-badge.fits { background: #dcfce7; color: #166534; }
.demo-fitment-badge.no-fit { background: #fef2f2; color: #991b1b; }
.demo-fitment-badge.neutral { background: #f1f5f9; color: #64748b; }
.demo-fitment-badge__icon { font-size: 18px; }

/* ─── Steps ─── */
.lp-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px; }
.lp-step { text-align: center; padding: 32px 24px; border-radius: 12px; background: #fff; border: 1px solid #e2e8f0; transition: all 0.3s; }
.lp-step:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.06); }
.lp-step__num { width: 48px; height: 48px; border-radius: 50%; background: #005bd2; color: #fff; font-size: 20px; font-weight: 800; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
.lp-step__title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.lp-step__desc { font-size: 14px; color: #64748b; line-height: 1.5; }

/* ─── System Cards ─── */
.lp-systems-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.lp-system-card { padding: 28px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; transition: all 0.3s; }
.lp-system-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.06); border-color: #005bd2; }
.lp-system-card__icon { font-size: 28px; margin-bottom: 12px; }
.lp-system-card__title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.lp-system-card__desc { font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 12px; }
.lp-system-card__stat { display: inline-block; padding: 4px 10px; border-radius: 100px; background: #e0f2fe; color: #005bd2; font-size: 12px; font-weight: 600; }

/* ─── Pricing ─── */
.lp-pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.lp-pricing-card { padding: 32px 24px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; position: relative; transition: all 0.3s; }
.lp-pricing-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.06); }
.lp-pricing-card--popular { border-color: #005bd2; box-shadow: 0 0 0 1px #005bd2; }
.lp-pricing-card__badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); padding: 4px 16px; border-radius: 100px; background: #005bd2; color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; }
.lp-pricing-card__name { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.lp-pricing-card__price { margin-bottom: 16px; }
.lp-pricing-card__amount { font-size: 40px; font-weight: 800; }
.lp-pricing-card__period { font-size: 15px; color: #64748b; }
.lp-pricing-card__limits { padding: 12px 0; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; margin-bottom: 16px; font-size: 13px; color: #64748b; display: flex; flex-direction: column; gap: 4px; }
.lp-pricing-card__features { list-style: none; margin-bottom: 24px; }
.lp-pricing-card__features li { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 14px; }

/* ─── Compare Table ─── */
.lp-compare-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.lp-compare-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
.lp-compare-table th, .lp-compare-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center; }
.lp-compare-table th { background: #f8fafc; font-weight: 600; font-size: 12px; position: sticky; top: 0; }
.lp-compare-table td:first-child, .lp-compare-table th:first-child { text-align: left; font-weight: 500; }
.lp-compare-table .highlight { background: #f0f7ff; }
.lp-compare-table th.highlight { background: #005bd2; color: #fff; }

/* ─── FAQ ─── */
.lp-faq-list { display: flex; flex-direction: column; gap: 8px; }
.lp-faq { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; transition: all 0.2s; }
.lp-faq--open { border-color: #005bd2; }
.lp-faq__q { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border: none; background: none; font-size: 15px; font-weight: 600; cursor: pointer; text-align: left; font-family: inherit; color: #0f172a; }
.lp-faq__arrow { font-size: 20px; color: #64748b; flex-shrink: 0; }
.lp-faq__a { padding: 0 20px 16px; font-size: 14px; color: #64748b; line-height: 1.6; }

/* ─── CTA Section ─── */
.lp-cta-section { padding: 96px 0; background: linear-gradient(135deg, #005bd2, #7c3aed); }

/* ─── Login ─── */
.lp-login-input { flex: 1; padding: 12px 16px; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; font-family: inherit; }
.lp-login-input:focus { border-color: #005bd2; box-shadow: 0 0 0 3px rgba(0,91,210,0.1); }

/* ─── Footer ─── */
.lp-footer { padding: 64px 0 32px; background: #0f172a; color: #94a3b8; }
.lp-footer__grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 40px; margin-bottom: 40px; }
.lp-footer__logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; color: #e2e8f0; margin-bottom: 12px; }
.lp-footer__desc { font-size: 14px; line-height: 1.5; }
.lp-footer h4 { color: #e2e8f0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.lp-footer a { display: block; color: #94a3b8; text-decoration: none; font-size: 14px; padding: 3px 0; transition: color 0.2s; }
.lp-footer a:hover { color: #fff; }
.lp-footer__bottom { padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 13px; text-align: center; }

/* ─── Responsive ─── */
@media (max-width: 1024px) {
  .lp-hero__title { font-size: 42px; }
  .lp-systems-grid { grid-template-columns: repeat(2, 1fr); }
  .lp-pricing-grid { grid-template-columns: repeat(2, 1fr); }
  .lp-steps { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .lp-nav__links { display: none; }
  .lp-hero { padding: 120px 0 48px; }
  .lp-hero__title { font-size: 32px; }
  .lp-hero__stats { grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .lp-section { padding: 64px 0; }
  .lp-section__title { font-size: 28px; }
  .lp-demo-frame { margin: 0 -12px; border-radius: 8px; }
  .demo-ymme__grid { grid-template-columns: 1fr 1fr; }
  .lp-pricing-grid { grid-template-columns: 1fr; max-width: 400px; margin: 0 auto; }
  .lp-systems-grid { grid-template-columns: 1fr; }
  .lp-steps { grid-template-columns: 1fr; }
  .lp-footer__grid { grid-template-columns: 1fr 1fr; }
  .lp-trust__inner { gap: 16px; }
  .lp-hero__ctas { flex-direction: column; }
}
@media (max-width: 480px) {
  .lp-hero__title { font-size: 28px; }
  .lp-stat__number { font-size: 28px; }
  .demo-ymme__grid { grid-template-columns: 1fr; }
  .demo-plate__specs { grid-template-columns: 1fr; }
  .lp-footer__grid { grid-template-columns: 1fr; }
}
`;
