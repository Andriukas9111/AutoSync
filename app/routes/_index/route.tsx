import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";
import { CAR_BRANDS, PRICING_TIERS, COMPETITORS, COMPARE_FEATURES, FAQ_ITEMS, TESTIMONIALS, SYSTEMS, PIPELINE_STEPS, DB_STATS, BRAND } from "./data/website-content";
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

/* Icons */
const Logo = (sz = 24) => <svg width={sz} height={sz} viewBox="0 0 1200 1200" fill="none"><path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/><path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/></svg>;
const Chk = <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#0099FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const X = <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/></svg>;
const Cv = <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>;

/* Hooks */
function useCounter(end: number) { const dur = end > 1000 ? 1400 : 1000; const [v, setV] = useState(0); const ref = useRef<HTMLDivElement>(null); const ran = useRef(false); useEffect(() => { const el = ref.current; if (!el) return; const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && !ran.current) { ran.current = true; const t0 = performance.now(); const tick = (now: number) => { const p = Math.min((now - t0) / dur, 1); setV(Math.floor((1 - Math.pow(2, -14 * p)) * end)); if (p < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); } }, { threshold: 0.15 }); obs.observe(el); return () => obs.disconnect(); }, [end, dur]); return { v, ref }; }
function Rv({ children, d = 0 }: { children: React.ReactNode; d?: number }) { const ref = useRef<HTMLDivElement>(null); const [vis, setVis] = useState(false); useEffect(() => { const el = ref.current; if (!el) return; const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.05 }); obs.observe(el); return () => obs.disconnect(); }, []); return <div ref={ref} className={`rv ${vis ? "rv--v" : ""}`} style={{ transitionDelay: `${d}s` }}>{children}</div>; }
function StatCounter({ value, label }: { value: number; label: string }) { const c = useCounter(value); return <div ref={c.ref} className="stats-dark__item"><div className="stats-dark__val">{c.v.toLocaleString()}+</div><div className="stats-dark__label">{label}</div></div>; }
function HeroStat({ value, label }: { value: number; label: string }) { const c = useCounter(value); return <div ref={c.ref} className="hero__stat-item"><div className="hero__stat-val">{c.v.toLocaleString()}+</div><div className="hero__stat-label">{label}</div></div>; }

/* ═══ TABBED SHOWCASE DEMOS ═══ */

function YmmeDemo() {
  const [sel, setSel] = useState(0);
  return <div>
    <div className="demo__title">Select Your Vehicle</div>
    <div className="demo__sub">Choose a make to find compatible parts</div>
    <div className="brands-grid">
      {CAR_BRANDS.slice(0, 10).map((b, i) => <div key={i} className={`brand-tile ${sel === i ? "brand-tile--on" : ""}`} onClick={() => setSel(i)}><img src={b.logo} alt={b.name}/><span>{b.name}</span></div>)}
    </div>
    <div className="cascade">
      <div className="cascade__step cascade__step--on"><span>{CAR_BRANDS[sel].name}</span> {Cv}</div>
      <div className="cascade__step cascade__step--on"><span>3 Series</span> {Cv}</div>
      <div className="cascade__step cascade__step--on"><span>2022</span> {Cv}</div>
      <div className="cascade__step"><span style={{ color: "var(--gray)" }}>Engine...</span> {Cv}</div>
    </div>
    <button className="search-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Find Compatible Parts</button>
    <div className="demo__footer">{Logo(12)} Powered by AutoSync</div>
  </div>;
}

function PlateDemo() {
  return <div style={{ textAlign: "center" }}>
    <div className="demo__title">UK Plate Lookup</div>
    <div className="demo__sub">Instant vehicle identification from registration</div>
    <div className="plate-bar">
      <div className="plate-bar__flag"><svg width="24" height="16" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="6"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3"/><path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="10"/><path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="6"/></svg></div>
      <div className="plate-bar__text">AL61 EAJ</div>
    </div>
    <div className="plate-result">
      <h4>BMW M340I XDRIVE MHEV AUTO</h4>
      <p>2022 · ORANGE · HYBRID ELECTRIC · 2998cc</p>
      <div className="plate-statuses">
        <div className="plate-status"><div className="plate-status__label">MOT Status</div><div className="plate-status__value"><span className="plate-status__dot" style={{ background: "#10B981" }}/> Valid until Nov 2026</div></div>
        <div className="plate-status"><div className="plate-status__label">Tax Status</div><div className="plate-status__value"><span className="plate-status__dot" style={{ background: "#10B981" }}/> Taxed until Nov 2026</div></div>
      </div>
    </div>
    <div className="demo__footer">{Logo(12)} Powered by AutoSync</div>
  </div>;
}

