import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";
import { useState, useEffect, useRef } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
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

/* Our real SVG logo as a component */
function Logo({ size = 32, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} d="M649.88,613.79c-2.05,2.9-6.7,7.92-7.75,11.18-.28.88-1.56,2.26-2.12,3.05-1.35,1.92-2.6,3.92-3.83,5.93-.53.86-1.57,2.2-2.17,3.08-6.51,9.57-12.95,19.48-17.81,29.93-.26.56-.89,1.6-1.07,2.17l-2.96,4.78c-12.08,19.53-19.03,41.59-29.07,62.04l-55.07,112.19c-.12.24.12.77.03,1.03-6.69,10.45-15.8,30.69-21.07,40.92-.34.66-.7,2.05-.93,2.82l-2.13,4.15-.87,1.86-2.12,4.14-.79,1.86-2.99,6.2c-.3.45-.85,1.25-1.07,1.69l-2.14,4.25-.87,1.86-2.13,4.14c-.24.47-.55,1.5-.86,1.93-1.93,2.79-5.03,8.86-6.15,12.07-.17.49-.58,1.43-.85,1.87-1.62,2.61-4.14,8.22-5.08,11.15-.16.5-.64,1.41-.9,1.88l-1.15,2.09c-4.05,7.34-9.23,13.79-18.05,17.06l-297.19,110.08c-15.62,5.79-32-6.43-34.53-19.43-2.27-11.72,1.14-17.99,5.58-27.17l250.39-517.49,48.41-99.53,80.24-165.62,13.24-28.33,47.54-96.96c4.3-8.78,16.69-11.39,25.31-10.39s17.2,6.02,21.47,14.59l67.09,134.73,75.53,151.3,25.43,51.94c2.4,4.9-2.67,8.86-5.99,11.54l-31.01,25.01-19.62,17.35c-10.85,9.6-19.84,18.93-29.53,29.6l-19.64,21.62c-11.43,12.58-21.11,26.15-30.77,39.85Z"/>
      <path fill={color} d="M728.87,955.34l-57.62-113.62c-7.69-15.15-15.92-29.06-22.26-44.66-3.86-9.48-1.11-19.61-.33-29.51,6.2-79.19,45.35-155.66,92.9-217.9,10.7-14,35.13-41.76,48.25-53.11,1.5-1.29,5.45-1.99,7.09-1.43s4.47,2.69,5.45,4.64l36.42,72.5,41.65,84.41,123.43,248.48,69.4,140.74c4.84,9.82-.25,21.97-6.35,28.37s-17.63,10.65-27.65,6.95l-289.84-107.29c-9.58-3.55-15.71-9.03-20.54-18.57Z"/>
    </svg>
  );
}

/* ─── Animated counter hook ─── */
function useCounter(end: number, duration = 2000) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
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
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return { value, ref };
}

/* ─── Scroll fade-in hook ─── */
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

/* ─── Check icon ─── */
function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 4.5L6.5 11.5L3 8" stroke="#005bd2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ─── X icon ─── */
function Cross() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M12 4L4 12M4 4l8 8" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

