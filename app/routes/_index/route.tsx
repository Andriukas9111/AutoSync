import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
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

      {/* PLACEHOLDER for remaining sections — will be built one by one */}
      <div style={{ padding: "120px 40px", textAlign: "center", color: "#9ca3af" }}>
        <p style={{ fontSize: 14 }}>More sections coming — building section by section with verification</p>
      </div>
    </div>
  );
}
