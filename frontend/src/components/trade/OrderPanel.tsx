import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCurrencies } from "../../hooks/useMarket";
import { useExecuteMutation, useQuoteMutation } from "../../hooks/useTrade";
import { useHoldings } from "../../hooks/useWallet";
import { formatMoney, validateAmountInput } from "../../lib/format";
import { tradeErrorMessage } from "../../lib/trade";
import { newIdempotencyKey } from "../../services/api";
import type { AmountType, Currency, ExecuteResult, Holding, Quote } from "../../services/types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { QuoteSummary } from "./QuoteSummary";

/** Wall-clock deadline for a quote, anchored to when it was received (robust to client clock skew). */
function quoteDeadline(q: Quote, receivedAt: number): number {
  const span = new Date(q.expires_at).getTime() - new Date(q.created_at).getTime();
  const validity = Number.isFinite(span) && span > 0 ? span : q.validity_seconds * 1000;
  return receivedAt + validity;
}

function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function CurrencySelect({
  id,
  label,
  value,
  onChange,
  currencies,
  holdings,
  showBalances,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  currencies: Currency[];
  holdings: Holding[];
  showBalances: boolean;
}) {
  const held = new Map(holdings.map((h) => [h.currency.currency_code, h]));
  const heldList = currencies.filter((c) => held.has(c.currency_code));
  const otherList = currencies.filter((c) => !held.has(c.currency_code));
  const opt = (c: Currency) => {
    const h = held.get(c.currency_code);
    // Held currencies lead with the balance (what matters when choosing what to spend).
    const text = showBalances
      ? h
        ? `${c.currency_code} · ${formatMoney(h.quantity, c)} available`
        : `${c.currency_code} — ${c.currency_name} (not held)`
      : `${c.currency_code} — ${c.currency_name}`;
    return (
      <option key={c.currency_code} value={c.currency_code}>
        {text}
      </option>
    );
  };
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input h-11 appearance-none truncate pr-3 text-[15px] font-bold"
      >
        {!currencies.some((c) => c.currency_code === value) && <option value={value}>{value}</option>}
        {showBalances ? (
          <>
            {heldList.length > 0 && <optgroup label="In your wallet">{heldList.map(opt)}</optgroup>}
            {otherList.length > 0 && <optgroup label="Not held">{otherList.map(opt)}</optgroup>}
          </>
        ) : (
          currencies.map(opt)
        )}
      </select>
    </div>
  );
}

export interface OrderPanelProps {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}

/**
 * The buy / sell-exchange order ticket: currency selectors with swap, amount entry, a locked quote with a
 * visible expiry countdown, a confirmation dialog stating exactly what is debited and credited, and the result.
 * Every number shown comes from the backend.
 */
