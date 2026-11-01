import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartNumber, formatDateTime, formatMoney } from "../../lib/format";
import type { Currency, PerformancePoint } from "../../services/types";

interface Row {
  t: number;
  value: number;
  invested: number;
  raw: PerformancePoint;
}

/** Axis labels: full grouped numbers for normal portfolio sizes (avoids "1L, 1L" duplicates on narrow ranges). */
function axisLabel(v: number, code: string): string {
  const locale = code === "INR" ? "en-IN" : "en-US";
  if (Math.abs(v) >= 10_000_000) return new Intl.NumberFormat(locale, { notation: "compact", maximumSignificantDigits: 4 }).format(v);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }).format(v);
}

/** Portfolio value vs. invested capital over time (Recharts). */
export function PerformanceChart({ points, currency, height = 260 }: { points: PerformancePoint[]; currency: Currency; height?: number }) {
  const rows: Row[] = useMemo(
    () => points.map((p) => ({ t: new Date(p.time).getTime(), value: chartNumber(p.value), invested: chartNumber(p.invested), raw: p })),
    [points],
  );
  const spanMs = rows.length > 1 ? rows[rows.length - 1].t - rows[0].t : 0;
  const tickFmt = (t: number) => {
    const d = new Date(t);
    if (spanMs <= 2 * 86_400_000) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (spanMs <= 120 * 86_400_000) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  };

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B266" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#10B266" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eceee9" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={tickFmt}
            tick={{ fontSize: 11, fill: "#8a919b", fontFamily: "JetBrains Mono" }}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => axisLabel(v, currency.currency_code)}
            tick={{ fontSize: 11, fill: "#8a919b", fontFamily: "JetBrains Mono" }}
            axisLine={false}
            tickLine={false}
            width={76}
          />
          <Tooltip
            cursor={{ stroke: "#b7bcc3", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = (payload[0].payload as Row).raw;
              return (
                <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-pop">
                  <p className="mb-1 font-semibold text-ink-500">{formatDateTime(r.time)}</p>
                  <p className="num flex justify-between gap-4"><span className="text-ink-500">Value</span><span className="font-semibold text-ink-900">{formatMoney(r.value, currency)}</span></p>
                  <p className="num flex justify-between gap-4"><span className="text-ink-500">Invested</span><span>{formatMoney(r.invested, currency)}</span></p>
                  <p className="num flex justify-between gap-4"><span className="text-ink-500">P&amp;L</span><span className={r.pnl.startsWith("-") ? "text-loss" : "text-gain"}>{formatMoney(r.pnl, currency, { signed: true })}</span></p>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="value" name="Portfolio value" stroke="#0B8A4F" strokeWidth={2} fill="url(#perfFill)" isAnimationActive={false} />
          <Line type="stepAfter" dataKey="invested" name="Invested (funded)" stroke="#8a919b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-ink-500">
      <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-money-600" /> Portfolio value</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-[1.5px] border-dashed border-ink-400" /> Invested (virtual funding)</span>
    </div>
  );
}
