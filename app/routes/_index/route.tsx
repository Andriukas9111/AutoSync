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

const Logo = (sz = 24) => <svg width={sz} height={sz} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>;
const Chk = <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#0066ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const X = <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#ff3344" strokeWidth="2" strokeLinecap="round"/></svg>;
const Cv = <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>;

function useCounter(end: number) { const dur = end > 1000 ? 1400 : 1000; const [v, setV] = useState(0); const ref = useRef<HTMLDivElement>(null); const ran = useRef(false); useEffect(() => { const el = ref.current; if (!el) return; const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && !ran.current) { ran.current = true; const t0 = performance.now(); const tick = (now: number) => { const p = Math.min((now - t0) / dur, 1); setV(Math.floor((1 - Math.pow(2, -14 * p)) * end)); if (p < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); } }, { threshold: 0.15 }); obs.observe(el); return () => obs.disconnect(); }, [end, dur]); return { v, ref }; }
function Rv({ children, d = 0 }: { children: React.ReactNode; d?: number }) { const ref = useRef<HTMLDivElement>(null); const [vis, setVis] = useState(false); useEffect(() => { const el = ref.current; if (!el) return; const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.05 }); obs.observe(el); return () => obs.disconnect(); }, []); return <div ref={ref} className={`rv ${vis ? "rv--v" : ""}`} style={{ transitionDelay: `${d}s` }}>{children}</div>; }
function StatItem({ value, label }: { value: number; label: string }) { const c = useCounter(value); return <div ref={c.ref} className="stat-item"><div className="stat-item__n">{c.v.toLocaleString()}+</div><div className="stat-item__l">{label}</div></div>; }

const B = [
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

function Dashboard() {
  const [pg, setPg] = useState(0);
  const pages = ["Dashboard", "Products", "Push", "Collections"];
  const icons = [
    <svg key="0" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
    <svg key="1" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4l6-2 6 2v8l-6 2-6-2z"/><path d="M8 6v8"/></svg>,
    <svg key="2" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 12V4"/><path d="M5 7l3-3 3 3"/><path d="M3 14h10"/></svg>,
    <svg key="3" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="4" width="14" height="10" rx="1.5"/><path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1"/></svg>,
  ];
  return (
    <div className="dash">
      <div className="dash__rail">
        <div className="dash__brand">{Logo(16)} AutoSync</div>
        <div className="dash__nav">{pages.map((p, i) => <div key={p} className={`dash__item ${pg === i ? "dash__item--on" : ""}`} onClick={() => setPg(i)} style={{ cursor: "pointer" }}>{icons[i]} {p}</div>)}</div>
      </div>
      <div className="dash__main">
        {pg === 0 && <><div className="dash__title">Dashboard</div><div className="dash__label">Quick Actions</div><div className="dash__actions"><div className="dash__act"><span className="dash__dot" style={{ background: "#0066ff" }}/> Fetch Products</div><div className="dash__act"><span className="dash__dot" style={{ background: "#d97706" }}/> Auto Extract</div><div className="dash__act"><span className="dash__dot" style={{ background: "#00cc88" }}/> Manual Map</div><div className="dash__act dash__act--blue"><span className="dash__dot" style={{ background: "rgba(255,255,255,.4)" }}/> Push to Shopify</div></div><div className="dash__grid">{[["2,844", "Products"], ["5,827", "Fitments"], ["1,251", "Mapped"], ["44%", "Coverage"]].map(([n, l], i) => <div key={i} className="dash__metric"><b>{n}</b><small>{l}</small></div>)}</div><div className="dash__label">Coverage</div><div className="dash__bar"><span style={{ width: "44%" }}/></div><div className="dash__meta"><span>1,593 Review</span><span>1,251 Mapped</span></div></>}
        {pg === 1 && <><div className="dash__title">Products</div><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Product", "Status", "Fits"].map(h => <th key={h} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--edge)", color: "var(--dim)", fontSize: 10, textTransform: "uppercase" as const, letterSpacing: ".06em", fontWeight: 600 }}>{h}</th>)}</tr></thead><tbody>{[["Eibach Pro-Kit", "mapped", "#00cc88", 12], ["MST Intake", "mapped", "#00cc88", 8], ["Scorpion Exhaust", "unmapped", "#666", 0], ["Bilstein B14", "flagged", "#d97706", 3]].map(([n, s, c, f], i) => <tr key={i}><td style={{ padding: "12px 8px", borderBottom: "1px solid var(--edge)", fontWeight: 500 }}>{n as string}</td><td style={{ padding: "12px 8px", borderBottom: "1px solid var(--edge)" }}><span style={{ fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 999, background: `${c}15`, color: c as string }}>{s as string}</span></td><td style={{ padding: "12px 8px", borderBottom: "1px solid var(--edge)", textAlign: "center", fontWeight: 600 }}>{f as number}</td></tr>)}</tbody></table></>}
        {pg === 2 && <><div className="dash__title">Push to Shopify</div><button style={{ width: "100%", padding: 14, background: "var(--blue)", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 600, border: "none", marginBottom: 14, cursor: "pointer" }}>Push All Mapped</button>{["Tags", "Metafields", "Collections"].map(t => <label key={t} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--soft)", marginBottom: 8, cursor: "pointer", alignItems: "center" }}><input type="checkbox" defaultChecked readOnly style={{ accentColor: "var(--blue)" }}/> {t}</label>)}</>}
        {pg === 3 && <><div className="dash__title">Collections</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{B.slice(0, 4).map((m, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, border: "1px solid var(--edge)", background: "rgba(0,0,0,.2)" }}><img src={m.l} alt="" style={{ width: 28, height: 28, objectFit: "contain", filter: "brightness(0) invert(1)" }}/><div><div style={{ fontSize: 13, fontWeight: 600 }}>{m.n} Parts</div><div style={{ fontSize: 10, color: "var(--dim)" }}>{[423, 312, 189, 156][i]}</div></div></div>)}</div></>}
      </div>
    </div>
  );
}

