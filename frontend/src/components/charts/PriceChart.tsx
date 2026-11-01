import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  TickMarkType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { chartNumber, formatDateTime, formatRate } from "../../lib/format";
import type { HistoryPoint } from "../../services/types";
import { Spinner } from "../ui/Spinner";

export type ChartMode = "line" | "candle";

interface Tip {
  x: number;
  y: number;
  time: number;
  point: HistoryPoint;
}

const THEMES = {
  dark: { bg: "#111418", text: "#8a919b", grid: "rgba(255,255,255,0.045)", border: "rgba(255,255,255,0.08)", cross: "#5f6772" },
  light: { bg: "#ffffff", text: "#5f6772", grid: "rgba(17,20,24,0.05)", border: "rgba(17,20,24,0.08)", cross: "#b7bcc3" },
};

function precisionFor(points: HistoryPoint[]): number {
  const last = points[points.length - 1]?.close;
  if (!last) return 4;
  const intPart = last.split(".")[0].replace(/^-?0+/, "");
  if (intPart.length > 0) return 4;
  const frac = last.split(".")[1] ?? "";
  const lead = frac.length - frac.replace(/^0+/, "").length;
  return Math.min(10, lead + 5);
}

/**
 * Interactive exchange-rate chart (TradingView Lightweight Charts v5) with line/candle modes and a
 * crosshair tooltip. Data are stored PostgreSQL snapshots — Number() conversion happens only here, for drawing.
 */
export function PriceChart({
  points,
  mode,
  loading = false,
  dark = true,
  height,
  emptyMessage = "No rate history is available for this range yet.",
}: {
  points: HistoryPoint[] | undefined;
  mode: ChartMode;
  loading?: boolean;
  dark?: boolean;
  /** Pixel height; omit to fill the parent. */
  height?: number;
  emptyMessage?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const byTimeRef = useRef<Map<number, HistoryPoint>>(new Map());
  const [tip, setTip] = useState<Tip | null>(null);
  const theme = dark ? THEMES.dark : THEMES.light;

  // Strictly ascending, de-duplicated timestamps (a library requirement).
  const data = useMemo(() => {
    const map = new Map<number, HistoryPoint>();
    for (const p of points ?? []) {
      const t = Math.floor(new Date(p.time).getTime() / 1000);
      if (!Number.isNaN(t)) map.set(t, p);
    }
    const times = Array.from(map.keys()).sort((a, b) => a - b);
    return { times, map };
  }, [points]);

  const precision = useMemo(() => precisionFor(points ?? []), [points]);
  const trendUp = useMemo(() => {
    const pts = points ?? [];
    if (pts.length < 2) return true;
    return chartNumber(pts[pts.length - 1].close) >= chartNumber(pts[0].open);
  }, [points]);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.text,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        // Tick marks in the viewer's local time (the library defaults to UTC).
        tickMarkFormatter: (t: Time, type: TickMarkType) => {
          const d = new Date((t as number) * 1000);
          if (type === TickMarkType.Year) return String(d.getFullYear());
          if (type === TickMarkType.Month) return d.toLocaleDateString("en-GB", { month: "short" });
          if (type === TickMarkType.DayOfMonth) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
        },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: theme.cross, labelBackgroundColor: dark ? "#2a3038" : "#3d444d" },
        horzLine: { color: theme.cross, labelBackgroundColor: dark ? "#2a3038" : "#3d444d" },
      },
      localization: {
        timeFormatter: (t: Time) => formatDateTime(new Date((t as number) * 1000).toISOString()),
      },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;

    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time === undefined || param.point.x < 0 || param.point.y < 0) {
        setTip(null);
        return;
      }
      const p = byTimeRef.current.get(param.time as number);
      if (!p) {
        setTip(null);
        return;
      }
      setTip({ x: param.point.x, y: param.point.y, time: param.time as number, point: p });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // (Re)build the series when the mode or data change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    byTimeRef.current = data.map;
    if (data.times.length === 0) return;
    const priceFormat = { type: "price" as const, precision, minMove: 1 / 10 ** precision };
    const up = "#10B266";
    const down = "#E5534B";
    if (mode === "candle") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
        priceFormat,
      });
      s.setData(
        data.times.map((t) => {
          const p = data.map.get(t)!;
          return {
            time: t as UTCTimestamp,
            open: chartNumber(p.open),
            high: chartNumber(p.high),
            low: chartNumber(p.low),
            close: chartNumber(p.close),
          };
        }),
      );
      seriesRef.current = s as unknown as ISeriesApi<SeriesType>;
    } else {
      const line = trendUp ? up : down;
      const s = chart.addSeries(AreaSeries, {
        lineColor: line,
        lineWidth: 2,
        topColor: trendUp ? "rgba(16,178,102,0.28)" : "rgba(229,83,75,0.24)",
        bottomColor: trendUp ? "rgba(16,178,102,0.0)" : "rgba(229,83,75,0.0)",
        priceFormat,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: dark ? "#111418" : "#ffffff",
        crosshairMarkerBackgroundColor: line,
      });
      s.setData(data.times.map((t) => ({ time: t as UTCTimestamp, value: chartNumber(data.map.get(t)!.close) })));
      seriesRef.current = s as unknown as ISeriesApi<SeriesType>;
    }
    chart.timeScale().fitContent();
  }, [data, mode, precision, trendUp, dark]);

  const empty = !loading && data.times.length === 0;
  const tipLeft = tip && containerRef.current ? Math.min(Math.max(tip.x + 14, 8), containerRef.current.clientWidth - 200) : 0;

  return (
    <div className="relative w-full" style={{ height: height ?? "100%" }}>
      <div ref={containerRef} className="absolute inset-0" aria-label="Exchange-rate chart" role="img" />
      {tip && (
        <div
          className={`pointer-events-none absolute z-10 min-w-[170px] rounded-lg border px-3 py-2 text-xs shadow-pop ${dark ? "border-white/10 bg-ink-800/95 text-ink-200" : "border-ink-200 bg-white/95 text-ink-700"}`}
          style={{ left: tipLeft, top: Math.max(8, tip.y - 70) }}
        >
          <p className={`mb-1 font-semibold ${dark ? "text-ink-300" : "text-ink-500"}`}>{formatDateTime(tip.point.time)}</p>
          {mode === "candle" ? (
            <div className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span>O</span><span className="text-right">{formatRate(tip.point.open)}</span>
              <span>H</span><span className="text-right">{formatRate(tip.point.high)}</span>
              <span>L</span><span className="text-right">{formatRate(tip.point.low)}</span>
              <span>C</span><span className={`text-right font-semibold ${dark ? "text-white" : "text-ink-900"}`}>{formatRate(tip.point.close)}</span>
            </div>
          ) : (
            <p className={`num text-sm font-semibold ${dark ? "text-white" : "text-ink-900"}`}>{formatRate(tip.point.close)}</p>
          )}
          {tip.point.simulated && <p className="mt-1 text-[10px] font-semibold tracking-wide text-warn uppercase">Simulated history</p>}
        </div>
      )}
      {loading && (
        <div className={`absolute inset-0 flex items-center justify-center ${dark ? "bg-ink-900/60 text-money-400" : "bg-white/60 text-money-600"}`}>
          <Spinner className="h-6 w-6" label="Loading chart" />
        </div>
      )}
      {empty && (
        <div className={`absolute inset-0 flex items-center justify-center px-6 text-center text-sm ${dark ? "text-ink-400" : "text-ink-500"}`}>
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
