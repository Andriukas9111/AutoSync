export function CtaBanner() {
  return (
    <section className="px-6 md:px-10 mb-24">
      <div className="relative overflow-hidden rounded-card py-28 text-center gradient-cta">
        <div className="absolute inset-0 pointer-events-none dot-grid-white" />
        <div className="relative z-1">
          <h2 className="font-heading text-[clamp(32px,4.5vw,48px)] font-extrabold tracking-[-0.035em] text-white mb-4">Ready to sell more parts?</h2>
          <p className="text-lg text-white/70 mb-9 max-w-[440px] mx-auto">Join automotive stores using AutoSync for exact-fit parts discovery.</p>
          <a href="#get-started" className="inline-flex px-9 py-4 bg-white text-ink rounded-pill text-base font-semibold shadow-card hover:shadow-float hover:-translate-y-0.5 transition-all">Start Your Free Trial</a>
        </div>
      </div>
    </section>
  );
}