function YmmeDemo() {
  const [sel, setSel] = useState(0);
  return <><div className="chm"><span/><span/><span/></div><div className="dm"><div className="dm__t">Select Your Vehicle</div><div className="dm__s">Choose a make to find compatible parts</div><div className="brands">{B.map((b, i) => <div key={i} className={`brand ${sel === i ? "brand--on" : ""}`} onClick={() => setSel(i)}><img src={b.l} alt="" style={{ filter: "brightness(0) invert(1)" }}/><span>{b.n}</span></div>)}</div><div className="cascade"><div className="cascade__s cascade__s--on"><span>{B[sel].n}</span> {Cv}</div><div className="cascade__s cascade__s--on"><span>3 Series</span> {Cv}</div><div className="cascade__s cascade__s--on"><span>2022</span> {Cv}</div><div className="cascade__s"><span style={{ color: "var(--dim)" }}>Engine...</span> {Cv}</div></div><button className="find-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Find Compatible Parts</button><div className="dm__foot">{Logo(12)} Powered by AutoSync</div></div></>;
}

function PlateDemo() {
  return <><div className="chm"><span/><span/><span/></div><div className="dm" style={{ textAlign: "center" }}><div className="dm__t">UK Plate Lookup</div><div className="dm__s">Instant vehicle identification</div><div className="plate-bar"><div className="plate-bar__flag"><svg width="22" height="14" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3"/><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10"/><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6"/></svg></div><div className="plate-bar__reg">AL61 EAJ</div></div><div className="plate-result"><h4>BMW M340I XDRIVE MHEV AUTO</h4><p>2022 &middot; ORANGE &middot; HYBRID ELECTRIC &middot; 2998cc</p><div className="plate-statuses"><div className="plate-status"><label>MOT</label><span><span className="dot" style={{ background: "#00cc88" }}/> Valid</span></div><div className="plate-status"><label>TAX</label><span><span className="dot" style={{ background: "#00cc88" }}/> Taxed</span></div></div></div><div className="dm__foot">{Logo(12)} Powered by AutoSync</div></div></>;
}

