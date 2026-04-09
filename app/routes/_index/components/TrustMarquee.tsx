import { CAR_BRANDS } from "../data/website-content";

export function TrustMarquee() {
  // Double the array for seamless infinite scroll
  const doubled = [...CAR_BRANDS, ...CAR_BRANDS];

  return (
    <section className="tw-py-14 tw-border-y tw-border-silver/40 tw-overflow-hidden tw-bg-white">
      <p className="tw-text-center tw-text-[13px] tw-font-medium tw-text-slate/50 tw-mb-7">
        Trusted by parts retailers using these vehicle brands
      </p>

      <div className="tw-overflow-hidden">
        <div
          className="tw-flex tw-gap-14"
          style={{
            width: "max-content",
            animation: "marquee 25s linear infinite",
          }}
        >
          {doubled.map((brand, i) => (
            <img
              key={`${brand.name}-${i}`}
              src={brand.logo}
              alt={brand.name}
              loading="lazy"
              className="tw-w-11 tw-h-11 tw-object-contain tw-shrink-0 tw-grayscale tw-opacity-30 hover:tw-grayscale-0 hover:tw-opacity-100 hover:tw-scale-110 tw-transition-all tw-duration-300"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
