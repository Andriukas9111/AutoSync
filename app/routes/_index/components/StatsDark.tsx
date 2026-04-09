import { useCounter } from "../hooks/useCounter";

function Counter({ end, label }: { end: number; label: string }) {
  const { value, ref } = useCounter(end, 1400);
  return <div ref={ref} className="text-center"><div className="font-heading text-[clamp(36px,5vw,56px)] font-extrabold tracking-[-0.03em] text-white">{value.toLocaleString()}+</div><div className="text-[13px] font-medium text-white/40 uppercase tracking-[0.06em] mt-1">{label}</div></div>;
}

export function StatsDark({ stats }: { stats: { makes: number; models: number; engines: number; specs: number } }) {
  return (
    <section className="bg-ink py-20">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="flex justify-center gap-[clamp(32px,8vw,80px)] flex-wrap">
          <Counter end={stats.makes} label="Vehicle Makes" />
          <Counter end={stats.models} label="Models" />
          <Counter end={stats.engines} label="Engines" />
          <Counter end={stats.specs} label="Vehicle Specs" />
        </div>
      </div>
    </section>
  );
}