/* ─── Section wrapper ─── */
function Section({ children, id, style }: { children: React.ReactNode; id?: string; style?: React.CSSProperties }) {
  const { ref, visible } = useFadeIn();
  return (
    <section
      ref={ref}
      id={id}
      style={{
        padding: "120px 24px",
        maxWidth: 1200,
        margin: "0 auto",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(40px)",
        transition: "opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/* ─── Widget Mockups ─── */
function YMMEMockup() {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", padding: 32, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#ededed", marginBottom: 24, textAlign: "center" }}>Find Parts for Your Vehicle</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { label: "Make", value: "BMW" },
          { label: "Model", value: "3 Series" },
          { label: "Year", value: "2022" },
          { label: "Engine", value: "M340i 382 Hp" },
        ].map((f) => (
          <div key={f.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</div>
            <div style={{ fontSize: 14, color: "#ededed", fontWeight: 500 }}>{f.value}</div>
          </div>
        ))}
      </div>
      <button style={{ width: "100%", marginTop: 20, padding: "12px 24px", background: "#005bd2", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Find Parts
      </button>
    </div>
  );
}

function PlateMockup() {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", padding: 32, maxWidth: 420, margin: "0 auto" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#ededed", marginBottom: 24, textAlign: "center" }}>Find Parts by Registration</div>
      <div style={{ background: "#fdd835", borderRadius: 8, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ background: "#003399", color: "#fff", borderRadius: 4, padding: "4px 6px", fontSize: 10, fontWeight: 600, lineHeight: 1 }}>GB</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: "#111", letterSpacing: 2, fontFamily: "monospace" }}>BD18 JYC</div>
      </div>
      <button style={{ width: "100%", padding: "12px 24px", background: "#005bd2", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 16 }}>
        Look Up Vehicle
      </button>
      <div style={{ background: "rgba(34,197,94,0.08)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.2)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#22c55e" opacity="0.15"/><path d="M6 9l2 2 4-4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{ color: "#22c55e", fontSize: 14, fontWeight: 500 }}>Vehicle Found &mdash; 2018 BMW 3 Series 320d</span>
      </div>
    </div>
  );
}