function VinDemo() {
  return <div style={{ textAlign: "center" }}>
    <div className="demo__title">VIN Decode</div>
    <div className="demo__sub">17-character VIN decoded worldwide</div>
    <div className="vin-row">
      <span className="vin-badge">VIN</span>
      <div className="vin-field"><input value="WBAPH5C55BA123456" readOnly/><span className="vin-field__counter">17/17</span></div>
      <button className="btn btn--blue btn--sm">Decode</button>
    </div>
    <div style={{ fontFamily: "var(--heading)", fontSize: 18, fontWeight: 700, marginBottom: 10 }}>2011 BMW 5 Series 528i</div>
    <div className="vin-grid">
      {[["Year","2011"],["Make","BMW"],["Model","5 Series"],["Body","Sedan"],["Drive","RWD"],["Engine","3.0L I6"],["Fuel","Gasoline"],["Trans","Auto"],["Origin","Germany"],["Trim","528i"]].map(([k,v],i)=><div key={i} className="vin-cell"><div className="vin-cell__key">{k}</div><div className="vin-cell__val">{v}</div></div>)}
    </div>
    <div className="demo__footer">{Logo(12)} Powered by AutoSync</div>
  </div>;
}

function WheelDemo() {
  return <div>
    <div className="demo__title">Wheel Finder</div>
    <div className="demo__sub">Search by bolt pattern, diameter, width, offset</div>
    <div className="wheel-grid">
      <div className="wheel-field"><div className="wheel-field__label">PCD (Bolt Pattern)</div><div className="wheel-field__value">5×120 <span className="wheel-field__unit">mm</span></div></div>
      <div className="wheel-field"><div className="wheel-field__label">Diameter</div><div className="wheel-field__value">19 <span className="wheel-field__unit">inch</span></div></div>
      <div className="wheel-field"><div className="wheel-field__label">Width</div><div className="wheel-field__value">8.5 <span className="wheel-field__unit">J</span></div></div>
      <div className="wheel-field"><div className="wheel-field__label">Offset</div><div className="wheel-field__value">ET35 <span className="wheel-field__unit">mm</span></div></div>
    </div>
    <button className="search-btn">Find Matching Wheels</button>
    <div className="demo__footer">{Logo(12)} Powered by AutoSync</div>
  </div>;
}

function BadgeDemo() {
  return <div style={{ textAlign: "center" }}>
    <div className="demo__title">Fitment Badge</div>
    <div className="demo__sub">Real-time compatibility on every product page</div>
    <div className="fit-badge fit-badge--yes"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round"/></svg> Fits your 2022 BMW 3 Series</div>
    <div className="fit-badge fit-badge--no"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/></svg> May not fit your vehicle</div>
    <div className="vehicle-cards">
      {[{m:"BMW",n:"3 Series",e:"M340i · 382 HP"},{m:"Audi",n:"A4",e:"2.0 TFSI · 261 HP"}].map((v,i)=><div key={i} className="vehicle-card"><div className="vehicle-card__make"><img src={CAR_BRANDS[i].logo} alt=""/>{v.m}</div><h4>{v.n}</h4><div className="vehicle-card__tags"><span className="vehicle-card__tag vehicle-card__tag--accent">{v.e}</span><span className="vehicle-card__tag">Petrol</span></div></div>)}
    </div>
    <div className="demo__footer">{Logo(12)} Powered by AutoSync</div>
  </div>;
}

const SHOWCASE_TABS = [
  { id: "ymme", label: "YMME Search", Demo: YmmeDemo },
  { id: "plate", label: "Plate Lookup", Demo: PlateDemo },
  { id: "vin", label: "VIN Decode", Demo: VinDemo },
  { id: "wheel", label: "Wheel Finder", Demo: WheelDemo },
  { id: "badge", label: "Fitment Badge", Demo: BadgeDemo },
];