function VinDemo() {
  return <><div className="chm"><span/><span/><span/></div><div className="dm" style={{ textAlign: "center" }}><div className="dm__t">VIN Decode</div><div className="dm__s">17-character VIN decoded worldwide</div><div className="vin-row"><span className="vin-tag">VIN</span><div className="vin-field"><input value="WBAPH5C55BA123456" readOnly/><em>17/17</em></div><button className="find-btn" style={{ width: "auto", padding: "0 20px", height: 44 }}>Decode</button></div><div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>2011 BMW 5 Series 528i</div><div className="vin-grid">{[["Year", "2011"], ["Make", "BMW"], ["Model", "5 Series"], ["Body", "Sedan"], ["Drive", "RWD"], ["Engine", "3.0L I6"], ["Fuel", "Gasoline"], ["Trans", "Auto"], ["Origin", "Germany"], ["Trim", "528i"]].map(([k, v], i) => <div key={i} className="vin-cell"><small>{k}</small><strong>{v}</strong></div>)}</div><div className="dm__foot">{Logo(12)} Powered by AutoSync</div></div></>;
}

function BadgeDemo() {
  return <><div className="chm"><span/><span/><span/></div><div className="dm" style={{ textAlign: "center" }}><div className="dm__t">Fitment Badge</div><div className="dm__s">Every product page, automatically</div><div className="fit-strip fit-strip--yes"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#00cc88" strokeWidth="2.5" strokeLinecap="round"/></svg> Fits your 2022 BMW 3 Series</div><div className="fit-strip fit-strip--no"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#ff3344" strokeWidth="2" strokeLinecap="round"/></svg> May not fit your vehicle</div><div className="v-cards">{[{ m: "BMW", n: "3 Series", e: "M340i · 382HP" }, { m: "Audi", n: "A4", e: "2.0T · 261HP" }].map((v, i) => <div key={i} className="v-card"><div className="v-card__make"><img src={B[i].l} alt=""/>{v.m}</div><h4>{v.n}</h4><div className="v-card__tags"><span className="v-card__tag v-card__tag--blue">{v.e}</span><span className="v-card__tag">Petrol</span></div></div>)}</div><div className="dm__foot">{Logo(12)} Powered by AutoSync</div></div></>;
}

const STEPS = [{ n: "01", t: "Install & Import", d: "Install from Shopify. Fetch products or import from suppliers." }, { n: "02", t: "Auto-Extract", d: "Smart extraction detects compatibility with 80%+ accuracy." }, { n: "03", t: "Push to Shopify", d: "Tags, metafields, collections. Filters auto-activate." }, { n: "04", t: "Sell More Parts", d: "Customers find exact-fit parts instantly." }];
const PLANS = [{ name: "Free", price: 0, products: "50", fitments: "200", features: ["Manual mapping", "YMME access", "Basic support"], pop: false }, { name: "Starter", price: 19, products: "1K", fitments: "5K", features: ["Push tags", "YMME Search", "Fitment Badge"], pop: false }, { name: "Growth", price: 49, products: "10K", fitments: "50K", features: ["All 7 widgets", "Smart extraction", "Collections"], pop: true }, { name: "Professional", price: 99, products: "50K", fitments: "250K", features: ["API/FTP import", "Wheel Finder", "Spec Pages"], pop: false }, { name: "Business", price: 179, products: "200K", fitments: "1M", features: ["Pricing Engine", "My Garage", "Dedicated"], pop: false }, { name: "Enterprise", price: 299, products: "∞", fitments: "∞", features: ["Plate Lookup", "VIN Decode", "SLA"], pop: false }];
const COMPS = [{ n: "AutoSync", p: "Free–$299", hl: true, db: 1, ext: 1, col: 1, w: "7", pl: 1, vin: 1, wh: 1 }, { n: "Convermax", p: "$250–$850", hl: false, db: 0, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 1 }, { n: "EasySearch", p: "$19–$75", hl: false, db: 1, ext: 0, col: 0, w: "2", pl: 0, vin: 0, wh: 0 }, { n: "PCFitment", p: "$15–$150", hl: false, db: 1, ext: 0, col: 0, w: "1", pl: 0, vin: 1, wh: 0 }];
const FAQS = [{ q: "What is YMME?", a: "Year, Make, Model, Engine — the industry standard for vehicle parts. Reduces returns by 80%." }, { q: "Do I need to enter vehicle data manually?", a: "No. 374+ makes, 3,686 models, 29,515 engines pre-loaded. Smart extraction auto-detects from titles." }, { q: "Will it work with my theme?", a: "Yes. All 7 widgets are OS 2.0 Theme App Extensions. Drag and drop." }, { q: "How does it compare to Convermax?", a: "Convermax starts at $250/mo. AutoSync has more features starting free." }, { q: "Can I import supplier data?", a: "CSV, XML, JSON, REST API, FTP — with smart column mapping." }, { q: "Free trial?", a: "Free plan forever (50 products). Paid plans include 14-day trial." }];
const REVIEWS = [{ q: "Customers find exact-fit parts in seconds. Returns dropped 40%.", n: "James Mitchell", r: "Mitchell Performance" }, { q: "YMME widget alone was worth switching. Incredible quality.", n: "Sarah Thompson", r: "UK Auto Spares" }, { q: "Saved $600/month from Convermax. Plate lookup is amazing.", n: "David Chen", r: "DriveSpec Ltd" }];

