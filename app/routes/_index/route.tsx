import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";
import "./landing.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const [makesRes, modelsRes, enginesRes, productsRes, fitmentsRes, collectionsRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("products").select("id", { count: "exact", head: true }),
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }),
    db.from("collection_mappings").select("id", { count: "exact", head: true }),
  ]);
  return {
    showForm: Boolean(login),
    stats: { makes: makesRes.count ?? 0, models: modelsRes.count ?? 0, engines: enginesRes.count ?? 0, products: productsRes.count ?? 0, fitments: fitmentsRes.count ?? 0, collections: collectionsRes.count ?? 0 },
  };
};

// ─── SVG Icons (stroke-based, 18px, consistent) ───
const I = {
  logo: (s=24) => <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>,
  chk: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  x: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  dash: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 8h8" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  arr: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4l4 4-4 4"/></svg>,
  chev: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>,
};

// ─── Hooks ───
function useCounter(end: number, dur=2000) {
  const [v, setV] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ran.current) {
        ran.current = true;
        const t0 = performance.now();
        const tick = (now: number) => { const p = Math.min((now-t0)/dur,1); setV(Math.floor((1-Math.pow(1-p,3))*end)); if(p<1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    obs.observe(el); return () => obs.disconnect();
  }, [end, dur]);
  return { v, ref };
}

function Reveal({ children, className="", delay=0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.08 });
    obs.observe(el); return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={`lp-reveal ${vis?"visible":""} ${className}`} style={{ transitionDelay:`${delay}s` }}>{children}</div>;
}

function Stat({ value, label }: { value: number; label: string }) {
  const c = useCounter(value);
  return <div ref={c.ref} className="lp-stat"><div className="lp-stat-val">{c.v.toLocaleString()}</div><div className="lp-stat-label">{label}</div></div>;
}

