import { useState } from "react";
import { Form } from "react-router";
import { AutoSyncLogo } from "./icons/AutoSyncLogo";

export function LoginForm({ showForm }: { showForm: boolean }) {
  const [shop, setShop] = useState("");

  return (
    <section id="get-started" className="tw-py-20">
      <div className="tw-max-w-[460px] tw-mx-auto tw-px-6 tw-text-center">
        <AutoSyncLogo size={48} className="tw-text-ink tw-mx-auto" />
        <div className="tw-font-heading tw-text-2xl tw-font-extrabold tw-text-ink tw-mt-4 tw-mb-2 tw-tracking-[-0.02em]">
          AutoSync
        </div>
        <p className="tw-text-[15px] tw-text-slate tw-mb-7">
          Enter your Shopify store domain to get started
        </p>

        {showForm && (
          <Form method="post" action="/auth/login">
            <div className="tw-flex tw-gap-2.5">
              <input
                name="shop"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="tw-flex-1 tw-px-6 tw-py-4 tw-border-[1.5px] tw-border-silver/60 tw-rounded-pill tw-bg-white tw-text-ink tw-text-[15px] tw-font-body tw-outline-none focus:tw-border-accent focus:tw-shadow-[0_0_0_3px_rgba(0,153,255,0.1)] placeholder:tw-text-slate/40"
              />
              <button
                type="submit"
                className="tw-px-7 tw-py-4 tw-bg-accent tw-text-white tw-rounded-pill tw-text-sm tw-font-semibold hover:tw-bg-accent-deep tw-transition-colors tw-cursor-pointer"
              >
                Install
              </button>
            </div>
          </Form>
        )}
      </div>
    </section>
  );
}
