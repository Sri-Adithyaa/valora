import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MarketList } from "../components/trade/MarketList";
import { OrderPanel } from "../components/trade/OrderPanel";
import { PairChartPanel } from "../components/trade/PairChartPanel";
import { useMe } from "../hooks/useAuth";
import { useCurrencies, usePairLookup, useRates } from "../hooks/useMarket";
import { useHoldings } from "../hooks/useWallet";
import { directionForPair } from "../lib/trade";
import type { Rate } from "../services/types";

const CODE_RE = /^[A-Z]{3}$/;

export default function TradePage() {
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const { data: currencies } = useCurrencies();
  const { data: holdings } = useHoldings();
  const { data: allRates } = useRates("", false);

  const base = me?.wallet?.base_currency.currency_code ?? me?.user.base_currency.currency_code ?? "INR";
  const qFrom = (params.get("from") ?? "").toUpperCase();
  const qTo = (params.get("to") ?? "").toUpperCase();
  const from = CODE_RE.test(qFrom) ? qFrom : base;
  const defaultTo = from === "USD" ? "EUR" : "USD";
  const to = CODE_RE.test(qTo) && qTo !== from ? qTo : defaultTo;

  // Normalise the URL so links, refreshes and the back button all reflect the current pair.
  useEffect(() => {
    if (params.get("from") !== from || params.get("to") !== to) {
      setParams({ from, to }, { replace: true });
    }
  }, [from, to, params, setParams]);

  const setPair = ({ from: f, to: t }: { from: string; to: string }) => setParams({ from: f, to: t });

  const lookup = usePairLookup(from, to);
  const pair = lookup.data;
  const rate = useMemo(() => allRates?.find((r) => r.pair_id === pair?.pair_id), [allRates, pair]);
  const fromCur = currencies?.find((c) => c.currency_code === from);
  const toCur = currencies?.find((c) => c.currency_code === to);

  const held = useMemo(() => new Set((holdings ?? []).map((h) => h.currency.currency_code)), [holdings]);
  const onSelectPair = (r: Rate) => setPair(directionForPair(r, held, from));

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_360px] xl:grid-cols-[280px_minmax(0,1fr)_380px]">
      <div className="order-1 h-72 lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
        <MarketList activePairId={pair?.pair_id} onSelect={onSelectPair} />
      </div>
      <div className="order-2 min-w-0 space-y-4">
        <PairChartPanel from={fromCur} to={toCur} pair={pair} rate={rate} pairLoading={lookup.isLoading} pairError={lookup.error} />
        <HowItWorks from={from} to={to} />
      </div>
      <div className="order-3 lg:sticky lg:top-20 lg:self-start">
        <OrderPanel from={from} to={to} onChange={setPair} />
      </div>
    </div>
  );
}

function HowItWorks({ from, to }: { from: string; to: string }) {
  return (
    <div className="card hidden gap-4 p-4 text-[13px] text-ink-600 sm:p-5 lg:grid lg:grid-cols-3">
      <div>
        <p className="font-bold text-ink-900">1 · Quote</p>
        <p className="mt-1">The server locks the latest stored {from}/{to} rate, spread and fee for 30 seconds.</p>
      </div>
      <div>
        <p className="font-bold text-ink-900">2 · Confirm</p>
        <p className="mt-1"><span className="font-semibold text-loss">{from}</span> is debited (amount + fee) and <span className="font-semibold text-money-700">{to}</span> is credited — atomically.</p>
      </div>
      <div>
        <p className="font-bold text-ink-900">3 · Hold or trade on</p>
        <p className="mt-1">{to} becomes a holding you can spend directly on any other currency.</p>
      </div>
    </div>
  );
}