// ─── Make logos ───
const MAKES = [
  { name:"BMW", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/bmw.png" },
  { name:"Audi", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/audi.png" },
  { name:"Mercedes-Benz", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/mercedes-benz.png" },
  { name:"Volkswagen", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/volkswagen.png" },
  { name:"Toyota", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/toyota.png" },
  { name:"Ford", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/ford.png" },
  { name:"Porsche", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/porsche.png" },
  { name:"Honda", logo:"https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/honda.png" },
];

// ─── Widget Demos ───
function YMMEDemo() {
  const [make, setMake] = useState("BMW");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = MAKES.filter(m => m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot"/><span className="lp-dot"/><span className="lp-dot"/></div>
      <div className="lp-demo-body">
        <div className="demo-title">Find Parts for Your Vehicle</div>
        <div className="demo-grid">
          <div style={{ position:"relative" }}>
            <div className="demo-label">Make</div>
            <button className="demo-sel" onClick={() => setOpen(!open)}>
              <span style={{ display:"flex", alignItems:"center", gap:6 }}>
                <img src={MAKES.find(m=>m.name===make)?.logo} alt="" width="16" height="16" style={{ objectFit:"contain" }}/>{make}
              </span>{I.chev}
            </button>
            {open && <div className="demo-dd">
              <input placeholder="Search makes..." value={q} onChange={e=>setQ(e.target.value)} autoFocus />
              {filtered.map(m => <div key={m.name} className={`demo-opt ${m.name===make?"active":""}`} onClick={()=>{setMake(m.name);setOpen(false);setQ("")}}><img src={m.logo} alt=""/>{m.name}</div>)}
            </div>}
          </div>
          <div><div className="demo-label">Model</div><div className="demo-sel"><span>3 Series</span>{I.chev}</div></div>
          <div><div className="demo-label">Year</div><div className="demo-sel"><span>2022</span>{I.chev}</div></div>
          <div><div className="demo-label">Engine</div><div className="demo-sel"><span>M340i (382 Hp)</span>{I.chev}</div></div>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:12 }}>
          <button className="lp-btn lp-btn-accent" style={{ flex:1, padding:"10px 16px" }}>Find Parts</button>
          <button className="lp-btn lp-btn-outline" style={{ padding:"10px 12px", position:"relative" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <span style={{ position:"absolute", top:-5, right:-5, background:"var(--accent)", color:"#fff", borderRadius:"50%", width:16, height:16, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>3</span>
          </button>
        </div>
        <div className="demo-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function PlateDemo() {
  const [plate, setPlate] = useState("");
  const [show, setShow] = useState(false);
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot"/><span className="lp-dot"/><span className="lp-dot"/></div>
      <div className="lp-demo-body">
        <div className="demo-title" style={{ textAlign:"center" }}>Find Parts by Registration</div>
        <p style={{ textAlign:"center", fontSize:12, color:"var(--text-tertiary)", marginBottom:12 }}>Enter your UK registration number</p>
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          <div className="demo-plate-wrap" style={{ flex:1 }}>
            <div className="demo-plate-gb">GB</div>
            <input className="demo-plate-input" placeholder="AB12 CDE" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} />
          </div>
          <button className="lp-btn lp-btn-accent" onClick={() => setShow(true)}>Look Up</button>
        </div>
        {show && <div style={{ border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
            <span style={{ background:"#1e3a8a", color:"#fff", padding:"1px 6px", borderRadius:3, fontSize:10, fontWeight:700 }}>GB</span>
            <span style={{ background:"#facc15", color:"#000", padding:"1px 8px", borderRadius:3, fontSize:12, fontWeight:700 }}>{plate||"AL61 EAJ"}</span>
          </div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:2 }}>BMW M340I XDRIVE MHEV AUTO</div>
          <div style={{ fontSize:12, color:"var(--text-tertiary)", marginBottom:10 }}>2022 &middot; ORANGE &middot; HYBRID ELECTRIC</div>
          <div className="demo-specs">
            {[["Year","2022"],["Colour","ORANGE"],["Fuel","HYBRID ELECTRIC"],["Engine","2998cc"],["CO\u2082","176 g/km"],["Type","M1"]].map(([k,v],i)=>
              <div key={i} className="demo-spec"><span>{k}</span><span>{v}</span></div>
            )}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, margin:"10px 0" }}>
            <div><div style={{ fontSize:10, color:"var(--text-quaternary)" }}>MOT</div><span style={{ color:"var(--green)", fontWeight:600, fontSize:13 }}>Valid</span></div>
            <div><div style={{ fontSize:10, color:"var(--text-quaternary)" }}>TAX</div><span style={{ color:"var(--green)", fontWeight:600, fontSize:13 }}>Taxed</span></div>
          </div>
          <button className="lp-btn lp-btn-accent" style={{ width:"100%", padding:"10px 16px" }}>Find Parts for This Vehicle</button>
        </div>}
        <div className="demo-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

function BadgeDemo() {
  const [s, setS] = useState<0|1|2>(0);
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot"/><span className="lp-dot"/><span className="lp-dot"/></div>
      <div className="lp-demo-body" style={{ textAlign:"center" }}>
        <div className="demo-title">Fitment Badge</div>
        <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:14 }}>
          {["Fits","Doesn't Fit","No Vehicle"].map((t,i)=><button key={i} className={`lp-btn ${s===i?"lp-btn-accent":"lp-btn-outline"} lp-btn-sm`} style={{ fontSize:12 }} onClick={()=>setS(i as 0|1|2)}>{t}</button>)}
        </div>
        <div className={`demo-badge ${s===0?"fits":s===1?"nofit":"none"}`}>
          {s===0 && <>{I.chk} Fits your 2022 BMW 3 Series</>}
          {s===1 && <>{I.x} May not fit your 2022 BMW 3 Series</>}
          {s===2 && <>Select a vehicle to check compatibility</>}
        </div>
      </div>
    </>
  );
}

function CompatDemo() {
  return (
    <>
      <div className="lp-chrome"><span className="lp-dot"/><span className="lp-dot"/><span className="lp-dot"/></div>
      <div className="lp-demo-body">
        <div className="demo-title">Vehicle Compatibility</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead><tr>{["Make","Model","Years","Engine"].map(h=><th key={h} style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid var(--border)", color:"var(--text-quaternary)", fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>)}</tr></thead>
            <tbody>{[["BMW","3 Series (F30)","2012\u20132019","320i (184 Hp)"],["BMW","3 Series (G20)","2019\u20132024","320i (184 Hp)"],["BMW","4 Series (F32)","2013\u20132020","420i (184 Hp)"],["Audi","A4 (B9)","2016\u20132024","2.0 TFSI (190 Hp)"],["Mercedes","C-Class (W205)","2014\u20132021","C200 (184 Hp)"]].map((r,i)=>
              <tr key={i}>{r.map((c,j)=><td key={j} style={{ padding:"7px 10px", borderBottom:"1px solid var(--border)", color:"var(--text-secondary)", fontSize:12 }}>{c}</td>)}</tr>
            )}</tbody>
          </table>
        </div>
        <div className="demo-footer">{I.logo(12)} Powered by AutoSync</div>
      </div>
    </>
  );
}

// ─── Data ───
const PLANS = [
  { name:"Free", price:0, products:"50", fitments:"200", providers:"0", features:["Manual mapping","Product browser","Help docs"], pop:false },
  { name:"Starter", price:19, products:"1,000", fitments:"5,000", providers:"1", features:["Push tags & metafields","YMME Search widget","Fitment Badge","Compatibility table"], pop:false },
  { name:"Growth", price:49, products:"10,000", fitments:"50,000", providers:"3", features:["All Starter features","Smart auto-extraction","All 4 storefront widgets","Make collections","Bulk operations","Analytics dashboard"], pop:true },
  { name:"Professional", price:99, products:"50,000", fitments:"250,000", providers:"5", features:["All Growth features","API & FTP data import","Wheel Finder widget","Vehicle Spec Pages","Make+Model collections","Priority support"], pop:false },
  { name:"Business", price:179, products:"200,000", fitments:"1,000,000", providers:"15", features:["All Professional features","Pricing Engine","Year-range collections","My Garage widget","Dedicated support"], pop:false },
  { name:"Enterprise", price:299, products:"Unlimited", fitments:"Unlimited", providers:"Unlimited", features:["All Business features","UK Plate Lookup (DVLA)","VIN Decode","Full CSS customisation","SLA guarantee"], pop:false },
];

const COMPS = [
  { n:"AutoSync", p:"Free\u2013$299", hl:true, db:1, ext:1, col:1, w:"7", pl:1, vin:1, wh:1, api:1, an:1, vp:1 },
  { n:"Convermax", p:"$250\u2013$850", hl:false, db:0, ext:0, col:0, w:"1", pl:0, vin:1, wh:1, api:0, an:0, vp:1 },
  { n:"EasySearch", p:"$19\u2013$75", hl:false, db:1, ext:0, col:0, w:"2", pl:0, vin:0, wh:0, api:0, an:0, vp:0 },
  { n:"PCFitment", p:"$15\u2013$150", hl:false, db:1, ext:0, col:0, w:"1", pl:0, vin:1, wh:0, api:0, an:1, vp:0 },
  { n:"VFitz", p:"$1\u2013$58", hl:false, db:1, ext:0, col:0, w:"1", pl:0, vin:0, wh:0, api:0, an:1, vp:0 },
  { n:"AutoFit AI", p:"$50\u2013$250", hl:false, db:0, ext:1, col:0, w:"2", pl:0, vin:0, wh:0, api:0, an:0, vp:0 },
];

const FAQS = [
  { q:"What is YMME and why does my store need it?", a:"YMME (Year, Make, Model, Engine) is the industry standard for vehicle parts compatibility. It helps customers find parts that fit their specific vehicle, reducing returns by up to 80% and increasing conversions." },
  { q:"Do I need to manually enter all vehicle data?", a:"No. AutoSync includes a pre-loaded database of 331+ makes, 3,131 models, and 24,026 engines. Our smart extraction engine automatically detects vehicle compatibility from your existing product titles and descriptions." },
  { q:"How does the UK plate lookup work?", a:"Enterprise plan includes DVLA integration. Customers enter their UK registration number and instantly see their vehicle details, MOT history, tax status, and compatible parts from your store." },
  { q:"Will the widgets work with my Shopify theme?", a:"Yes. All widgets are Shopify Theme App Extension blocks that work with any Online Store 2.0 theme. Drag and drop in the theme editor, zero code changes required." },
  { q:"How is AutoSync different from Convermax?", a:"Convermax starts at $250/month with complex setup. AutoSync offers more features including plate lookup, VIN decode, smart collections, auto-extraction, and 7 widgets, starting free with self-service setup." },
  { q:"Can I import products from supplier feeds?", a:"Yes. AutoSync supports CSV, XML, JSON, REST API, and FTP imports with smart column mapping that auto-detects fields and remembers your mappings for future imports." },
  { q:"What happens if I exceed plan limits?", a:"You\u2019ll be notified before reaching limits. Upgrade anytime with no data loss. Your data is never deleted \u2014 you just can\u2019t add more until you upgrade." },
  { q:"Is there a free trial?", a:"The Free plan lets you try AutoSync with 50 products at no cost, forever. All paid plans include a 30-day free trial." },
];

const SYSTEMS = [
  { t:"Smart Extraction", d:"Pattern-matching engine with 55 make patterns, model detection, and 3-tier confidence routing. Processes 50 products per batch.", s:"80%+ accuracy" },
  { t:"YMME Database", d:"Pre-loaded vehicle database with every make, model, and engine worldwide. Sourced from auto-data.net.", s:"24K+ engines" },
  { t:"Smart Collections", d:"Auto-creates SEO-optimized Shopify collections with brand logos, meta descriptions, and year-range titles.", s:"3 strategies" },
  { t:"7 Storefront Widgets", d:"YMME Search, Fitment Badge, Compatibility Table, Plate Lookup, VIN Decode, Wheel Finder, Vehicle Specs.", s:"7 widgets" },
  { t:"Provider Import", d:"Import from CSV, XML, JSON, REST API, or FTP. Smart column mapper auto-detects and remembers field mappings.", s:"5 formats" },
  { t:"Vehicle Spec Pages", d:"Auto-generated SEO pages with 90+ engine specs pushed as Shopify metaobjects.", s:"90+ fields" },
  { t:"Shopify Push Engine", d:"Pushes tags, 5 metafield types, and activates Search & Discovery filters automatically via Edge Function.", s:"5 metafields" },
  { t:"Pricing Engine", d:"Markup, margin, fixed, and MAP pricing rules scoped by vendor, product type, provider, tag, or SKU prefix.", s:"4 rule types" },
];

// ═══════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [faq, setFaq] = useState<number|null>(null);
  const [shop, setShop] = useState("");

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <div className="lp">

      {/* ── Nav ── */}
      <nav className={`lp-nav ${scrolled?"scrolled":""}`}>
        <div className="lp-w lp-nav-inner">
          <a href="#" className="lp-logo">{I.logo()} AutoSync</a>
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#systems">Systems</a>
            <a href="#pricing">Pricing</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#login" className="lp-btn lp-btn-accent">Get Started</a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-w" style={{ position:"relative", zIndex:1 }}>
          <Reveal>
            <h1>Vehicle fitment<br/><span className="lp-grad">intelligence</span> for Shopify</h1>
            <p className="lp-hero-sub">Help customers find parts that fit. YMME search, auto-extraction, smart collections, and 7 storefront widgets for automotive e-commerce.</p>
            <div className="lp-hero-ctas">
              <a href="#login" className="lp-btn lp-btn-accent lp-btn-lg">Start Free Trial {I.arr}</a>
              <a href="#features" className="lp-btn lp-btn-ghost lp-btn-lg">See Features</a>
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="lp-stats">
              <Stat value={stats.makes} label="Vehicle Makes" />
              <Stat value={stats.models} label="Models" />
              <Stat value={stats.engines} label="Engines" />
              <Stat value={stats.products} label="Products Managed" />
              <Stat value={stats.fitments} label="Fitment Links" />
              <Stat value={stats.collections} label="Collections" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature 1: YMME Search ── */}
      <section id="features" className="lp-section">
        <div className="lp-w">
          <Reveal>
            <div className="lp-feature-row">
              <div className="lp-feature-text">
                <span className="lp-tag">YMME Search Widget</span>
                <h3>Cascading vehicle search with brand logos</h3>
                <p>Customers select Make, Model, Year, Engine from your active vehicle database. Custom dropdown with searchable brand logos, My Garage for saved vehicles, and localStorage persistence across pages.</p>
                <div className="lp-feature-pills">
                  <span className="lp-pill">Brand Logos</span>
                  <span className="lp-pill">My Garage</span>
                  <span className="lp-pill">localStorage</span>
                  <span className="lp-pill">Collection Redirect</span>
                </div>
              </div>
              <div className="lp-feature-visual"><YMMEDemo /></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature 2: Plate Lookup ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-w">
          <Reveal>
            <div className="lp-feature-row reverse">
              <div className="lp-feature-text">
                <span className="lp-tag">UK Plate Lookup</span>
                <h3>DVLA integration with MOT history</h3>
                <p>Enterprise customers enter their UK registration number to instantly see vehicle details, MOT test history, tax status, and compatible parts. Powered by DVLA VES and DVSA MOT History APIs.</p>
                <div className="lp-feature-pills">
                  <span className="lp-pill">DVLA VES</span>
                  <span className="lp-pill">MOT History</span>
                  <span className="lp-pill">Tax Status</span>
                  <span className="lp-pill">YMME Resolution</span>
                </div>
              </div>
              <div className="lp-feature-visual"><PlateDemo /></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature 3: Compatibility ── */}
      <section className="lp-section">
        <div className="lp-w">
          <Reveal>
            <div className="lp-feature-row">
              <div className="lp-feature-text">
                <span className="lp-tag">Compatibility Table</span>
                <h3>Full vehicle compatibility on every product</h3>
                <p>Product pages show a clear table of all compatible vehicles with Make, Model, Year range, and Engine. Customers know exactly if a part fits before adding to cart.</p>
                <div className="lp-feature-pills">
                  <span className="lp-pill">Year Ranges</span>
                  <span className="lp-pill">Engine Codes</span>
                  <span className="lp-pill">Metafield Powered</span>
                </div>
              </div>
              <div className="lp-feature-visual"><CompatDemo /></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature 4: Fitment Badge ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-w">
          <Reveal>
            <div className="lp-feature-row reverse">
              <div className="lp-feature-text">
                <span className="lp-tag">Fitment Badge</span>
                <h3>Instant compatibility check on every product</h3>
                <p>A visual badge on every product page that shows whether the part fits the customer&apos;s saved vehicle. Green for compatible, red for incompatible, neutral if no vehicle selected.</p>
                <div className="lp-feature-pills">
                  <span className="lp-pill">Fits / Doesn&apos;t Fit</span>
                  <span className="lp-pill">Saved Vehicle</span>
                  <span className="lp-pill">Reduce Returns</span>
                </div>
              </div>
              <div className="lp-feature-visual"><BadgeDemo /></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="lp-section">
        <div className="lp-w">
          <Reveal><div className="lp-section-header center">
            <span className="lp-tag">How It Works</span>
            <div className="lp-h2">From install to sales in 4 steps</div>
          </div></Reveal>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:12 }}>
            {[{ n:"1", t:"Install & Import", d:"Install from the Shopify App Store. Fetch your products or import from CSV, XML, API, or FTP suppliers." },
              { n:"2", t:"Auto-Extract", d:"Smart extraction scans product data and detects vehicle compatibility with 80%+ accuracy. No manual work." },
              { n:"3", t:"Push to Shopify", d:"Push tags, metafields, and smart collections. Search & Discovery filters activate automatically." },
              { n:"4", t:"Sell More Parts", d:"Customers find parts that fit their vehicle. Fewer returns, higher conversions, better SEO." },
            ].map((s,i)=><Reveal key={i} delay={i*0.08}>
              <div style={{ padding:"24px 20px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--bg-elevated)", textAlign:"center" }}>
                <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--accent)", color:"#fff", fontSize:16, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>{s.n}</div>
                <h3 style={{ fontSize:14, fontWeight:600, marginBottom:6, letterSpacing:"-0.01em" }}>{s.t}</h3>
                <p style={{ fontSize:13, color:"var(--text-tertiary)", lineHeight:1.5 }}>{s.d}</p>
              </div>
            </Reveal>)}
          </div>
        </div>
      </section>

      {/* ── Systems ── */}
      <section id="systems" className="lp-section lp-section-alt">
        <div className="lp-w">
          <Reveal><div className="lp-section-header center">
            <span className="lp-tag">Platform</span>
            <div className="lp-h2">Every system, explained</div>
            <p className="lp-sub">AutoSync is a complete platform with 14+ integrated systems working together.</p>
          </div></Reveal>
          <div className="lp-systems">
            {SYSTEMS.map((sys,i) => <Reveal key={i} delay={i*0.04}><div className="lp-sys">
              <h3>{sys.t}</h3>
              <p>{sys.d}</p>
              <span className="lp-sys-stat">{sys.s}</span>
            </div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="lp-section">
        <div className="lp-w">
          <Reveal><div className="lp-section-header center">
            <span className="lp-tag">Pricing</span>
            <div className="lp-h2">Simple, transparent pricing</div>
            <p className="lp-sub">Start free. Scale as you grow. Cancel anytime.</p>
          </div></Reveal>
          <div className="lp-pricing">
            {PLANS.map((p,i) => <Reveal key={i} delay={i*0.04}><div className={`lp-price ${p.pop?"pop":""}`}>
              {p.pop && <div className="lp-price-badge">Most Popular</div>}
              <div className="lp-price-name">{p.name}</div>
              <div style={{ marginBottom:14 }}>
                {p.price===0 ? <span className="lp-price-amt">Free</span> : <><span className="lp-price-amt">${p.price}</span><span className="lp-price-per">/mo</span></>}
              </div>
              <div className="lp-price-limits">
                <div>{p.products} products</div>
                <div>{p.fitments} fitments</div>
                <div>{p.providers} providers</div>
              </div>
              <ul className="lp-price-feat">
                {p.features.map((f,j) => <li key={j}>{I.chk} {f}</li>)}
              </ul>
              <a href="#login" className={`lp-btn ${p.pop?"lp-btn-accent":"lp-btn-outline"}`} style={{ width:"100%" }}>
                {p.price===0?"Get Started":"Start Free Trial"}
              </a>
            </div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ── Compare ── */}
      <section id="compare" className="lp-section lp-section-alt">
        <div className="lp-w">
          <Reveal><div className="lp-section-header center">
            <span className="lp-tag">Comparison</span>
            <div className="lp-h2">AutoSync vs the competition</div>
          </div></Reveal>
          <Reveal delay={0.1}><div className="lp-compare-wrap">
            <table className="lp-tbl">
              <thead><tr>
                <th>Feature</th>
                {COMPS.map((c,i) => <th key={i} className={c.hl?"hl":""}>{c.n}</th>)}
              </tr></thead>
              <tbody>
                <tr><td>Price</td>{COMPS.map((c,i) => <td key={i} className={c.hl?"hl":""}>{c.p}</td>)}</tr>
                {([["YMME Database","db"],["Auto Extraction","ext"],["Smart Collections","col"],["UK Plate Lookup","pl"],["VIN Decode","vin"],["Wheel Finder","wh"],["API/FTP Import","api"],["Analytics","an"],["Vehicle Pages","vp"]] as const).map(([label, key]) =>
                  <tr key={key}><td>{label}</td>{COMPS.map((c,i) => <td key={i} className={c.hl?"hl":""}>{(c as any)[key]===1?I.chk:(c as any)[key]===0?I.x:(c as any)[key]}</td>)}</tr>
                )}
                <tr><td>Widgets</td>{COMPS.map((c,i) => <td key={i} className={c.hl?"hl":""}>{c.w}</td>)}</tr>
              </tbody>
            </table>
          </div></Reveal>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="lp-section">
        <div className="lp-w">
          <Reveal><div className="lp-section-header center">
            <span className="lp-tag">FAQ</span>
            <div className="lp-h2">Frequently asked questions</div>
          </div></Reveal>
          <div className="lp-faq-list">
            {FAQS.map((item,i) => <Reveal key={i} delay={i*0.03}><div className={`lp-faq ${faq===i?"open":""}`}>
              <button className="lp-faq-q" onClick={() => setFaq(faq===i?null:i)}>{item.q}<span className="lp-faq-ico">+</span></button>
              {faq===i && <div className="lp-faq-a">{item.a}</div>}
            </div></Reveal>)}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta-section">
        <div className="lp-w" style={{ position:"relative", zIndex:1 }}>
          <Reveal>
            <div className="lp-h2" style={{ textAlign:"center" }}>Ready to sell more parts?</div>
            <p style={{ fontSize:16, color:"var(--text-secondary)", marginBottom:28, textAlign:"center", maxWidth:440, marginLeft:"auto", marginRight:"auto" }}>Join automotive stores using AutoSync to help customers find parts that fit.</p>
            <div style={{ textAlign:"center" }}><a href="#login" className="lp-btn lp-btn-accent lp-btn-lg">Start Your Free Trial {I.arr}</a></div>
          </Reveal>
        </div>
      </section>

      {/* ── Login ── */}
      <section id="login" className="lp-section" style={{ paddingTop:80, paddingBottom:80 }}>
        <div className="lp-w" style={{ maxWidth:420, textAlign:"center" }}>
          {I.logo(40)}
          <div style={{ fontSize:18, fontWeight:700, margin:"14px 0 6px", letterSpacing:"-0.02em" }}>AutoSync</div>
          <p style={{ fontSize:13, color:"var(--text-tertiary)", marginBottom:20 }}>Enter your Shopify store domain to get started</p>
          {showForm && <Form method="post" action="/auth/login">
            <div style={{ display:"flex", gap:6 }}>
              <input name="shop" className="lp-login-input" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)} />
              <button type="submit" className="lp-btn lp-btn-accent">Install</button>
            </div>
          </Form>}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-w">
          <div className="lp-footer-grid">
            <div>
              <div className="lp-footer-brand">{I.logo(18)} AutoSync</div>
              <p className="lp-footer-desc">Vehicle fitment intelligence for Shopify.</p>
            </div>
            <div><h4>Product</h4><div className="lp-footer-links"><a href="#features">Features</a><a href="#systems">Systems</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a></div></div>
            <div><h4>Support</h4><div className="lp-footer-links"><a href="#faq">FAQ</a><a href="mailto:support@autosync.app">Contact</a></div></div>
            <div><h4>Legal</h4><div className="lp-footer-links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a></div></div>
          </div>
          <div className="lp-footer-bottom">&copy; {new Date().getFullYear()} AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
