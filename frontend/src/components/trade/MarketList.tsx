import { useState } from "react";
import { useRates, useToggleFavourite } from "../../hooks/useMarket";
import { useDebounced } from "../../hooks/useDebounced";
import { formatRate } from "../../lib/format";
import { errorMessage } from "../../services/api";
import type { Rate } from "../../services/types";
import { Segmented, TrendPct } from "../ui/Display";
import { Icon } from "../ui/Icon";
import { useToast } from "../ui/Toast";

export function FavouriteStar({ rate, className = "" }: { rate: Pick<Rate, "pair_id" | "symbol" | "is_favourite">; className?: string }) {
  const toggle = useToggleFavourite();
  const toast = useToast();
  const fav = toggle.isPending ? !rate.is_favourite : rate.is_favourite;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(
          { pairId: rate.pair_id, favourite: !rate.is_favourite },
          { onError: (er) => toast.push({ kind: "error", title: "Couldn't update favourites", message: errorMessage(er) }) },
        );
      }}
      aria-pressed={fav}
      aria-label={fav ? `Remove ${rate.symbol} from favourites` : `Add ${rate.symbol} to favourites`}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-ink-100 ${fav ? "text-[#d9a514]" : "text-ink-300 hover:text-ink-500"} ${className}`}
    >
      <Icon name="star" className="h-4 w-4" filled={fav} strokeWidth={1.6} />
    </button>
  );
}

/** Trade page left rail: pair search (code, name, country), favourites and the market list. */
export function MarketList({ activePairId, onSelect }: { activePairId?: number; onSelect: (r: Rate) => void }) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "fav">("all");
  const debounced = useDebounced(search.trim(), 250);
  const { data, isLoading, isError, error } = useRates(debounced, false);
  const rows = (data ?? []).filter((r) => (tab === "fav" ? r.is_favourite : true));

  return (
    <section aria-label="Markets" className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="space-y-3 border-b border-ink-100 p-3">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <label htmlFor="pair-search" className="sr-only">Search pairs by code, currency name or country</label>
          <input
            id="pair-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search USD, Euro, Japan…"
            className="input h-9 pl-9 text-[13px]"
          />
        </div>
        <Segmented
          label="Market list filter"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "All pairs" },
            { value: "fav", label: <><Icon name="star" className="h-3.5 w-3.5" /> Favourites</> },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
        ) : isError ? (
          <p className="p-4 text-sm text-loss">{errorMessage(error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-ink-500">
            {tab === "fav" ? "No favourites yet — tap the star on any pair." : `No pairs match “${search}”.`}
          </p>
        ) : (
          <ul>
            {rows.map((r) => {
              const active = r.pair_id === activePairId;
              return (
                <li key={r.pair_id} className={`flex items-center gap-1 border-l-2 pr-3 pl-1 ${active ? "border-money-600 bg-money-50/70" : "border-transparent hover:bg-ink-50"}`}>
                  <FavouriteStar rate={r} />
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    aria-current={active ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold text-ink-900">{r.symbol}</span>
                      <span className="block truncate text-[11px] text-ink-500">{r.base.currency_name}</span>
                    </span>
                    <span className="text-right">
                      <span className="num block text-[13px] text-ink-900">{formatRate(r.rate)}</span>
                      <TrendPct value={r.change_pct} className="block text-[11px]" showArrow={false} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
