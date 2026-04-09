import { AutoSyncLogo } from "./icons/AutoSyncLogo";
import { BRAND, NAVIGATION } from "../data/website-content";

export function Footer() {
  return (
    <footer className="tw-py-20 tw-border-t tw-border-silver/40 tw-bg-snow">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 lg:tw-grid-cols-4 tw-gap-14 tw-mb-14">
          {/* Brand */}
          <div>
            <div className="tw-flex tw-items-center tw-gap-2.5 tw-font-heading tw-text-xl tw-font-extrabold tw-text-ink tw-mb-4">
              <AutoSyncLogo size={20} className="tw-text-ink" />
              AutoSync
            </div>
            <p className="tw-text-sm tw-text-slate tw-leading-relaxed tw-max-w-[300px]">
              {BRAND.shortDescription}
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="tw-font-heading tw-text-[13px] tw-font-bold tw-text-ink tw-uppercase tw-tracking-[0.04em] tw-mb-5">
              Product
            </h4>
            <div className="tw-flex tw-flex-col tw-gap-3">
              {NAVIGATION.footerLinks.product.map((link) => (
                <a key={link.label} href={link.href} className="tw-text-sm tw-text-slate hover:tw-text-ink tw-transition-colors tw-duration-150">
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="tw-font-heading tw-text-[13px] tw-font-bold tw-text-ink tw-uppercase tw-tracking-[0.04em] tw-mb-5">
              Company
            </h4>
            <div className="tw-flex tw-flex-col tw-gap-3">
              {NAVIGATION.footerLinks.company.map((link) => (
                <a key={link.label} href={link.href} className="tw-text-sm tw-text-slate hover:tw-text-ink tw-transition-colors tw-duration-150">
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="tw-font-heading tw-text-[13px] tw-font-bold tw-text-ink tw-uppercase tw-tracking-[0.04em] tw-mb-5">
              Legal
            </h4>
            <div className="tw-flex tw-flex-col tw-gap-3">
              {NAVIGATION.footerLinks.legal.map((link) => (
                <a key={link.label} href={link.href} className="tw-text-sm tw-text-slate hover:tw-text-ink tw-transition-colors tw-duration-150">
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="tw-text-center tw-text-[13px] tw-text-slate/50 tw-pt-8 tw-border-t tw-border-silver/40">
          © {new Date().getFullYear()} AutoSync. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
