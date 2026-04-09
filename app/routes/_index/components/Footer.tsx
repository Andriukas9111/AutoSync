import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { BRAND, NAVIGATION } from "../data/website-content";

export function Footer() {
  return (
    <footer className="py-20 border-t border-silver/40 bg-snow">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-14 mb-14">
          <div>
            <div className="flex items-center gap-2.5 font-heading text-xl font-extrabold text-ink mb-4"><AutoSyncLogo size={20} /> AutoSync</div>
            <p className="text-sm text-slate leading-relaxed max-w-[300px]">{BRAND.shortDescription}</p>
          </div>
          <div>
            <h4 className="font-heading text-[13px] font-bold text-ink uppercase tracking-[0.04em] mb-5">Product</h4>
            <div className="flex flex-col gap-3">{NAVIGATION.footerLinks.product.map(l=><a key={l.label} href={l.href} className="text-sm text-slate hover:text-ink transition-colors">{l.label}</a>)}</div>
          </div>
          <div>
            <h4 className="font-heading text-[13px] font-bold text-ink uppercase tracking-[0.04em] mb-5">Company</h4>
            <div className="flex flex-col gap-3">{NAVIGATION.footerLinks.company.map(l=><a key={l.label} href={l.href} className="text-sm text-slate hover:text-ink transition-colors">{l.label}</a>)}</div>
          </div>
          <div>
            <h4 className="font-heading text-[13px] font-bold text-ink uppercase tracking-[0.04em] mb-5">Legal</h4>
            <div className="flex flex-col gap-3">{NAVIGATION.footerLinks.legal.map(l=><a key={l.label} href={l.href} className="text-sm text-slate hover:text-ink transition-colors">{l.label}</a>)}</div>
          </div>
        </div>
        <div className="text-center text-[13px] text-slate/50 pt-8 border-t border-silver/40">© {new Date().getFullYear()} AutoSync. All rights reserved.</div>
      </div>
    </footer>
  );
}