export default function Page() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [btt, setBtt] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const stepsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const fn = () => { setScrolled(window.scrollY > 30); setBtt(window.scrollY > 700); }; window.addEventListener("scroll", fn); return () => window.removeEventListener("scroll", fn); }, []);
  useEffect(() => { if (typeof window === "undefined") return; document.querySelectorAll(".hero__word").forEach((w, i) => { setTimeout(() => w.classList.add("hero__word--v"), 500 + i * 150); }); }, []);
  useEffect(() => { if (typeof window === "undefined") return; let ctx: any; (async () => { try { const { gsap } = await import("gsap"); const { ScrollTrigger } = await import("gsap/ScrollTrigger"); gsap.registerPlugin(ScrollTrigger); ctx = gsap.context(() => { if (stepsRef.current) gsap.to(stepsRef.current, { width: "100%", ease: "none", scrollTrigger: { trigger: stepsRef.current.parentElement, start: "top 70%", end: "bottom 50%", scrub: true } }); const pc = document.querySelector(".product-card"); if (pc) gsap.fromTo(pc, { scale: 0.88, rotateX: 6 }, { scale: 1, rotateX: 0, ease: "none", scrollTrigger: { trigger: pc, start: "top 95%", end: "top 15%", scrub: true } }); }); } catch (_) {} })(); return () => { if (ctx) ctx.revert(); }; }, []);

  return (
    <div>
      <nav className={`nav ${scrolled ? "nav--s" : ""}`}><div className="mx"><a href="#" className="nav__logo">{Logo(28)} AutoSync</a><div className="nav__links"><a href="#features">Features</a><a href="#how">How It Works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div><a href="#login" className="nav__cta">Start Free</a></div></nav>

      <section className="hero">
        <div className="hero__badge"><span className="hero__badge-dot"/> Vehicle Fitment Intelligence</div>
        <h1 className="hero__h1">
          {["Vehicle", "fitment"].map((w, i) => <span key={i} className="hero__word">{w} </span>)}
          <span className="hero__word accent">intelligence </span>
          {["for", "Shopify"].map((w, i) => <span key={i + 3} className="hero__word">{w} </span>)}
        </h1>
        <p className="hero__p">Map vehicle fitments to products. Create smart collections. Add Search & Discovery filters. Help customers find exact-fit parts.</p>
        <div className="hero__btns">
          <a href="#login" className="hero__btn-primary">Start Free Trial <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
          <a href="#features" className="hero__btn-ghost">See How It Works</a>
        </div>
        <div className="stats-row">
          <StatItem value={stats.makes} label="Vehicle Makes"/>
          <StatItem value={stats.models} label="Models"/>
          <StatItem value={stats.engines} label="Engines"/>
          <StatItem value={stats.specs} label="Specs"/>
        </div>
      </section>

      <div className="product-wrap"><div className="product-card"><Dashboard/></div></div>

      <section className="trust"><div className="mx"><p>Trusted by parts retailers worldwide</p></div><div style={{ overflow: "hidden" }}><div className="trust__track">{[...B, ...B].map((m, i) => <img key={i} src={m.l} alt={m.n} loading="lazy"/>)}</div></div></section>

      <section id="features" className="sec"><div className="mx">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">Widgets</div><div className="sec__h2">7 storefront widgets</div><p className="sec__sub sec__sub--center">Native Shopify blocks. Drag and drop.</p></div></Rv>
        <Rv><div className="feat"><div className="feat__text"><div className="sec__tag">YMME Search</div><h3>Find parts by vehicle</h3><p>Brand logo grid, cascading selection, My Garage for saved vehicles, instant Search & Discovery results.</p><ul><li>{Chk} 374+ makes with logos</li><li>{Chk} My Garage saves vehicles</li><li>{Chk} S&D integration</li></ul></div><div className="feat__visual"><YmmeDemo/></div></div></Rv>
        <Rv><div className="feat feat--flip"><div className="feat__text"><div className="sec__tag">Plate Lookup</div><h3>UK registration lookup</h3><p>DVLA API. MOT history, tax status, instant vehicle ID from any UK plate.</p><ul><li>{Chk} Real-time DVLA</li><li>{Chk} MOT & tax status</li><li>{Chk} Instant results</li></ul></div><div className="feat__visual"><PlateDemo/></div></div></Rv>
        <Rv><div className="feat"><div className="feat__text"><div className="sec__tag">VIN Decode</div><h3>Decode any vehicle</h3><p>17-character VIN decoder. 60+ manufacturers. Full spec waterfall.</p><ul><li>{Chk} 60+ manufacturers</li><li>{Chk} Full specs</li><li>{Chk} One-click parts</li></ul></div><div className="feat__visual"><VinDemo/></div></div></Rv>
        <Rv><div className="feat feat--flip"><div className="feat__text"><div className="sec__tag">Badge & Specs</div><h3>Compatibility everywhere</h3><p>Fitment badges on every product. SEO vehicle spec galleries with 90+ fields.</p><ul><li>{Chk} Fits / doesn't fit badge</li><li>{Chk} 90+ spec fields</li><li>{Chk} Auto SEO pages</li></ul></div><div className="feat__visual"><BadgeDemo/></div></div></Rv>
      </div></section>

      <section id="how" className="sec"><div className="mx"><Rv><div className="sec__header sec__header--c"><div className="sec__tag">Process</div><div className="sec__h2">Install to sales in 4 steps</div></div></Rv><div className="steps"><div className="steps__line"><div ref={stepsRef} className="steps__fill"/></div>{STEPS.map((s, i) => <Rv key={i} d={i * .12}><div className="step"><div className="step__n">{s.n}</div><h3>{s.t}</h3><p>{s.d}</p></div></Rv>)}</div></div></section>

      <section id="pricing" className="sec"><div className="mx"><Rv><div className="sec__header sec__header--c"><div className="sec__tag">Pricing</div><div className="sec__h2">Simple pricing</div><p className="sec__sub sec__sub--center">Free forever. Scale when ready.</p></div></Rv><div className="pricing">{PLANS.map((p, i) => <Rv key={p.name} d={i * .06}><div className={`price-card ${p.pop ? "price-card--pop" : ""}`}>{p.pop && <div className="price-card__badge">Popular</div>}<div className="price-card__name">{p.name}</div><div style={{ marginBottom: 16 }}>{p.price === 0 ? <span className="price-card__amt">Free</span> : <><span className="price-card__amt">${p.price}</span><span className="price-card__per">/mo</span></>}</div><div className="price-card__lim"><div><strong>{p.products}</strong> products</div><div><strong>{p.fitments}</strong> fitments</div></div><ul className="price-card__feat">{p.features.map((f, j) => <li key={j}>{Chk} {f}</li>)}</ul><a href="#login" className={`price-card__btn ${p.pop ? "price-card__btn--fill" : "price-card__btn--ghost"}`}>{p.price === 0 ? "Start Free" : "Try Free"}</a></div></Rv>)}</div></div></section>

      <section className="sec"><div className="mx"><Rv><div className="sec__header sec__header--c"><div className="sec__tag">Compare</div><div className="sec__h2">Why AutoSync</div></div></Rv><Rv d={.1}><div className="cmp"><table className="tbl"><thead><tr><th>Feature</th>{COMPS.map((c, i) => <th key={i} className={c.hl ? "hl" : ""}>{c.hl ? <strong>{c.n}</strong> : c.n}</th>)}</tr></thead><tbody><tr><td>Price</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.p}</td>)}</tr>{(["db", "ext", "col", "pl", "vin", "wh"] as const).map(k => <tr key={k}><td>{{ db: "YMME DB", ext: "Extract", col: "Collections", pl: "Plate", vin: "VIN", wh: "Wheels" }[k]}</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{(c as any)[k] === 1 ? Chk : (c as any)[k] === 0 ? X : (c as any)[k]}</td>)}</tr>)}<tr><td>Widgets</td>{COMPS.map((c, i) => <td key={i} className={c.hl ? "hl" : ""}>{c.w}</td>)}</tr></tbody></table></div></Rv></div></section>

      <section className="sec"><div className="mx"><Rv><div className="sec__header sec__header--c"><div className="sec__tag">Reviews</div><div className="sec__h2">What retailers say</div></div></Rv><div className="reviews">{REVIEWS.map((t, i) => <Rv key={i} d={i * .1}><div className="review"><div className="review__stars">★★★★★</div><div className="review__q">"{t.q}"</div><div className="review__n">{t.n}</div><div className="review__r">{t.r}</div></div></Rv>)}</div></div></section>

      <section id="faq" className="sec"><div className="mx"><Rv><div className="sec__header sec__header--c"><div className="sec__tag">FAQ</div><div className="sec__h2">Questions</div></div></Rv><div className="faqs">{FAQS.map((item, i) => <Rv key={i} d={i * .04}><div className={`faq ${faq === i ? "faq--open" : ""}`}><button className="faq__q" onClick={() => setFaq(faq === i ? null : i)}>{item.q}<span className="faq__ico">+</span></button>{faq === i && <div className="faq__a">{item.a}</div>}</div></Rv>)}</div></div></section>

      <section className="cta-block"><div className="mx" style={{ position: "relative", zIndex: 1, textAlign: "center" }}><Rv><div className="sec__h2" style={{ color: "#fff" }}>Ready to sell more parts?</div><p style={{ fontSize: 18, color: "rgba(255,255,255,.6)", margin: "20px auto 40px", maxWidth: 440 }}>Join stores using AutoSync for exact-fit parts discovery.</p><a href="#login" className="hero__btn-primary" style={{ background: "#fff", color: "#000" }}>Start Free Trial <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a></Rv></div></section>

      <section id="login" className="sec" style={{ paddingTop: 80, paddingBottom: 80 }}><div className="mx" style={{ maxWidth: 440, textAlign: "center" }}>{Logo(48)}<div style={{ fontSize: 22, fontWeight: 800, margin: "16px 0 6px", letterSpacing: "-.02em" }}>AutoSync</div><p style={{ fontSize: 14, color: "var(--dim)", marginBottom: 28 }}>Enter your Shopify domain</p>{showForm && <Form method="post" action="/auth/login"><div style={{ display: "flex", gap: 8 }}><input name="shop" className="login-field" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)}/><button type="submit" className="find-btn" style={{ width: "auto", padding: "0 24px", height: 48 }}>Install</button></div></Form>}</div></section>

      {btt && <button className="btt" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}

      <footer className="foot"><div className="mx"><div className="foot__g"><div><div className="foot__brand">{Logo(20)} AutoSync</div><p className="foot__desc">Vehicle fitment intelligence for Shopify.</p></div><div><h4>Product</h4><div className="foot__links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div></div><div><h4>Company</h4><div className="foot__links"><a href="#">About</a><a href="#">Blog</a></div></div><div><h4>Legal</h4><div className="foot__links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a></div></div></div><div className="foot__b">© {new Date().getFullYear()} AutoSync</div></div></footer>
    </div>
  );
}
