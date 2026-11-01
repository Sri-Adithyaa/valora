import { useMarketStatus } from "../../hooks/useMarket";
import { useNow } from "../../hooks/useNow";
import { formatDateTime, relativeTime } from "../../lib/format";
import { Icon } from "../ui/Icon";

const META: Record<string, { label: string; dot: string; text: string; ring: string }> = {
  LIVE: { label: "Live", dot: "bg-money-500", text: "text-money-700", ring: "bg-money-500/40" },
  DELAYED: { label: "Delayed", dot: "bg-warn", text: "text-warn", ring: "" },
  STALE: { label: "Stale", dot: "bg-loss", text: "text-loss", ring: "" },
  UNAVAILABLE: { label: "Unavailable", dot: "bg-loss", text: "text-loss", ring: "" },
};

export function statusMeta(status: string | undefined) {
  return META[status ?? ""] ?? { label: "Checking", dot: "bg-ink-300", text: "text-ink-500", ring: "" };
}

/** Top-bar pill: green Live / amber Delayed / red Stale, with the last update time. Never claims real-time ticks. */
export function MarketStatusPill({ dark = false }: { dark?: boolean }) {
  const { data, isError } = useMarketStatus();
  const now = useNow(20_000);
  const m = isError ? META.UNAVAILABLE : statusMeta(data?.status);
  const updated = data?.last_updated_at ? relativeTime(data.last_updated_at, new Date(now)) : null;
  const title = data
    ? `${data.message} Last update ${formatDateTime(data.last_updated_at, true)}${data.provider ? ` · source: ${data.provider}` : ""}. Rates refresh about every ${Math.round(data.update_interval_seconds / 60)} min.${data.fx_session === "CLOSED" ? " FX markets are closed (weekend)." : ""}`
    : "Checking market data status";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${dark ? "border-white/10 bg-white/5 text-ink-200" : "border-ink-200 bg-white text-ink-700"}`}
      title={title}
      aria-label={`Market data ${m.label}${updated ? `, updated ${updated}` : ""}`}
      role="status"
    >
      <span className="relative flex h-2 w-2">
        {m.ring && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${m.ring}`} style={{ animationDuration: "2.4s" }} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${m.dot}`} />
      </span>
      <span className={dark ? "text-white" : m.text}>{m.label}</span>
      {updated && <span className={`hidden font-medium sm:inline ${dark ? "text-ink-300" : "text-ink-500"}`}>· {updated}</span>}
      {data?.fx_session === "CLOSED" && (
        <span className={`hidden font-medium xl:inline ${dark ? "text-ink-300" : "text-ink-500"}`}>· FX weekend</span>
      )}
    </div>
  );
}

/** Warning banner shown on every page while market data is STALE or UNAVAILABLE. */
export function StaleDataBanner() {
  const { data } = useMarketStatus();
  if (!data || (data.status !== "STALE" && data.status !== "UNAVAILABLE")) return null;
  return (
    <div role="alert" className="border-b border-loss/20 bg-loss-50">
      <div className="mx-auto flex max-w-[1400px] items-start gap-2.5 px-4 py-2.5 text-sm text-loss sm:px-6">
        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong className="font-semibold">Market data is {data.status === "STALE" ? "stale" : "unavailable"}.</strong>{" "}
          {data.message} Rates shown are the last valid snapshot
          {data.last_updated_at ? ` from ${formatDateTime(data.last_updated_at)}` : ""} and are not live. New quotes may be refused until the feed recovers.
        </p>
      </div>
    </div>
  );
}