function CompatibilityMockup() {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", padding: 24, maxWidth: 560, margin: "0 auto", overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#ededed" }}>Vehicle Compatibility</div>
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#22c55e", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 6l2 2 4-4" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
          Fits your vehicle
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Make", "Model", "Years", "Engine"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { make: "BMW", model: "3 Series (F30)", years: "2019-2023", engine: "320i 184 Hp" },
            { make: "BMW", model: "3 Series (G20)", years: "2019-2025", engine: "330i 258 Hp" },
            { make: "BMW", model: "4 Series (G22)", years: "2020-2025", engine: "M440i 374 Hp" },
          ].map((r, i) => (
            <tr key={i}>
              <td style={{ padding: "10px 12px", color: "#ededed", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.make}</td>
              <td style={{ padding: "10px 12px", color: "#ededed", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.model}</td>
              <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.years}</td>
              <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.engine}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VehicleSpecMockup() {
  return (
    <div style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(0,91,210,0.06) 100%)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", padding: 32, maxWidth: 420, margin: "0 auto" }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Audi</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: "#ededed", marginBottom: 4 }}>A1</div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", marginBottom: 20 }}>1.4 TFSI 150 Hp</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {["Petrol", "FWD", "Hatchback", "2015-2018"].map((b) => (
          <span key={b} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{b}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
        {[
          { val: "150", unit: "HP" },
          { val: "250", unit: "Nm" },
          { val: "1.4", unit: "L" },
          { val: "7.9", unit: "s" },
        ].map((s) => (
          <div key={s.unit} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#005bd2" }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <Logo size={24} color="#005bd2" />
        <span style={{ fontSize: 16, fontWeight: 600, color: "#ededed" }}>AutoSync Dashboard</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Products", value: "2,844", color: "#005bd2" },
          { label: "Fitments", value: "5,827", color: "#22c55e" },
          { label: "Coverage", value: "44%", color: "#f59e0b" },
          { label: "Collections", value: "1,125", color: "#8b5cf6" },
        ].map((s) => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Sync Progress</span>
          <span style={{ fontSize: 12, color: "#005bd2", fontWeight: 500 }}>68%</span>
        </div>
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 6, overflow: "hidden" }}>
          <div style={{ background: "linear-gradient(90deg, #005bd2, #3b82f6)", borderRadius: 4, height: "100%", width: "68%", transition: "width 1s ease" }} />
        </div>
      </div>
    </div>
  );
}

/* ─── Main landing page ─── */
export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();
  const [scrolled, setScrolled] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [shopDomain, setShopDomain] = useState("");

  // Nav scroll effect
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Stat counters
  const makes = useCounter(Number(stats.makes), 2000);
  const models = useCounter(Number(stats.models), 2200);
  const engines = useCounter(Number(stats.engines), 2400);
  const specs = useCounter(Number(stats.specs), 2600);

  const tabs = ["YMME Search", "Plate Lookup", "Compatibility", "Vehicle Specs", "Dashboard"];
  const tabMockups = [<YMMEMockup key="y" />, <PlateMockup key="p" />, <CompatibilityMockup key="c" />, <VehicleSpecMockup key="v" />, <DashboardMockup key="d" />];

  const features = [
    {
      title: "Smart Vehicle Mapping",
      desc: "Our extraction engine analyzes product titles, descriptions, and tags to automatically match products to vehicles. Pattern matching across 55 make patterns, chassis codes, and engine families.",
      bullets: ["Auto-extract Year/Make/Model/Engine", "Smart suggestions with confidence scores", "Manual mapping queue for edge cases"],
    },
    {
      title: "Storefront Widgets",
      desc: "Eight embeddable Liquid blocks that install directly into any Shopify theme. Cascading YMME search, fitment badges, compatibility tables, and a floating vehicle bar.",
      bullets: ["Theme App Extension (no code edits)", "Works with all Shopify themes", "Real-time vehicle persistence"],
    },
    {
      title: "Automated Collections",
      desc: "Generate smart collections by Make, Make+Model, or Make+Model+Year. Each collection gets a logo, SEO metadata, and publishes to your Online Store automatically.",
      bullets: ["One-click collection generation", "Brand logos and SEO built in", "Published to Online Store instantly"],
    },
    {
      title: "Provider Data Import",
      desc: "Connect CSV, XML, JSON, API, or FTP data sources. Smart column mapping remembers your preferences. Duplicate detection and preview before every import.",
      bullets: ["5 source types supported", "Intelligent column mapping", "Preview and validate before import"],
    },
  ];

  const plans = [
    {
      name: "Starter",
      price: "$19",
      desc: "For shops just getting started with fitment",
      features: ["1,000 products", "5,000 fitments", "1 data provider", "YMME widget", "Fitment badge", "Push tags & metafields"],
      cta: "Start Free Trial",
    },
    {
      name: "Growth",
      price: "$49",
      desc: "For growing automotive businesses",
      features: ["10,000 products", "50,000 fitments", "3 data providers", "All 4 widgets", "Auto extraction", "Make collections", "Bulk operations"],
      cta: "Start Free Trial",
      popular: true,
    },
    {
      name: "Professional",
      price: "$99",
      desc: "For established parts retailers",
      features: ["50,000 products", "250,000 fitments", "5 data providers", "API integration", "Custom vehicles", "My Garage", "Make+Model collections", "Priority support"],
      cta: "Start Free Trial",
    },
  ];

  const comparisonRows = [
    { feature: "Starting Price", us: "Free", them: "$250/mo", others: "$49/mo" },
    { feature: "Shopify Integration", us: "Native App", them: "JavaScript Embed", others: "Tag-based" },
    { feature: "Vehicle Database", us: "29,000+ Engines", them: "Limited", others: "Basic YMME" },
    { feature: "Auto Extraction", us: true, them: false, others: false },
    { feature: "UK Plate Lookup", us: true, them: false, others: false },
    { feature: "Vehicle Spec Pages", us: true, them: false, others: false },
    { feature: "Collection Generation", us: true, them: true, others: false },
    { feature: "FTP/API Import", us: true, them: false, others: true },
    { feature: "Built for Shopify", us: true, them: false, others: false },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #09090b; color: #ededed; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        a { color: inherit; text-decoration: none; }

        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        @keyframes glow-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }

        .nav-fixed { position: fixed; top: 0; left: 0; right: 0; z-index: 100; transition: all 0.3s ease; }
        .nav-glass { background: rgba(9,9,11,0.82); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.06); }

        .btn-primary { display: inline-flex; align-items: center; justify-content: center; padding: 10px 24px; background: #005bd2; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s ease; }
        .btn-primary:hover { background: #0066ee; transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,91,210,0.3); }
        .btn-secondary { display: inline-flex; align-items: center; justify-content: center; padding: 10px 24px; background: transparent; color: #ededed; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; font-size: 14px; font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.2s ease; }
        .btn-secondary:hover { border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.04); }

        .card-hover { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 40px rgba(0,0,0,0.3); }

        .tab-btn { padding: 10px 20px; background: transparent; border: 1px solid rgba(255,255,255,0.06); color: rgba(255,255,255,0.55); border-radius: 8px; font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; }
        .tab-btn:hover { color: #ededed; border-color: rgba(255,255,255,0.12); }
        .tab-btn.active { background: rgba(0,91,210,0.12); border-color: rgba(0,91,210,0.3); color: #3b82f6; }

        .login-input { width: 100%; padding: 12px 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: #ededed; font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.2s; }
        .login-input:focus { border-color: #005bd2; }
        .login-input::placeholder { color: rgba(255,255,255,0.25); }

        @media (max-width: 1024px) {
          .hero-grid { flex-direction: column !important; text-align: center; }
          .hero-widget { margin-top: 48px !important; }
          .features-alt { flex-direction: column !important; }
          .features-alt.reverse { flex-direction: column !important; }
          .pricing-grid { grid-template-columns: 1fr !important; max-width: 420px !important; margin: 0 auto !important; }
        }
        @media (max-width: 768px) {
          .nav-links { display: none !important; }
          .hero-title { font-size: 36px !important; }
          .stat-grid-4 { grid-template-columns: 1fr 1fr !important; }
          .comparison-table { font-size: 12px !important; }
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
          section { padding: 80px 20px !important; }
          .tab-row { flex-wrap: wrap !important; }
        }
        @media (max-width: 480px) {
          .hero-title { font-size: 28px !important; }
          .hero-ctas { flex-direction: column !important; width: 100%; }
          .hero-ctas a, .hero-ctas button { width: 100%; }
          .stat-grid-4 { grid-template-columns: 1fr !important; }
          .footer-grid { grid-template-columns: 1fr !important; }
        }
      `}} />

      {/* ═══════════ NAV ═══════════ */}
      <nav className={`nav-fixed ${scrolled ? "nav-glass" : ""}`}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={28} color="#005bd2" />
            <span style={{ fontSize: 18, fontWeight: 600, color: "#ededed" }}>AutoSync</span>
          </div>
          <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: 32 }}>
            {[
              { label: "Features", href: "#features" },
              { label: "Widgets", href: "#widgets" },
              { label: "Pricing", href: "#pricing" },
              { label: "Compare", href: "#compare" },
            ].map((l) => (
              <a key={l.label} href={l.href} style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", fontWeight: 500, transition: "color 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#ededed")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
              >{l.label}</a>
            ))}
          </div>
          <a href="#login" className="btn-primary" style={{ padding: "8px 20px", fontSize: 13 }}>Start Free</a>
        </div>
      </nav>

      {/* ═══════════ HERO ═══════════ */}
      <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", padding: "120px 24px 80px", position: "relative", overflow: "hidden" }}>
        {/* Background glow */}
        <div style={{ position: "absolute", top: "20%", left: "50%", width: 800, height: 800, transform: "translate(-50%, -50%)", background: "radial-gradient(circle, rgba(0,91,210,0.08) 0%, transparent 70%)", pointerEvents: "none", animation: "glow-pulse 6s ease-in-out infinite" }} />

        <div className="hero-grid" style={{ maxWidth: 1200, margin: "0 auto", width: "100%", display: "flex", alignItems: "center", gap: 64, position: "relative" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Built for Shopify pill */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 20, padding: "6px 16px", marginBottom: 24 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.15 2.74L8.12.59a2.5 2.5 0 00-2.24 0L1.85 2.74A2.5 2.5 0 00.6 4.9v4.2a2.5 2.5 0 001.25 2.16l4.03 2.15a2.5 2.5 0 002.24 0l4.03-2.15A2.5 2.5 0 0013.4 9.1V4.9a2.5 2.5 0 00-1.25-2.16z" fill="#22c55e" opacity="0.2"/><path d="M5 7l1.5 1.5L9.5 5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 500 }}>Built for Shopify</span>
            </div>

            <h1 className="hero-title" style={{ fontSize: 56, fontWeight: 600, lineHeight: 1.1, color: "#ededed", marginBottom: 20, letterSpacing: "-0.02em" }}>
              Vehicle Fitment{" "}
              <span style={{ background: "linear-gradient(135deg, #005bd2, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Intelligence
              </span>
              {" "}for Shopify
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.7, color: "rgba(255,255,255,0.55)", marginBottom: 36, maxWidth: 520 }}>
              Help customers find parts that fit their vehicle. Year, Make, Model, Engine search — with auto-extraction, storefront widgets, and smart collections.
            </p>

            <div className="hero-ctas" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a href="#login" className="btn-primary" style={{ padding: "14px 32px", fontSize: 15 }}>Start Free Trial</a>
              <a href="#widgets" className="btn-secondary" style={{ padding: "14px 32px", fontSize: 15 }}>See Widgets</a>
            </div>
          </div>

          {/* Floating widget preview */}
          <div className="hero-widget" style={{ flex: "0 0 440px", animation: "float 6s ease-in-out infinite" }}>
            <YMMEMockup />
          </div>
        </div>
      </section>

      {/* ═══════════ STATS ═══════════ */}
      <section style={{ padding: "0 24px 80px", maxWidth: 1200, margin: "0 auto" }}>
        <div className="stat-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "rgba(255,255,255,0.04)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
          {[
            { label: "Makes", counter: makes },
            { label: "Models", counter: models },
            { label: "Engines", counter: engines },
            { label: "Vehicle Specs", counter: specs },
          ].map((s) => (
            <div key={s.label} ref={s.counter.ref} style={{ padding: "40px 24px", textAlign: "center", background: "#09090b" }}>
              <div style={{ fontSize: 40, fontWeight: 600, color: "#ededed", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
                {s.counter.value.toLocaleString()}
              </div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ WIDGET SHOWCASE ═══════════ */}
      <Section id="widgets">
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#005bd2", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Storefront Widgets</div>
          <h2 style={{ fontSize: 40, fontWeight: 600, color: "#ededed", marginBottom: 16 }}>Everything your store needs</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", maxWidth: 560, margin: "0 auto" }}>Eight embeddable widgets that install into any Shopify theme with zero code changes.</p>
        </div>

        {/* Tabs */}
        <div className="tab-row" style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 48, flexWrap: "wrap" }}>
          {tabs.map((t, i) => (
            <button key={t} className={`tab-btn ${activeTab === i ? "active" : ""}`} onClick={() => setActiveTab(i)}>{t}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ position: "relative", minHeight: 320 }}>
          {tabMockups.map((mockup, i) => (
            <div key={i} style={{
              position: i === activeTab ? "relative" : "absolute",
              top: 0, left: 0, right: 0,
              opacity: i === activeTab ? 1 : 0,
              pointerEvents: i === activeTab ? "auto" : "none",
              transition: "opacity 0.4s ease",
            }}>
              {mockup}
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════ FEATURES ═══════════ */}
      <section id="features" style={{ padding: "0 24px" }}>
        {features.map((f, i) => {
          const isReverse = i % 2 === 1;
          return (
            <Section key={f.title} style={{ padding: "80px 0" }}>
              <div className={`features-alt ${isReverse ? "reverse" : ""}`} style={{ display: "flex", alignItems: "center", gap: 64, flexDirection: isReverse ? "row-reverse" : "row" }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: 28, fontWeight: 600, color: "#ededed", marginBottom: 16 }}>{f.title}</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.7, color: "rgba(255,255,255,0.55)", marginBottom: 24 }}>{f.desc}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {f.bullets.map((b) => (
                      <div key={b} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 10, background: "rgba(0,91,210,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Check />
                        </div>
                        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="card-hover" style={{ background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", padding: 40, minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {i === 0 && <YMMEMockup />}
                    {i === 1 && <CompatibilityMockup />}
                    {i === 2 && <DashboardMockup />}
                    {i === 3 && <PlateMockup />}
                  </div>
                </div>
              </div>
            </Section>
          );
        })}
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <Section id="how-it-works">
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#005bd2", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>How It Works</div>
          <h2 style={{ fontSize: 40, fontWeight: 600, color: "#ededed" }}>Up and running in minutes</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, position: "relative" }}>
          {/* Connecting line */}
          <div style={{ position: "absolute", top: 28, left: "12.5%", right: "12.5%", height: 2, background: "rgba(0,91,210,0.2)", zIndex: 0 }} />

          {[
            { step: "1", title: "Install", desc: "Add AutoSync from the Shopify App Store. One click install, no code required." },
            { step: "2", title: "Import", desc: "Sync your products and import fitment data from CSV, API, FTP, or map manually." },
            { step: "3", title: "Map", desc: "Auto-extraction matches products to vehicles. Review suggestions and confirm." },
            { step: "4", title: "Go Live", desc: "Push to Shopify, generate collections, and enable storefront widgets." },
          ].map((s) => (
            <div key={s.step} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 16px", position: "relative", zIndex: 1 }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, background: "#005bd2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 600, color: "#fff", marginBottom: 20, boxShadow: "0 0 24px rgba(0,91,210,0.3)" }}>
                {s.step}
              </div>
              <h4 style={{ fontSize: 18, fontWeight: 600, color: "#ededed", marginBottom: 8 }}>{s.title}</h4>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.45)", maxWidth: 220 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════ PRICING ═══════════ */}
      <Section id="pricing">
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#005bd2", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Pricing</div>
          <h2 style={{ fontSize: 40, fontWeight: 600, color: "#ededed", marginBottom: 16 }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)" }}>Start free. Upgrade as you grow. Cancel anytime.</p>
        </div>

        <div className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, maxWidth: 960, margin: "0 auto" }}>
          {plans.map((plan) => (
            <div
              key={plan.name}
              className="card-hover"
              style={{
                background: plan.popular ? "rgba(0,91,210,0.06)" : "rgba(255,255,255,0.03)",
                borderRadius: 16,
                border: plan.popular ? "1px solid rgba(0,91,210,0.3)" : "1px solid rgba(255,255,255,0.06)",
                padding: 32,
                position: "relative",
              }}
            >
              {plan.popular && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#005bd2", borderRadius: 20, padding: "4px 16px", fontSize: 12, fontWeight: 600, color: "#fff" }}>
                  Most Popular
                </div>
              )}
              <div style={{ fontSize: 18, fontWeight: 600, color: "#ededed", marginBottom: 4 }}>{plan.name}</div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 600, color: "#ededed" }}>{plan.price}</span>
                <span style={{ fontSize: 14, color: "rgba(255,255,255,0.35)" }}>/mo</span>
              </div>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginBottom: 24 }}>{plan.desc}</p>
              <a href="#login" className="btn-primary" style={{ width: "100%", marginBottom: 24, padding: "12px 24px", background: plan.popular ? "#005bd2" : "rgba(255,255,255,0.06)" }}>
                {plan.cta}
              </a>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.features.map((feat) => (
                  <div key={feat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Check />
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{feat}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════ COMPETITOR COMPARISON ═══════════ */}
      <Section id="compare">
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#005bd2", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Compare</div>
          <h2 style={{ fontSize: 40, fontWeight: 600, color: "#ededed", marginBottom: 16 }}>Why AutoSync wins</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)" }}>More features, lower price, native Shopify integration.</p>
        </div>

        <div className="comparison-table" style={{ background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden", maxWidth: 800, margin: "0 auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "16px 20px", fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Feature</th>
                <th style={{ textAlign: "center", padding: "16px 20px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ color: "#005bd2" }}>AutoSync</span>
                </th>
                <th style={{ textAlign: "center", padding: "16px 20px", fontSize: 13, color: "rgba(255,255,255,0.45)", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Convermax</th>
                <th style={{ textAlign: "center", padding: "16px 20px", fontSize: 13, color: "rgba(255,255,255,0.45)", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Others</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.feature}>
                  <td style={{ padding: "14px 20px", fontSize: 14, color: "#ededed", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{row.feature}</td>
                  <td style={{ padding: "14px 20px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {typeof row.us === "boolean" ? (row.us ? <span style={{ color: "#22c55e" }}><Check /></span> : <Cross />) : <span style={{ fontSize: 14, fontWeight: 500, color: "#005bd2" }}>{row.us}</span>}
                  </td>
                  <td style={{ padding: "14px 20px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {typeof row.them === "boolean" ? (row.them ? <span style={{ color: "#22c55e" }}><Check /></span> : <Cross />) : <span style={{ fontSize: 14, color: "rgba(255,255,255,0.45)" }}>{row.them}</span>}
                  </td>
                  <td style={{ padding: "14px 20px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {typeof row.others === "boolean" ? (row.others ? <span style={{ color: "#22c55e" }}><Check /></span> : <Cross />) : <span style={{ fontSize: 14, color: "rgba(255,255,255,0.45)" }}>{row.others}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ═══════════ CTA ═══════════ */}
      <section style={{ padding: "120px 24px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: 600, height: 600, transform: "translate(-50%, -50%)", background: "radial-gradient(circle, rgba(0,91,210,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", position: "relative" }}>
          <h2 style={{ fontSize: 36, fontWeight: 600, color: "#ededed", marginBottom: 16 }}>Ready to help customers find the right parts?</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", marginBottom: 36, lineHeight: 1.7 }}>
            Join automotive Shopify stores using AutoSync to boost sales and reduce returns with accurate vehicle fitment data.
          </p>
          <a href="#login" className="btn-primary" style={{ padding: "16px 40px", fontSize: 16 }}>Get Started Free</a>
        </div>
      </section>

      {/* ═══════════ LOGIN ═══════════ */}
      <Section id="login">
        <div style={{ maxWidth: 420, margin: "0 auto" }}>
          <div className="card-hover" style={{ background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", padding: 40 }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <Logo size={40} color="#005bd2" />
              <h3 style={{ fontSize: 22, fontWeight: 600, color: "#ededed", marginTop: 16, marginBottom: 8 }}>Log in to AutoSync</h3>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)" }}>Enter your Shopify store domain to get started</p>
            </div>
            {showForm && (
              <Form method="post" action="/auth/login">
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>Store domain</label>
                  <input
                    className="login-input"
                    type="text"
                    name="shop"
                    placeholder="my-store.myshopify.com"
                    value={shopDomain}
                    onChange={(e) => setShopDomain(e.target.value)}
                  />
                </div>
                <button className="btn-primary" type="submit" style={{ width: "100%", padding: "14px 24px", fontSize: 15 }}>
                  Install AutoSync
                </button>
              </Form>
            )}
          </div>
        </div>
      </Section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "64px 24px" }}>
        <div className="footer-grid" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Logo size={24} color="#005bd2" />
              <span style={{ fontSize: 16, fontWeight: 600, color: "#ededed" }}>AutoSync</span>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(255,255,255,0.35)", maxWidth: 280 }}>
              Vehicle fitment intelligence for Shopify. Help customers find parts that fit.
            </p>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>Product</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["Features", "Pricing", "Widgets", "Integrations"].map((l) => (
                <a key={l} href={`#${l.toLowerCase()}`} style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", transition: "color 0.2s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ededed")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                >{l}</a>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>Company</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["About", "Blog", "Careers", "Contact"].map((l) => (
                <a key={l} href="#" style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", transition: "color 0.2s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ededed")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                >{l}</a>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>Legal</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Privacy Policy", href: "/legal/privacy" },
                { label: "Terms of Service", href: "/legal/terms" },
                { label: "GDPR", href: "#" },
              ].map((l) => (
                <a key={l.label} href={l.href} style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", transition: "color 0.2s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ededed")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                >{l.label}</a>
              ))}
            </div>
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: "48px auto 0", paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)" }}>
            &copy; {new Date().getFullYear()} AutoSync. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
