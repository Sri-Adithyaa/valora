import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AuthAside } from "../components/AuthAside";
import { AuthLayout } from "../components/layout/Layouts";
import { Button } from "../components/ui/Button";
import { FormError, SelectField, TextField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { useToast } from "../components/ui/Toast";
import { WalletCard } from "../components/WalletCard";
import { useCreateWallet, useLogout, useMe } from "../hooks/useAuth";
import { useCurrencies } from "../hooks/useMarket";
import { COUNTRIES } from "../lib/countries";
import { formatDateTime, formatMoney } from "../lib/format";
import { errorMessage, isApiError } from "../services/api";
import type { Wallet } from "../services/types";

const TERMS = [
  "Valora Money is a simulation. All balances, funding and trades are virtual and have no monetary value.",
  "No real deposits, withdrawals, bank transfers or foreign-currency settlement take place.",
  "Exchange rates are stored market snapshots refreshed about every 2 minutes; quotes are locked for a short window and may expire.",
  "Seeded demonstration history is labelled as simulated wherever it appears.",
];

export default function WalletSetupPage() {
  const { data: me } = useMe();
  const { data: currencies } = useCurrencies();
  const create = useCreateWallet();
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const [created, setCreated] = useState<Wallet | null>(null);
  const firstName = me?.user.full_name.split(" ")[0] ?? "My";
  const [form, setForm] = useState({
    wallet_name: `${firstName}'s Valora Wallet`,
    base_currency: me?.user.base_currency.currency_code ?? "",
    country: me?.user.country ?? "",
    accept_terms: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!me) return null; // RequireAuth guarantees a session
  // Keep showing the success screen after creation even though `me.wallet` is now set.
  const createdWallet = created ?? create.data ?? null;
  if (me.wallet && !createdWallet && !create.isPending) return <Navigate to="/dashboard" replace />;

  const countryOptions = COUNTRIES.some((c) => c.name === form.country) || !form.country
    ? COUNTRIES
    : [{ name: form.country }, ...COUNTRIES];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.wallet_name.trim().length < 2) errs.wallet_name = "Give your wallet a name (at least 2 characters).";
    if (!form.base_currency) errs.base_currency = "Select a base currency.";
    if (!form.country) errs.country = "Select a country.";
    if (!form.accept_terms) errs.accept_terms = "You must accept the simulated-trading terms to open a wallet.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    create.mutate(
      { ...form, wallet_name: form.wallet_name.trim() },
      {
        onSuccess: (w) => {
          setCreated(w);
          toast.push({ kind: "success", title: "Wallet activated", message: `Reference ${w.wallet_reference}` });
        },
        onError: (err) => {
          if (isApiError(err)) {
            if (err.code === "wallet_exists") navigate("/dashboard", { replace: true });
            setErrors(err.fieldErrors);
          }
        },
      },
    );
  };

  if (createdWallet) {
    const w = createdWallet;
    return (
      <AuthLayout aside={<AuthAside />}>
        <div className="animate-slide-up">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-money-100 text-money-700">
            <Icon name="check" className="h-6 w-6" strokeWidth={2.4} />
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink-900">Your wallet is active</h1>
          <p className="mt-2 text-sm text-ink-500">Opened {formatDateTime(w.created_at)}. Virtual starting funds have been credited.</p>
          <div className="mt-6">
            <WalletCard
              reference={w.wallet_reference}
              name={w.wallet_name}
              baseCode={w.base_currency.currency_code}
              baseSymbol={w.base_currency.currency_symbol}
              holder={me.user.full_name}
              status={w.status}
            />
          </div>
          <dl className="mt-6 divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white px-4">
            <div className="flex items-center justify-between py-3 text-sm">
              <dt className="text-ink-500">Wallet reference</dt>
              <dd className="num font-semibold text-ink-900">{w.wallet_reference}</dd>
            </div>
            <div className="flex items-center justify-between py-3 text-sm">
              <dt className="text-ink-500">Starting virtual balance</dt>
              <dd className="num text-lg font-semibold text-money-700">{formatMoney(w.total_value, w.base_currency)}</dd>
            </div>
          </dl>
          <Button size="lg" block className="mt-6" onClick={() => navigate("/dashboard", { replace: true })}>
            Go to dashboard <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout aside={<SetupAside name={form.wallet_name} base={currencies?.find((c) => c.currency_code === form.base_currency)} holder={me.user.full_name} />}>
      <p className="label mb-2">Step 2 of 2</p>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Open your Valora Wallet</h1>
      <p className="mt-2 mb-7 text-sm text-ink-500">
        One wallet holds every currency you own. You'll receive a virtual starting balance to trade with.
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Create wallet">
        <FormError message={create.isError ? errorMessage(create.error) : null} />
        <TextField label="Wallet name" value={form.wallet_name} maxLength={60} onChange={(e) => setForm({ ...form, wallet_name: e.target.value })} error={errors.wallet_name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Base currency" value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value })} error={errors.base_currency}>
            <option value="">Select…</option>
            {currencies?.map((c) => (
              <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency_name}</option>
            ))}
          </SelectField>
          <SelectField label="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} error={errors.country}>
            <option value="">Select…</option>
            {countryOptions.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </SelectField>
        </div>

        <fieldset className="rounded-xl border border-ink-200 bg-white p-4">
          <legend className="px-1 text-[13px] font-semibold text-ink-800">Simulated-trading terms</legend>
          <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-ink-600">
            {TERMS.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-ink-800">
            <input
              type="checkbox"
              checked={form.accept_terms}
              onChange={(e) => {
                setForm({ ...form, accept_terms: e.target.checked });
                if (errors.accept_terms) setErrors({ ...errors, accept_terms: "" });
              }}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 accent-money-600"
              aria-invalid={errors.accept_terms ? true : undefined}
              aria-describedby={errors.accept_terms ? "terms-error" : undefined}
            />
            I understand that Valora Money is a simulation and accept these terms.
          </label>
          {errors.accept_terms && <p id="terms-error" role="alert" className="mt-2 text-[13px] font-medium text-loss">{errors.accept_terms}</p>}
        </fieldset>

        <Button type="submit" size="lg" block loading={create.isPending}>
          Open wallet
        </Button>
      </form>
      <button
        type="button"
        className="mt-6 text-sm font-medium text-ink-500 hover:text-ink-800"
        onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) })}
      >
        Not you? Log out
      </button>
    </AuthLayout>
  );
}

function SetupAside({ name, base, holder }: { name?: string; base?: { currency_code: string; currency_symbol: string }; holder?: string }) {
  return (
    <div className="flex h-full flex-col justify-center p-10 xl:p-14">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(16,178,102,0.16),transparent_55%)]" aria-hidden />
      <div className="relative mx-auto w-full max-w-md">
        <p className="label !text-money-400">Your wallet</p>
        <h2 className="mt-3 text-3xl leading-tight font-extrabold tracking-tight text-white">The account that holds every currency you own.</h2>
        <div className="mt-8">
          <WalletCard
            reference="VLM-••••-••••-••••"
            name={name || "Valora Wallet"}
            baseCode={base?.currency_code ?? "—"}
            baseSymbol={base?.currency_symbol ?? ""}
            holder={holder}
            status="Preview"
          />
        </div>
        <p className="mt-4 text-sm text-ink-400">A unique wallet reference is generated when you open the wallet.</p>
      </div>
    </div>
  );
}
