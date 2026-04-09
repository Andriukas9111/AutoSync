import { useState } from "react";
import { Form } from "react-router";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";

export function LoginForm({ showForm }: { showForm: boolean }) {
  const [shop, setShop] = useState("");
  return (
    <section id="get-started" className="py-20">
      <div className="max-w-[460px] mx-auto px-6 text-center">
        <AutoSyncLogo size={48} className="mx-auto text-ink" />
        <div className="font-heading text-2xl font-extrabold text-ink mt-4 mb-2 tracking-[-0.02em]">AutoSync</div>
        <p className="text-[15px] text-slate mb-7">Enter your Shopify store domain to get started</p>
        {showForm && <Form method="post" action="/auth/login"><div className="flex gap-2.5"><input name="shop" value={shop} onChange={e=>setShop(e.target.value)} placeholder="your-store.myshopify.com" className="flex-1 px-6 py-4 border-[1.5px] border-silver/60 rounded-pill bg-white text-ink text-[15px] outline-none focus:border-accent" style={{ boxShadow: "none" }} /><button type="submit" className="px-7 py-4 bg-accent text-white rounded-pill text-sm font-semibold hover:bg-accent-deep transition-colors cursor-pointer">Install</button></div></Form>}
      </div>
    </section>
  );
}
