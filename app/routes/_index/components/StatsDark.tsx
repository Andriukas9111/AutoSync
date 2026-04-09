import { useCounter } from "../hooks/useCounter";

function Counter({ end, label }: { end: number; label: string }) {
  const { value, ref } = useCounter(end, 1400);
  return (
    <div ref={ref} className="tw-text-center">
      <div className="tw-font-heading tw-text-[clamp(36px,5vw,56px)] tw-font-extrabold tw-tracking-[-0.03em] tw-text-white">
        {value.toLocaleString()}+
      </div>
      <div className="tw-text-[13px] tw-font-medium tw-text-white/40 tw-uppercase tw-tracking-[0.06em] tw-mt-1">
        {label}
      </div>
    </div>
  );
}

export function StatsDark({ stats }: { stats: { makes: number; models: number; engines: number; specs: number } }) {
  return (
    <section className="tw-bg-ink tw-py-20">
      <div className="tw-max-w-[1240px] tw-mx-auto tw-px-6 md:tw-px-10">
        <div className="tw-flex tw-justify-center tw-gap-[clamp(32px,8vw,80px)] tw-flex-wrap">
          <Counter end={stats.makes} label="Vehicle Makes" />
          <Counter end={stats.models} label="Models" />
          <Counter end={stats.engines} label="Engines" />
          <Counter end={stats.specs} label="Vehicle Specs" />
        </div>
      </div>
    </section>
  );
}
