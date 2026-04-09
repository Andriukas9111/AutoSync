export function CtaBanner() {
  return (
    <section className="tw-px-6 md:tw-px-10 tw-mb-24">
      <div
        className="tw-relative tw-overflow-hidden tw-rounded-card tw-py-28 tw-text-center"
        style={{
          background: "linear-gradient(135deg, #003d99 0%, #0099FF 50%, #6B52D9 100%)",
        }}
      >
        {/* Dot grid overlay */}
        <div
          className="tw-absolute tw-inset-0 tw-pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />

        <div className="tw-relative tw-z-10">
          <h2 className="tw-font-heading tw-text-[clamp(32px,4.5vw,48px)] tw-font-extrabold tw-tracking-[-0.035em] tw-text-white tw-mb-4">
            Ready to sell more parts?
          </h2>
          <p className="tw-text-lg tw-text-white/70 tw-mb-9 tw-max-w-[440px] tw-mx-auto">
            Join automotive stores using AutoSync for exact-fit parts discovery.
          </p>
          <a
            href="#get-started"
            className="tw-inline-flex tw-px-9 tw-py-4 tw-bg-white tw-text-ink tw-rounded-pill tw-text-base tw-font-semibold tw-shadow-sm hover:tw-shadow-md hover:tw--translate-y-0.5 tw-transition-all tw-duration-200"
          >
            Start Your Free Trial
          </a>
        </div>
      </div>
    </section>
  );
}
