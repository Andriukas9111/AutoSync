import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return { showForm: Boolean(login) };
};

export default function LandingPage() {
  const { showForm } = useLoaderData<typeof loader>();
  const [shop, setShop] = useState("");
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>AutoSync</h1>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>Website rebuild in progress</p>
        {showForm && <Form method="post" action="/auth/login"><div style={{ display: "flex", gap: 8 }}><input name="shop" placeholder="your-store.myshopify.com" value={shop} onChange={e => setShop(e.target.value)} style={{ padding: "12px 16px", border: "1px solid #ddd", borderRadius: 999, fontSize: 14, width: 280 }}/><button type="submit" style={{ padding: "12px 24px", background: "#000", color: "#fff", border: "none", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Install</button></div></Form>}
      </div>
    </div>
  );
}
