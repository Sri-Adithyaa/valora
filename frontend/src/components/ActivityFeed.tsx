import { Link } from "react-router-dom";
import { useNow } from "../hooks/useNow";
import { relativeTime } from "../lib/format";
import type { Activity } from "../services/types";
import { Pill } from "./ui/Display";
import { Icon, type IconName } from "./ui/Icon";

function meta(a: Activity): { icon: IconName; tone: string; pill: "green" | "amber" | "red" | "neutral" | "dark" } {
  if (a.kind === "FUNDING") return { icon: "wallet", tone: "bg-money-100 text-money-700", pill: "green" };
  if (a.kind === "QUOTE") return { icon: "clock", tone: "bg-warn-50 text-warn", pill: a.status === "EXPIRED" ? "amber" : "neutral" };
  const sold = a.title.startsWith("Sold");
  return { icon: sold ? "arrow-up-right" : "swap-h", tone: sold ? "bg-ink-100 text-ink-700" : "bg-money-50 text-money-700", pill: "neutral" };
}

/** Recent trades, funding entries and expired/cancelled quotes (GET /api/wallet/activity). */
export function ActivityFeed({ items }: { items: Activity[] }) {
  const now = useNow(30_000);
  return (
    <ol className="divide-y divide-ink-100">
      {items.map((a) => {
        const m = meta(a);
        const body = (
          <div className="flex items-start gap-3 px-5 py-3">
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.tone}`}>
              <Icon name={m.icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-ink-900">{a.title}</p>
                {a.kind !== "TRADE" && <Pill tone={m.pill}>{a.kind === "FUNDING" ? "Virtual funds" : a.status}</Pill>}
              </div>
              <p className="num mt-0.5 truncate text-xs text-ink-500">{a.description}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium text-ink-400">{relativeTime(a.occurred_at, new Date(now))}</p>
              <p className="num mt-0.5 hidden text-[11px] text-ink-400 sm:block">{a.id}</p>
            </div>
          </div>
        );
        return (
          <li key={`${a.kind}-${a.id}`}>
            {a.link && a.link.startsWith("/") ? (
              <Link to={a.link} className="block hover:bg-ink-50/70">{body}</Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
