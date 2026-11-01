import { useEffect, useState, type FormEvent } from "react";
import { useCurrencies } from "../hooks/useMarket";
import { useFundDemo } from "../hooks/useWallet";
import { formatMoney, validateAmountInput } from "../lib/format";
import { errorMessage, isApiError } from "../services/api";
import { Button } from "./ui/Button";
import { FormError, SelectField, TextField } from "./ui/Field";
import { Modal } from "./ui/Modal";
import { useToast } from "./ui/Toast";

/** "Add demo funds" — virtual credit via POST /api/wallet/fund-demo (server enforces per-request and daily limits). */
export function FundDemoModal({ open, onClose, baseCode }: { open: boolean; onClose: () => void; baseCode: string }) {
  const { data: currencies } = useCurrencies();
  const fund = useFundDemo();
  const toast = useToast();
  const [currency, setCurrency] = useState(baseCode);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setCurrency(baseCode);
      setAmount("");
      setError(undefined);
      fund.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseCode]);

  const cur = currencies?.find((c) => c.currency_code === currency);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateAmountInput(amount, cur?.decimals ?? 2);
    setError(err ?? undefined);
    if (err) return;
    fund.mutate(
      { amount: amount.trim(), currency },
      {
        onSuccess: (f) => {
          toast.push({ kind: "success", title: "Virtual funds added", message: `${formatMoney(f.amount, f.currency)} credited · ${f.reference}` });
          onClose();
        },
        onError: (er) => {
          if (isApiError(er) && er.fieldErrors.amount) setError(er.fieldErrors.amount);
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add demo funds"
      description="Virtual credit for practice trading — no real money is involved."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="fund-form" loading={fund.isPending}>Add funds</Button>
        </>
      }
    >
      <form id="fund-form" onSubmit={submit} noValidate className="space-y-4">
        <FormError message={fund.isError && !error ? errorMessage(fund.error) : null} />
        <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
          <SelectField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies?.map((c) => (
              <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency_name}</option>
            ))}
          </SelectField>
          <TextField
            label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/,/g, ""));
              setError(undefined);
            }}
            error={error}
            placeholder={cur?.decimals === 0 ? "10000" : "10000.00"}
            className="num"
            data-autofocus
          />
        </div>
        <p className="text-xs text-ink-500">
          Demo credits are recorded in your ledger as funding (not trading gains) and are capped per request and per day.
        </p>
      </form>
    </Modal>
  );
}
