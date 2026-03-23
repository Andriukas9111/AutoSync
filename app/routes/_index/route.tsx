import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Fetch real YMME database stats for the landing page
  const [makesRes, modelsRes, enginesRes, specsRes, tenantsRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
    db.from("tenants").select("id", { count: "exact", head: true }),
  ]);

  return {
    showForm: Boolean(login),
    stats: {
      makes: makesRes.count ?? 0,
      models: modelsRes.count ?? 0,
      engines: enginesRes.count ?? 0,
      specs: specsRes.count ?? 0,
      tenants: tenantsRes.count ?? 0,
    },
  };
};

export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Hero */}
      <header style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)", color: "white", padding: "80px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
            <svg width="40" height="40" viewBox="0 0 150 150" fill="none">
              <path d="M75 10 L130 45 L130 105 L75 140 L20 105 L20 45 Z" fill="#3b82f6" opacity="0.9"/>
              <path d="M75 35 L105 55 L105 95 L75 115 L45 95 L45 55 Z" fill="white" opacity="0.15"/>
              <path d="M60 65 L75 50 L100 80 L75 100 L50 80 Z" fill="white"/>
            </svg>
            <span style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>AutoSync</span>
          </div>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 800, lineHeight: 1.1, margin: "0 0 20px", letterSpacing: "-1px" }}>
            Vehicle Fitment for Shopify
          </h1>
          <p style={{ fontSize: "clamp(16px, 2vw, 22px)", opacity: 0.85, maxWidth: "600px", margin: "0 auto 40px", lineHeight: 1.6 }}>
            The most comprehensive YMME system for automotive parts stores. Map products to vehicles, create smart collections, and help customers find the right parts.
          </p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="https://apps.shopify.com" style={{ display: "inline-block", padding: "16px 32px", background: "#3b82f6", color: "white", borderRadius: "12px", fontWeight: 600, fontSize: "18px", textDecoration: "none" }}>
              Install on Shopify
            </a>
            <a href="#features" style={{ display: "inline-block", padding: "16px 32px", background: "rgba(255,255,255,0.1)", color: "white", borderRadius: "12px", fontWeight: 600, fontSize: "18px", textDecoration: "none", border: "1px solid rgba(255,255,255,0.2)" }}>
              Learn More
            </a>
          </div>
        </div>
      </header>

      {/* Live Stats Bar */}
      <section style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "40px 24px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "32px", textAlign: "center" }}>
          {[
            { value: stats.makes.toLocaleString(), label: "Vehicle Makes" },
            { value: stats.models.toLocaleString(), label: "Models" },
            { value: stats.engines.toLocaleString(), label: "Engine Variants" },
            { value: stats.specs.toLocaleString(), label: "Vehicle Specs" },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: "36px", fontWeight: 800, color: "#1e293b", letterSpacing: "-1px" }}>{s.value}</div>
              <div style={{ fontSize: "14px", color: "#64748b", marginTop: "4px" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ padding: "80px 24px", maxWidth: "1100px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "36px", fontWeight: 800, textAlign: "center", marginBottom: "16px", color: "#0f172a" }}>Everything You Need</h2>
        <p style={{ textAlign: "center", color: "#64748b", fontSize: "18px", maxWidth: "600px", margin: "0 auto 48px" }}>
          One app to manage vehicle fitment, collections, and storefront widgets.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
          {[
            { icon: "🔍", title: "YMME Search Widget", desc: "Cascading Year/Make/Model/Engine search that helps customers find compatible parts instantly. Persists across pages." },
            { icon: "🇬🇧", title: "UK Plate Lookup", desc: "Customers enter their reg plate and instantly see compatible parts. Powered by DVLA & MOT APIs with full vehicle history." },
            { icon: "🤖", title: "Smart Auto-Extraction", desc: "Automatically detect vehicle fitment from product titles, descriptions, and tags. Engine families, chassis codes, and platform groups." },
            { icon: "📦", title: "Smart Collections", desc: "Auto-generate make, model, and year-range collections with brand logos, SEO descriptions, and proper tag-based rules." },
            { icon: "📄", title: "Vehicle Spec Pages", desc: "SEO-optimized vehicle specification pages with full engine data, linked products, and responsive design." },
            { icon: "🏷️", title: "Fitment Badge", desc: "'Fits your vehicle' or 'May not fit' badges on every product page. Customers know instantly if a part is compatible." },
            { icon: "🔧", title: "Provider Import", desc: "Import products from CSV, XML, FTP, or API. Auto-detect file format, smart column mapping with memory." },
            { icon: "🔎", title: "Search & Discovery Filters", desc: "Structured metafields for Shopify's Search & Discovery — filter by Make, Model, Year, and Engine." },
            { icon: "📊", title: "Analytics Dashboard", desc: "Fitment coverage, popular makes/models, conversion funnel, REG plate lookups, and supplier performance." },
          ].map((f) => (
            <div key={f.title} style={{ background: "white", borderRadius: "16px", padding: "32px", border: "1px solid #e2e8f0", transition: "box-shadow 0.2s" }}>
              <div style={{ fontSize: "32px", marginBottom: "16px" }}>{f.icon}</div>
              <h3 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", marginBottom: "8px" }}>{f.title}</h3>
              <p style={{ color: "#64748b", lineHeight: 1.6, fontSize: "15px" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: "white", padding: "80px 24px", borderTop: "1px solid #e2e8f0" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "36px", fontWeight: 800, textAlign: "center", marginBottom: "16px", color: "#0f172a" }}>Simple Pricing</h2>
          <p style={{ textAlign: "center", color: "#64748b", fontSize: "18px", maxWidth: "500px", margin: "0 auto 48px" }}>
            Start free. Scale as you grow.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            {[
              { name: "Free", price: "$0", products: "50", features: "Manual mapping, YMME widget" },
              { name: "Starter", price: "$19", products: "1,000", features: "Auto extraction, push tags, fitment badge" },
              { name: "Growth", price: "$49", products: "10,000", features: "All widgets, smart collections, bulk ops", highlight: true },
              { name: "Professional", price: "$99", products: "50,000", features: "API integration, My Garage, custom vehicles" },
              { name: "Business", price: "$179", products: "200,000", features: "FTP import, Wheel Finder, priority support" },
              { name: "Enterprise", price: "$299", products: "Unlimited", features: "DVLA plate lookup, VIN decode, full CSS" },
            ].map((p) => (
              <div key={p.name} style={{
                background: p.highlight ? "linear-gradient(135deg, #3b82f6, #2563eb)" : "#f8fafc",
                color: p.highlight ? "white" : "#0f172a",
                borderRadius: "16px", padding: "28px", border: p.highlight ? "none" : "1px solid #e2e8f0",
                textAlign: "center",
              }}>
                <div style={{ fontSize: "14px", fontWeight: 600, opacity: 0.8, marginBottom: "4px" }}>{p.name}</div>
                <div style={{ fontSize: "32px", fontWeight: 800, marginBottom: "4px" }}>{p.price}<span style={{ fontSize: "14px", fontWeight: 400 }}>/mo</span></div>
                <div style={{ fontSize: "13px", opacity: 0.7, marginBottom: "12px" }}>{p.products} products</div>
                <div style={{ fontSize: "13px", opacity: 0.8, lineHeight: 1.5 }}>{p.features}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Login Form */}
      {showForm && (
        <section style={{ padding: "60px 24px", textAlign: "center" }}>
          <div style={{ maxWidth: "400px", margin: "0 auto", background: "white", borderRadius: "16px", padding: "32px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "16px", color: "#0f172a" }}>Already installed?</h3>
            <Form method="post" action="/auth/login" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
                style={{ padding: "12px 16px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "16px", width: "100%", boxSizing: "border-box" }}
              />
              <button
                type="submit"
                style={{ padding: "12px 24px", background: "#0f172a", color: "white", borderRadius: "8px", fontSize: "16px", fontWeight: 600, border: "none", cursor: "pointer" }}
              >
                Open Dashboard
              </button>
            </Form>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer style={{ background: "#0f172a", color: "white", padding: "40px 24px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "16px" }}>
          <svg width="20" height="20" viewBox="0 0 150 150" fill="none">
            <path d="M75 10 L130 45 L130 105 L75 140 L20 105 L20 45 Z" fill="#3b82f6"/>
            <path d="M60 65 L75 50 L100 80 L75 100 L50 80 Z" fill="white"/>
          </svg>
          <span style={{ fontWeight: 700 }}>AutoSync</span>
        </div>
        <p style={{ fontSize: "14px", opacity: 0.5 }}>© 2026 AutoSync. Vehicle fitment intelligence for Shopify.</p>
        <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginTop: "16px", fontSize: "14px" }}>
          <a href="/legal/privacy" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}>Privacy Policy</a>
          <a href="/legal/terms" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}>Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}