/* ═══ PAGE ═══ */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [btt, setBtt] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const [shop, setShop] = useState("");
  const [activeTab, setActiveTab] = useState("ymme");
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const fn = () => { setScrolled(window.scrollY > 30); setBtt(window.scrollY > 700); }; window.addEventListener("scroll", fn); return () => window.removeEventListener("scroll", fn); }, []);

  // Timeline step reveal
  useEffect(() => {
    if (typeof window === "undefined" || !timelineRef.current) return;
    const steps = timelineRef.current.querySelectorAll(".timeline__step");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("timeline__step--visible"); obs.unobserve(e.target); } });
    }, { threshold: 0.2 });
    steps.forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  const ActiveDemo = SHOWCASE_TABS.find(t => t.id === activeTab)?.Demo || YmmeDemo;

  return <div>
    {/* 1. NAV */}
    <nav className={`nav ${scrolled ? "nav--s" : ""}`}><div className="wrap"><a href="#" className="nav__logo">{Logo(28)} AutoSync</a><div className="nav__links"><a href="#features">Features</a><a href="#how-it-works">How It Works</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></div><a href="#get-started" className="nav__cta">Start Free Trial</a></div></nav>

    {/* 2. HERO — SPLIT LAYOUT */}
    <section className="hero">
      <div className="wrap">
        <div className="hero__split">
          <div className="hero__left">
            <span className="pill"><span className="pill__dot"/> Vehicle Fitment Intelligence</span>
            <h1 className="hero__title">Vehicle fitment <span className="accent">intelligence</span> for Shopify</h1>
            <p className="hero__subtitle">{BRAND.description}</p>
            <div className="hero__ctas">
              <a href="#get-started" className="btn btn--primary">Start Free Trial</a>
              <a href="#features" className="btn btn--ghost">See How It Works</a>
            </div>
            <div className="hero__stats">
              <HeroStat value={stats.makes} label="Makes"/>
              <HeroStat value={stats.models} label="Models"/>
              <HeroStat value={stats.engines} label="Engines"/>
            </div>
          </div>
          <div className="hero__right">
            <div className="hero__product">
              <div className="mini-dash">
                <div className="mini-dash__header"><div className="mini-dash__title">{Logo(14)} Dashboard</div><span style={{ fontSize: 11, color: "var(--gray)" }}>Live</span></div>
                <div className="mini-dash__cards">
                  {[["2,844","Products"],["5,827","Fitments"],["44%","Coverage"]].map(([n,l],i)=><div key={i} className="mini-dash__card"><b>{n}</b><small>{l}</small></div>)}
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--gray)", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 6 }}>Fitment Coverage</div>
                <div className="mini-dash__bar"><div className="mini-dash__fill" style={{ width: "44%" }}/></div>
                <div className="mini-dash__meta"><span>1,593 Review</span><span>1,251 Mapped</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* 3. TRUST */}
    <section className="trust"><div className="wrap"><p className="trust__label">Trusted by parts retailers using these vehicle brands</p></div><div style={{ overflow: "hidden" }}><div className="trust__track">{[...CAR_BRANDS,...CAR_BRANDS].map((m,i)=><img key={i} src={m.logo} alt={m.name} loading="lazy"/>)}</div></div></section>

    {/* 4. TABBED SHOWCASE */}
    <section id="features" className="sec">
      <div className="wrap">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">Storefront Widgets</div><div className="sec__h2">7 widgets your store needs</div><p className="sec__p">Native Shopify blocks. Drag and drop into any OS 2.0 theme.</p></div></Rv>
        <div className="showcase">
          <div className="showcase__tabs">
            {SHOWCASE_TABS.map(t => <button key={t.id} className={`showcase__tab ${activeTab === t.id ? "showcase__tab--active" : ""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
          </div>
          <div className="showcase__frame">
            <div className="chrome"><span/><span/><span/></div>
            <div className="showcase__body" key={activeTab}><ActiveDemo/></div>
          </div>
        </div>
      </div>
    </section>

    {/* 5. HORIZONTAL SCROLL SYSTEMS */}
    <section className="sec sec--alt">
      <div className="wrap">
        <Rv><div className="sec__header"><div className="sec__tag">Platform</div><div className="sec__h2">8 integrated systems</div><p className="sec__p">A complete platform where every system works together.</p></div></Rv>
      </div>
      <div style={{ paddingLeft: "var(--gutter)", paddingRight: 0 }}>
        <div className="systems-scroll">
          {SYSTEMS.map((sys, i) => <Rv key={i} d={i * 0.08}><div className="system-card"><h3>{sys.name}</h3><p>{sys.highlights[0]}</p><span className="system-card__badge">{sys.stats[Object.keys(sys.stats)[0] as keyof typeof sys.stats]}</span></div></Rv>)}
        </div>
      </div>
    </section>

    {/* 6. VERTICAL TIMELINE */}
    <section id="how-it-works" className="sec">
      <div className="wrap">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">How It Works</div><div className="sec__h2">From install to sales in 4 steps</div></div></Rv>
        <div className="timeline" ref={timelineRef}>
          {PIPELINE_STEPS.map((s, i) => <div key={i} className="timeline__step"><div className="timeline__num">{s.number}</div><h3>{s.title}</h3><p>{s.description}</p></div>)}
        </div>
      </div>
    </section>

    {/* 7. DARK STATS */}
    <section className="stats-dark">
      <div className="wrap">
        <div className="stats-dark__row">
          <StatCounter value={stats.makes} label="Vehicle Makes"/>
          <StatCounter value={stats.models} label="Models"/>
          <StatCounter value={stats.engines} label="Engines"/>
          <StatCounter value={stats.specs} label="Vehicle Specs"/>
        </div>
      </div>
    </section>

    {/* 8. PRICING */}
    <section id="pricing" className="sec sec--alt">
      <div className="wrap">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">Pricing</div><div className="sec__h2">Simple, transparent pricing</div><p className="sec__p">Start free. Scale as you grow. 14-day trial on all paid plans.</p></div></Rv>
        <div className="pricing">
          {PRICING_TIERS.slice(0, 3).map((p, i) => <Rv key={p.name} d={i * 0.07}><div className={`price-card ${p.popular ? "price-card--pop" : ""}`}>
            {p.popular && <div className="price-card__badge">Most Popular</div>}
            <div className="price-card__name">{p.name}</div>
            <div style={{ marginBottom: 18 }}>{p.price === 0 ? <span className="price-card__price">Free</span> : <><span className="price-card__price">${p.price}</span><span className="price-card__per">/mo</span></>}</div>
            <div className="price-card__limits"><div><strong>{typeof p.limits.products === "number" ? p.limits.products.toLocaleString() : p.limits.products}</strong> products</div><div><strong>{typeof p.limits.fitments === "number" ? p.limits.fitments.toLocaleString() : p.limits.fitments}</strong> fitments</div></div>
            <ul className="price-card__feat">{p.features.map((f,j)=><li key={j}>{Chk}{f}</li>)}</ul>
            <a href="#get-started" className={`btn ${p.popular ? "btn--blue" : "btn--ghost"} btn--sm`} style={{ width: "100%", justifyContent: "center" }}>{p.cta}</a>
          </div></Rv>)}
        </div>
        <div style={{ textAlign: "center", marginTop: 32 }}><a href="#pricing" className="btn btn--ghost btn--sm">View all 6 plans</a></div>
      </div>
    </section>

    {/* 9. SIDE-BY-SIDE COMPARISON */}
    <section id="compare" className="sec">
      <div className="wrap">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">Comparison</div><div className="sec__h2">Why stores choose AutoSync</div></div></Rv>
        <Rv>
          <div className="compare">
            <div className="compare__us">
              <div className="compare__title">{Logo(20)} AutoSync</div>
              <div className="compare__list">
                {COMPARE_FEATURES.map(f => <div key={f.key} className="compare__item">{Chk} {f.label}</div>)}
                <div className="compare__item">{Chk} <strong>7</strong> storefront widgets</div>
                <div className="compare__item">{Chk} Self-service setup in minutes</div>
              </div>
              <div className="compare__price">Starting <strong>Free</strong> — up to $299/mo</div>
            </div>
            <div className="compare__them">
              <div className="compare__title">Other Solutions</div>
              <div className="compare__list">
                <div className="compare__item">{X} <span className="compare__item--dim">No pre-loaded database</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">No auto extraction</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">No smart collections</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">No UK plate lookup</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">No wheel finder</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">No vehicle spec pages</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">1-2 widgets only</span></div>
                <div className="compare__item">{X} <span className="compare__item--dim">Requires support for setup</span></div>
              </div>
              <div className="compare__price">Starting at <strong>$250/mo</strong> (Convermax)</div>
            </div>
          </div>
        </Rv>
      </div>
    </section>

    {/* 10. TESTIMONIALS */}
    <section className="sec sec--alt">
      <div className="wrap">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">Testimonials</div><div className="sec__h2">What retailers say</div></div></Rv>
        <div className="reviews">{TESTIMONIALS.map((t,i)=><Rv key={i} d={i*.1}><div className="review"><div className="review__stars">{"★".repeat(t.stars)}</div><div className="review__quote">{t.quote}</div><div className="review__name">{t.name}</div><div className="review__role">{t.role}, {t.company}</div></div></Rv>)}</div>
      </div>
    </section>

    {/* 11. FAQ */}
    <section id="faq" className="sec">
      <div className="wrap">
        <Rv><div className="sec__header sec__header--c"><div className="sec__tag">FAQ</div><div className="sec__h2">Frequently asked questions</div></div></Rv>
        <div className="faq-list">{FAQ_ITEMS.map((item,i)=><Rv key={i} d={i*.03}><div className={`faq ${faq===i?"faq--open":""}`}><button className="faq__q" onClick={()=>setFaq(faq===i?null:i)}>{item.question}<span className="faq__icon">+</span></button>{faq===i&&<div className="faq__a">{item.answer}</div>}</div></Rv>)}</div>
      </div>
    </section>

    {/* 12. CTA */}
    <section className="cta"><div className="wrap" style={{ position: "relative", zIndex: 1, textAlign: "center" }}><Rv><div className="sec__h2" style={{ color: "#fff" }}>Ready to sell more parts?</div><p style={{ fontSize: 18, color: "rgba(255,255,255,.7)", margin: "16px auto 36px", maxWidth: 440 }}>Join automotive stores using AutoSync for exact-fit parts discovery.</p><a href="#get-started" className="btn btn--white">Start Your Free Trial</a></Rv></div></section>

    {/* 13. LOGIN */}
    <section id="get-started" className="sec" style={{ paddingTop: 80, paddingBottom: 80 }}>
      <div className="wrap" style={{ maxWidth: 460, textAlign: "center" }}>
        {Logo(48)}
        <div style={{ fontFamily: "var(--heading)", fontSize: 24, fontWeight: 800, margin: "16px 0 8px", letterSpacing: "-.02em" }}>AutoSync</div>
        <p style={{ fontSize: 15, color: "var(--slate)", marginBottom: 28 }}>Enter your Shopify store domain to get started</p>
        {showForm && <Form method="post" action="/auth/login"><div style={{ display: "flex", gap: 10 }}><input name="shop" className="login-input" placeholder="your-store.myshopify.com" value={shop} onChange={e=>setShop(e.target.value)}/><button type="submit" className="btn btn--blue">Install</button></div></Form>}
      </div>
    </section>

    {btt && <button className="btt" onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>}

    {/* 14. FOOTER */}
    <footer className="footer"><div className="wrap">
      <div className="footer__grid">
        <div><div className="footer__brand">{Logo(20)} AutoSync</div><p className="footer__desc">{BRAND.shortDescription}</p></div>
        <div><h4>Product</h4><div className="footer__links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></div></div>
        <div><h4>Company</h4><div className="footer__links"><a href="#">About</a><a href="#">Blog</a><a href="#">Changelog</a></div></div>
        <div><h4>Legal</h4><div className="footer__links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="mailto:support@autosync.app">Contact</a></div></div>
      </div>
      <div className="footer__bottom">© {new Date().getFullYear()} AutoSync. All rights reserved.</div>
    </div></footer>
  </div>;
}