export function OrderPanel({ from, to, onChange }: OrderPanelProps) {
  const { data: currencies = [] } = useCurrencies();
  const { data: holdings = [] } = useHoldings();
  const quoteM = useQuoteMutation();
  const execM = useExecuteMutation();
  const toast = useToast();

  const [amountType, setAmountType] = useState<AmountType>("TARGET");
  const [amount, setAmount] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idemKey, setIdemKey] = useState<string>("");
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [execError, setExecError] = useState<{ title: string; message: string } | null>(null);

  const secondsLeft = useCountdown(quote ? deadline : null);
  const expired = Boolean(quote) && secondsLeft <= 0;

  const fromCur = currencies.find((c) => c.currency_code === from);
  const toCur = currencies.find((c) => c.currency_code === to);
  const fromHolding = holdings.find((h) => h.currency.currency_code === from);
  const inputCur = amountType === "TARGET" ? toCur : fromCur;
  const inputCode = amountType === "TARGET" ? to : from;

  // Any change to the order invalidates the current quote.
  const clearQuote = () => {
    setQuote(null);
    setDeadline(null);
    setExecError(null);
    quoteM.reset();
  };
  useEffect(() => {
    clearQuote();
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, amountType]);

  const setFrom = (code: string) => (code === to ? onChange({ from: code, to: from }) : onChange({ from: code, to }));
  const setTo = (code: string) => (code === from ? onChange({ from: to, to: code }) : onChange({ from, to: code }));
  const swap = () => onChange({ from: to, to: from });

  const requestQuote = (e?: FormEvent) => {
    e?.preventDefault();
    const err = validateAmountInput(amount, inputCur?.decimals ?? 2);
    setInputError(err);
    if (err) return;
    setResult(null);
    setExecError(null);
    quoteM.mutate(
      { from_currency: from, to_currency: to, amount: amount.trim(), amount_type: amountType },
      {
        onSuccess: (q) => {
          setQuote(q);
          setDeadline(quoteDeadline(q, Date.now()));
        },
        onError: (er) => {
          setQuote(null);
          setDeadline(null);
          const m = tradeErrorMessage(er);
          toast.push({ kind: "error", title: m.title, message: m.message });
        },
      },
    );
  };

  const openConfirm = () => {
    if (!quote || expired) return;
    setIdemKey(newIdempotencyKey()); // one key per confirmation attempt
    setExecError(null);
    setConfirmOpen(true);
  };

  const execute = () => {
    if (!quote || expired) return;
    execM.mutate(
      { quoteId: quote.quote_id, idempotencyKey: idemKey },
      {
        onSuccess: (res) => {
          setConfirmOpen(false);
          setResult(res);
          setQuote(null);
          setDeadline(null);
          setAmount("");
          toast.push({
            kind: "success",
            title: `Trade ${res.trade.trade_reference} completed`,
            message: `${formatMoney(res.trade.from_amount, res.trade.from_currency, { code: true })} → ${formatMoney(res.trade.to_amount, res.trade.to_currency, { code: true })}`,
            link: { to: `/transactions/${res.trade.trade_id}`, label: "View transaction" },
          });
        },
        onError: (er) => {
          const m = tradeErrorMessage(er);
          setExecError(m);
          toast.push({ kind: "error", title: m.title, message: m.message });
          setConfirmOpen(false);
          // The quote can't be reused after these failures.
          setQuote(null);
          setDeadline(null);
        },
      },
    );
  };

  const resultHoldings = useMemo(() => {
    if (!result) return [];
    const codes = [result.trade.from_currency.currency_code, result.trade.to_currency.currency_code];
    return codes.map((c) => ({ code: c, holding: result.holdings.find((h) => h.currency.currency_code === c) }));
  }, [result]);

  const buyLabel = `Buy ${to}`;
  const sellLabel = `Sell / Exchange ${from}`;

  return (
    <section aria-labelledby="order-title" className="card overflow-hidden">
      <div className="border-b border-ink-100 px-4 pt-4 pb-3 sm:px-5">
        <h2 id="order-title" className="text-[15px] font-bold tracking-tight text-ink-900">Place an order</h2>
        <p className="mt-0.5 text-xs text-ink-500">Quotes lock the rate for 30 seconds. Fees are shown before you confirm.</p>
      </div>

      <form onSubmit={requestQuote} className="space-y-4 px-4 py-4 sm:px-5" noValidate>
        {/* side toggle */}
        <div role="radiogroup" aria-label="Order type" className="grid grid-cols-2 gap-1 rounded-lg bg-ink-100 p-1">
          {([
            { v: "TARGET" as const, label: buyLabel, tone: "bg-money-600 text-white" },
            { v: "SOURCE" as const, label: sellLabel, tone: "bg-ink-900 text-white" },
          ]).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={amountType === o.v}
              onClick={() => setAmountType(o.v)}
              className={`truncate rounded-md px-2 py-2 text-[13px] font-bold transition-colors ${amountType === o.v ? o.tone : "text-ink-600 hover:text-ink-900"}`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* currencies */}
        <div className="flex items-end gap-2">
          <CurrencySelect id="from-currency" label="From (you pay)" value={from} onChange={setFrom} currencies={currencies} holdings={holdings} showBalances />
          <button
            type="button"
            onClick={swap}
            className="mb-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 transition hover:rotate-180 hover:border-money-500 hover:text-money-700"
            aria-label={`Swap currencies: make ${to} the source and ${from} the target`}
            title="Swap FROM and TO"
          >
            <Icon name="swap-h" className="h-4 w-4" />
          </button>
          <CurrencySelect id="to-currency" label="To (you receive)" value={to} onChange={setTo} currencies={currencies} holdings={holdings} showBalances={false} />
        </div>
        <p className="-mt-2 text-xs text-ink-500" data-testid="available-balance">
          Available {from}: <span className="num font-semibold text-ink-800">{fromHolding ? formatMoney(fromHolding.quantity, fromHolding.currency, { code: true }) : `0 ${from}`}</span>
        </p>

        {/* amount */}
        <div>
          <label htmlFor="order-amount" className="label mb-1.5 block">
            {amountType === "TARGET" ? `Amount of ${to} to buy` : `Amount of ${from} to exchange`}
          </label>
          <div className="relative">
            <input
              id="order-amount"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/,/g, ""));
                setInputError(null);
                if (quote) clearQuote();
              }}
              placeholder={inputCur?.decimals === 0 ? "0" : "0.00"}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? "order-amount-error" : undefined}
              className="input num h-12 pr-16 text-lg font-semibold"
            />
            <span className="num pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-ink-500">{inputCode}</span>
          </div>
          {inputError && <p id="order-amount-error" role="alert" className="mt-1.5 text-[13px] font-medium text-loss">{inputError}</p>}
        </div>

        {!quote && (
          <Button type="submit" size="lg" block loading={quoteM.isPending} variant={amountType === "TARGET" ? "primary" : "dark"}>
            Get quote
          </Button>
        )}
        {quoteM.isError && !quote && (
          <p role="alert" className="rounded-lg bg-loss-50 px-3 py-2 text-[13px] font-medium text-loss">{tradeErrorMessage(quoteM.error).message}</p>
        )}
      </form>

      {quote && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-4 py-4 sm:px-5" aria-live="polite">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-ink-900">Your quote</p>
            <Countdown secondsLeft={secondsLeft} total={quote.validity_seconds} />
          </div>
          <QuoteSummary quote={quote} />

          {!quote.sufficient_balance && (
            <p role="alert" className="mt-3 rounded-lg border border-loss/20 bg-loss-50 px-3 py-2.5 text-[13px] font-medium text-loss">
              Insufficient {quote.from_currency.currency_code} balance: this trade needs {formatMoney(quote.total_debit, quote.from_currency, { code: true })} (including fee) but only{" "}
              {formatMoney(quote.available_balance, quote.from_currency, { code: true })} is available.
            </p>
          )}

          {expired ? (
            <div className="mt-3 space-y-2">
              <p role="alert" className="rounded-lg bg-warn-50 px-3 py-2 text-[13px] font-medium text-warn">This quote has expired. Get a fresh quote to trade at the current rate.</p>
              <Button block size="lg" onClick={() => requestQuote()} loading={quoteM.isPending}>
                <Icon name="refresh" className="h-4 w-4" /> Get a fresh quote
              </Button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <Button variant="secondary" size="lg" onClick={clearQuote}>Cancel</Button>
              <Button
                size="lg"
                variant={amountType === "TARGET" ? "primary" : "dark"}
                onClick={openConfirm}
                disabled={expired || !quote.sufficient_balance}
              >
                Review &amp; confirm
              </Button>
            </div>
          )}
        </div>
      )}

      {execError && !quote && (
        <div role="alert" className="mx-4 mb-4 rounded-lg border border-loss/20 bg-loss-50 px-3 py-2.5 text-[13px] text-loss sm:mx-5">
          <p className="font-bold">{execError.title}</p>
          <p className="mt-0.5">{execError.message}</p>
        </div>
      )}

      {result && (
        <div className="border-t border-money-200 bg-money-50 px-4 py-4 sm:px-5" role="status">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-money-600 text-white">
              <Icon name="check" className="h-4 w-4" strokeWidth={2.6} />
            </span>
            <p className="font-bold text-money-900">Trade executed{result.replayed ? " (already processed)" : ""}</p>
          </div>
          <p className="mt-2 text-sm text-ink-700">
            Reference{" "}
            <Link to={`/transactions/${result.trade.trade_id}`} className="num font-semibold text-money-800 underline-offset-2 hover:underline">
              {result.trade.trade_reference}
            </Link>
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {resultHoldings.map(({ code, holding }) => (
              <li key={code} className="flex justify-between gap-3">
                <span className="text-ink-600">{code} balance now</span>
                <span className="num font-semibold text-ink-900">{holding ? formatMoney(holding.quantity, holding.currency, { code: true }) : `0 ${code}`}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/transactions/${result.trade.trade_id}`} className="text-sm font-semibold text-money-800 hover:underline">View transaction →</Link>
            <button type="button" onClick={() => setResult(null)} className="text-sm font-semibold text-ink-600 hover:text-ink-900">New order</button>
          </div>
        </div>
      )}

      <Modal
        open={confirmOpen && Boolean(quote)}
        onClose={() => !execM.isPending && setConfirmOpen(false)}
        dismissable={!execM.isPending}
        title="Confirm your trade"
        description="Simulated trade — virtual balances only."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={execM.isPending}>Back</Button>
            <Button
              variant={amountType === "TARGET" ? "primary" : "dark"}
              onClick={execute}
              loading={execM.isPending}
              disabled={expired}
              data-autofocus
            >
              {expired ? "Quote expired" : `Confirm · ${secondsLeft}s`}
            </Button>
          </>
        }
      >
        {quote && (
          <div className="space-y-3">
            <div className="rounded-xl border border-loss/20 bg-loss-50/70 p-3.5">
              <p className="text-[11px] font-bold tracking-wider text-loss uppercase">Debited from your wallet</p>
              <p className="num mt-1 text-xl font-semibold text-ink-900">{formatMoney(quote.total_debit, quote.from_currency, { code: true })}</p>
              <p className="mt-0.5 text-xs text-ink-600">
                {formatMoney(quote.from_amount, quote.from_currency, { code: true })} + {formatMoney(quote.fee, quote.from_currency, { code: true })} fee
              </p>
            </div>
            <div className="rounded-xl border border-money-200 bg-money-50 p-3.5">
              <p className="text-[11px] font-bold tracking-wider text-money-700 uppercase">Credited to your wallet</p>
              <p className="num mt-1 text-xl font-semibold text-ink-900">{formatMoney(quote.to_amount, quote.to_currency, { code: true })}</p>
            </div>
            <QuoteSummary quote={quote} />
            {expired && (
              <p role="alert" className="rounded-lg bg-warn-50 px-3 py-2 text-[13px] font-medium text-warn">The quote expired. Close this dialog and get a fresh quote.</p>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}

function Countdown({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (secondsLeft / Math.max(1, total)) * 100));
  const tone = secondsLeft <= 0 ? "text-loss" : secondsLeft <= 10 ? "text-warn" : "text-money-700";
  const bar = secondsLeft <= 0 ? "bg-loss" : secondsLeft <= 10 ? "bg-warn" : "bg-money-500";
  return (
    <div className="flex items-center gap-2" aria-label={secondsLeft > 0 ? `Quote expires in ${secondsLeft} seconds` : "Quote expired"}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-200" aria-hidden>
        <span className={`block h-full ${bar} transition-[width] duration-200`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`num text-xs font-bold ${tone}`} data-testid="quote-countdown">
        {secondsLeft > 0 ? `${secondsLeft}s` : "Expired"}
      </span>
    </div>
  );
}
