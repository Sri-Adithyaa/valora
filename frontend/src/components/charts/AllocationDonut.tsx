import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartNumber, formatMoney, formatPct } from "../../lib/format";
import type { Allocation } from "../../services/types";

/** Green-anchored categorical ramp: charcoal, greens and greys keep the palette restrained. */
export const ALLOCATION_COLORS = ["#0B8A4F", "#111418", "#3FCB87", "#5F6772", "#097443", "#B7BCC3", "#86E0B2", "#2A3038", "#C3F0D8", "#8A919B"];

export function AllocationDonut({ allocation, height = 220 }: { allocation: Allocation; height?: number }) {
  const data = allocation.slices.map((s) => ({ name: s.currency.currency_code, pct: chartNumber(s.allocation_pct), slice: s }));
  const base = allocation.base_currency;
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="pct" nameKey="name" innerRadius="64%" outerRadius="94%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const s = (payload[0].payload as (typeof data)[number]).slice;
              return (
                <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-pop">
                  <p className="font-bold text-ink-900">{s.currency.currency_code} · {s.currency.currency_name}</p>
                  <p className="num mt-0.5 text-ink-600">{formatMoney(s.value, base)} · {formatPct(s.allocation_pct, { signed: false })}</p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="label">Total value</span>
        <span className="num mt-0.5 text-base font-semibold text-ink-900">{formatMoney(allocation.total_value, base)}</span>
      </div>
    </div>
  );
}
