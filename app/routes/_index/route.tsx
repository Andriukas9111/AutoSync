import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import db from "../../lib/db.server";

import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { TrustMarquee } from "./components/TrustMarquee";
import { WidgetShowcase } from "./components/WidgetShowcase";
import { SystemsCarousel } from "./components/SystemsCarousel";
import { HowItWorks } from "./components/HowItWorks";
import { StatsDark } from "./components/StatsDark";
import { PricingSection } from "./components/PricingSection";
import { CompareSection } from "./components/CompareSection";
import { Testimonials } from "./components/Testimonials";
import { FaqSection } from "./components/FaqSection";
import { CtaBanner } from "./components/CtaBanner";
import { LoginForm } from "./components/LoginForm";
import { Footer } from "./components/Footer";

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

export default function LandingPage() {
  const { showForm, stats } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-white font-body text-ink antialiased overflow-x-hidden">
      <Nav />
      <Hero stats={stats} />
      <TrustMarquee />
      <WidgetShowcase />
      <SystemsCarousel />
      <HowItWorks />
      <StatsDark stats={stats} />
      <PricingSection />
      <CompareSection />
      <Testimonials />
      <FaqSection />
      <CtaBanner />
      <LoginForm showForm={showForm} />
      <Footer />
    </div>
  );
}
