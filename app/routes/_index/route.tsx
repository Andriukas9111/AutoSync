import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { CAR_BRANDS, PRICING_TIERS, COMPARE_FEATURES, FAQ_ITEMS, TESTIMONIALS, SYSTEMS, PIPELINE_STEPS, BRAND } from "./data/website-content";
import "./landing.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const [m, mo, e] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
  ]);
  return {
    showForm: Boolean(login),
    makes: m.count ?? 374,
    models: mo.count ?? 3687,
    engines: e.count ?? 29516,
  };
};

/* AutoSync logo SVG */
const L = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 1200 1200" fill="none">
    <path fill="currentColor" d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/>
    <path fill="currentColor" d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/>
  </svg>
);

export default function LandingPage() {
  const { showForm, makes, models, engines } = useLoaderData<typeof loader>();

  return (
    <div>
      {/* NAV */}
      <nav className="nav">
        <div className="nav-inner">
          <a href="#" className="nav-logo"><L /> AutoSync</a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#install" className="nav-cta">Start Free Trial</a>
        </div>
      </nav>

      {/* HERO — Opscale style */}
      <section className="hero">
        <div className="hero-pill">
          <span className="hero-pill-badge">NEW</span>
          Vehicle Fitment Intelligence for Shopify
        </div>

        <h1>Powering Vehicle Fitment Growth with AutoSync</h1>

        <p className="hero-sub">
          The only Shopify app that automatically maps vehicle fitments to your products,
          creates smart collections, and adds Search &amp; Discovery filters.
        </p>

        <a href="#install" className="hero-cta">Start for Free</a>

        {/* EMBEDDED DASHBOARD — Like Opscale */}
        <div className="dash-container">
          <div className="dash">
            <div className="dash-top">
              <span className="dash-dot dash-dot-r" />
              <span className="dash-dot dash-dot-y" />
              <span className="dash-dot dash-dot-g" />
              <span className="dash-url">autosync-app.myshopify.com</span>
            </div>

            <div className="dash-body">
              {/* Sidebar */}
              <div className="dash-side">
                <div className="dash-side-logo"><L s={14} /> AutoSync</div>
                {["Dashboard", "Products", "Fitments", "Push to Shopify", "Collections", "Vehicle Pages", "Providers", "Settings"].map((item, i) => (
                  <div key={item} className={`dash-side-item ${i === 0 ? "dash-side-item--on" : ""}`}>
                    {item}
                  </div>
                ))}
              </div>

              {/* Main */}
              <div className="dash-main">
                <h3>Dashboard</h3>

                <div className="dash-stats">
                  <div className="dash-stat">
                    <b>{makes.toLocaleString()}</b>
                    <small>Makes</small>
                  </div>
                  <div className="dash-stat">
                    <b>{models.toLocaleString()}</b>
                    <small>Models</small>
                  </div>
                  <div className="dash-stat">
                    <b>{engines.toLocaleString()}</b>
                    <small>Engines</small>
                  </div>
                  <div className="dash-stat">
                    <b>80%+</b>
                    <small>Accuracy</small>
                  </div>
                </div>

                <div className="dash-progress-label">Fitment Coverage</div>
                <div className="dash-bar"><div className="dash-bar-fill" style={{ width: "68%" }} /></div>
                <div className="dash-bar-meta"><span>1,593 Needs Review</span><span>3,234 Mapped</span></div>

                <div className="dash-actions">
                  <div className="dash-action"><span className="dash-action-dot" style={{ background: "#3b82f6" }} /> Fetch Products</div>
                  <div className="dash-action"><span className="dash-action-dot" style={{ background: "#f59e0b" }} /> Auto Extract</div>
                  <div className="dash-action"><span className="dash-action-dot" style={{ background: "#10b981" }} /> Manual Map</div>
                  <div className="dash-action dash-action--primary"><span className="dash-action-dot" style={{ background: "#fff" }} /> Push to Shopify</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST MARQUEE */}
      <section className="trust">
        <p className="trust-label">Trusted by automotive parts retailers worldwide</p>
        <div style={{ overflow: "hidden" }}>
          <div className="trust-track">
            {[...CAR_BRANDS, ...CAR_BRANDS].map((b, i) => (
              <img key={i} src={b.logo} alt={b.name} loading="lazy" />
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES — Bento grid (Opscale style) */}
      <section id="features" className="sec sec--gray">
        <div className="sec-inner">
          <div className="sec-header sec-header--c">
            <div className="sec-eyebrow">Features</div>
            <h2 className="sec-h2">Everything you need to sell auto parts</h2>
            <p className="sec-desc">From smart extraction to storefront widgets — a complete vehicle fitment platform built for Shopify.</p>
          </div>
          <div className="bento">
            {SYSTEMS.slice(0, 6).map((sys, i) => (
              <div key={sys.id} className={`bento-card ${i < 2 ? "bento-card--wide" : ""}`}>
                <h3>{sys.name}</h3>
                <p>{sys.headline}</p>
                <span className="bento-tag">{Object.values(sys.stats)[0]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — Vertical timeline */}
      <section id="how-it-works" className="sec">
        <div className="sec-inner">
          <div className="sec-header sec-header--c">
            <div className="sec-eyebrow">How It Works</div>
            <h2 className="sec-h2">Install to sales in 4 steps</h2>
          </div>
          <div className="timeline">
            <div className="timeline-line" />
            {PIPELINE_STEPS.map((s, i) => (
              <div key={i} className="tl-step">
                <div className="tl-num">{s.number}</div>
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                {s.duration && <span className="tl-dur">{s.duration}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS DARK BAND */}
      <section className="stats-band">
        <div className="stats-row">
          <div className="stat-item"><div className="stat-num">{makes.toLocaleString()}+</div><div className="stat-label">Vehicle Makes</div></div>
          <div className="stat-item"><div className="stat-num">{models.toLocaleString()}+</div><div className="stat-label">Models</div></div>
          <div className="stat-item"><div className="stat-num">{engines.toLocaleString()}+</div><div className="stat-label">Engines</div></div>
          <div className="stat-item"><div className="stat-num">80%+</div><div className="stat-label">Accuracy</div></div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="sec">
        <div className="sec-inner">
          <div className="sec-header sec-header--c">
            <div className="sec-eyebrow">Pricing</div>
            <h2 className="sec-h2">Smart pricing for every plan</h2>
            <p className="sec-desc">Start free. Scale as you grow. 14-day trial on all paid plans.</p>
          </div>
          <div className="price-grid">
            {PRICING_TIERS.slice(0, 3).map((p) => (
              <div key={p.name} className={`price-col ${p.popular ? "price-col--hl" : ""}`}>
                {p.popular && <span className="price-badge">Most Popular</span>}
                <div className="price-name">{p.name}</div>
                <div className="price-amt">{p.price === 0 ? "Free" : `$${p.price}`}</div>
                {p.price > 0 && <div className="price-per">/month</div>}
                <div className="price-limits">
                  <div><strong>{typeof p.limits.products === "number" ? p.limits.products.toLocaleString() : p.limits.products}</strong> products</div>
                  <div><strong>{typeof p.limits.fitments === "number" ? p.limits.fitments.toLocaleString() : p.limits.fitments}</strong> fitments</div>
                </div>
                <ul className="price-feat">
                  {p.features.map((f) => <li key={f}><svg className="chk" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{f}</li>)}
                </ul>
                <a href="#install" className="price-btn">{p.cta}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARE — Side by side */}
      <section id="compare" className="sec sec--gray">
        <div className="sec-inner">
          <div className="sec-header sec-header--c">
            <div className="sec-eyebrow">Comparison</div>
            <h2 className="sec-h2">Why stores switch to AutoSync</h2>
          </div>
          <div className="cmp-grid">
            <div className="cmp-card cmp-card--hl">
              <div className="cmp-title"><L s={18} /> AutoSync</div>
              <div className="cmp-list">
                {COMPARE_FEATURES.map((f) => <div key={f.key} className="cmp-item"><svg className="chk" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{f.label}</div>)}
                <div className="cmp-item"><svg className="chk" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg><strong>7</strong> storefront widgets</div>
              </div>
              <div className="cmp-price">Starting <strong>Free</strong> — up to $299/mo</div>
            </div>
            <div className="cmp-card">
              <div className="cmp-title">Other Solutions</div>
              <div className="cmp-list">
                {["No pre-loaded database", "No auto extraction", "No smart collections", "No UK plate lookup", "No wheel finder", "No vehicle spec pages", "1-2 widgets only", "Requires setup support"].map((s) => (
                  <div key={s} className="cmp-item cmp-item--dim"><svg className="xk" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>{s}</div>
                ))}
              </div>
              <div className="cmp-price">Starting at <strong>$250/mo</strong> (Convermax)</div>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="sec">
        <div className="sec-inner">
          <div className="sec-header sec-header--c">
            <div className="sec-eyebrow">Testimonials</div>
            <h2 className="sec-h2">What retailers say</h2>
          </div>
          <div className="rev-grid">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="rev-card">
                <div className="rev-stars">{"★".repeat(t.stars)}</div>
                <div className="rev-text">{t.quote}</div>
                <div className="rev-name">{t.name}</div>
                <div className="rev-role">{t.role}, {t.company}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="sec sec--gray">
        <div className="sec-inner">
          <div className="sec-header sec-header--c">
            <div className="sec-eyebrow">FAQ</div>
            <h2 className="sec-h2">Common questions</h2>
          </div>
          <div className="faq-list">
            {FAQ_ITEMS.map((item, i) => (
              <details key={i} className="faq-item">
                <summary className="faq-q">{item.question}<span className="faq-icon">+</span></summary>
                <div className="faq-a">{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="cta-band">
        <h2>Ready to sell more parts?</h2>
        <p>Join automotive stores using AutoSync for exact-fit parts discovery.</p>
        <a href="#install">Start Your Free Trial</a>
      </section>

      {/* LOGIN */}
      <section id="install" className="login-sec">
        <L s={36} />
        <div className="login-title">AutoSync</div>
        <p className="login-desc">Enter your Shopify store domain to get started</p>
        {showForm && (
          <form method="post" action="/auth/login" className="login-form">
            <input name="shop" placeholder="your-store.myshopify.com" className="login-input" />
            <button type="submit" className="nav-cta" style={{ padding: "12px 24px" }}>Install</button>
          </form>
        )}
      </section>

      {/* FOOTER */}
      <footer className="foot">
        <div className="foot-inner">
          <div className="foot-grid">
            <div>
              <div className="foot-brand"><L s={16} /> AutoSync</div>
              <p className="foot-desc">{BRAND.shortDescription}</p>
            </div>
            <div><h4>Product</h4><div className="foot-links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></div></div>
            <div><h4>Company</h4><div className="foot-links"><a href="#">About</a><a href="#">Blog</a><a href="#">Changelog</a></div></div>
            <div><h4>Legal</h4><div className="foot-links"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="mailto:support@autosync.app">Contact</a></div></div>
          </div>
          <div className="foot-copy">© 2026 AutoSync. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
