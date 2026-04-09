import { CAR_BRANDS } from "../data/website-content";

export function TrustMarquee() {
  const doubled = [...CAR_BRANDS, ...CAR_BRANDS];
  return (
    <section className="py-14 border-y border-silver/40 overflow-hidden bg-white">
      <p className="text-center text-[13px] font-medium text-slate/50 mb-7">Trusted by parts retailers using these vehicle brands</p>
      <div className="overflow-hidden">
        <div className="marquee-track">
          {doubled.map((b, i) => <img key={`${b.name}-${i}`} src={b.logo} alt={b.name} loading="lazy" className="w-11 h-11 object-contain shrink-0 grayscale opacity-30 hover:grayscale-0 hover:opacity-100 hover:scale-110 transition-all duration-300" />)}
        </div>
      </div>
    </section>
  );
}
