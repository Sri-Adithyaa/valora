import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, KV, PageHeader, Pill } from "../components/ui/Display";
import { FormError, SelectField, TextField } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { WalletCard } from "../components/WalletCard";
import { useChangePassword, useMe, useUpdateProfile } from "../hooks/useAuth";
import { useCurrencies } from "../hooks/useMarket";
import { COUNTRIES } from "../lib/countries";
import { formatDate, formatDateTime } from "../lib/format";
import { errorMessage, isApiError } from "../services/api";
import type { ProfileUpdateInput } from "../services/types";

export default function ProfilePage() {
  const { data: me } = useMe();
  if (!me) return null;
  const u = me.user;
  const w = me.wallet;

  return (
    <>
      <PageHeader eyebrow="Profile" title={u.full_name} subtitle={`@${u.username} · member since ${formatDate(u.created_at)}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Account details" actions={u.is_demo ? <Pill tone="amber">Demo account</Pill> : <Pill tone="green">{u.account_status}</Pill>} />
            <dl className="grid gap-x-10 px-5 pb-4 sm:grid-cols-2">
              <KV k="Full name" v={<span className="font-sans">{u.full_name}</span>} />
              <KV k="Username" v={`@${u.username}`} />
              <KV k="Email" v={<span className="font-sans">{u.email}</span>} />
              <KV k="Phone" v={u.phone} />
              <KV k="Country" v={<span className="font-sans">{u.country}</span>} />
              <KV k="Preferred currency" v={`${u.base_currency.currency_code} · ${u.base_currency.currency_symbol}`} />
              <KV k="Account created" v={formatDateTime(u.created_at)} />
              <KV k="Account status" v={u.account_status} />
            </dl>
          </Card>
          <EditProfileCard />
          <ChangePasswordCard />
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-4 text-[15px] font-bold tracking-tight">Wallet</h2>
            {w ? (
              <>
                <WalletCard reference={w.wallet_reference} name={w.wallet_name} baseCode={w.base_currency.currency_code} baseSymbol={w.base_currency.currency_symbol} holder={u.full_name} status={w.status} />
                <dl className="mt-4 divide-y divide-ink-100">
                  <KV k="Status" v={<Pill tone={w.status === "ACTIVE" ? "green" : "neutral"}>{w.status}</Pill>} />
                  <KV k="Reference" v={w.wallet_reference} />
                  <KV k="Base currency" v={w.base_currency.currency_code} />
                  <KV k="Opened" v={formatDateTime(w.created_at)} />
                </dl>
                <p className="mt-3 text-xs text-ink-500">The wallet's base currency is fixed when the wallet is opened; your preferred currency above is a profile setting.</p>
              </>
            ) : (
              <p className="text-sm text-ink-500">No wallet yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function EditProfileCard() {
  const { data: me } = useMe();
  const { data: currencies } = useCurrencies();
  const update = useUpdateProfile();
  const toast = useToast();
  const u = me!.user;
  const initial = { full_name: u.full_name, phone: u.phone, country: u.country, base_currency: u.base_currency.currency_code };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setForm({ full_name: u.full_name, phone: u.phone, country: u.country, base_currency: u.base_currency.currency_code }), [u.full_name, u.phone, u.country, u.base_currency.currency_code]);

  const changed: ProfileUpdateInput = {};
  (Object.keys(initial) as (keyof typeof initial)[]).forEach((k) => {
    if (form[k].trim() !== initial[k]) changed[k] = form[k].trim();
  });
  const dirty = Object.keys(changed).length > 0;
  const countries = COUNTRIES.some((c) => c.name === form.country) ? COUNTRIES : [{ name: form.country }, ...COUNTRIES];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.full_name.trim().length < 2) errs.full_name = "Enter your full name.";
    if (!/^\+?[0-9][0-9 -]{6,18}[0-9]$/.test(form.phone.trim())) errs.phone = "Enter a valid phone number, e.g. +91 98765 43210";
    setErrors(errs);
    if (Object.keys(errs).length || !dirty) return;
    update.mutate(changed, {
      onSuccess: () => toast.push({ kind: "success", title: "Profile updated" }),
      onError: (er) => isApiError(er) && setErrors(er.fieldErrors),
    });
  };

  return (
    <Card>
      <CardHeader title="Edit profile" subtitle="Username and email can't be changed." />
      <form onSubmit={submit} noValidate className="space-y-4 px-5 pb-5">
        <FormError message={update.isError ? errorMessage(update.error) : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} error={errors.full_name} autoComplete="name" />
          <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} autoComplete="tel" />
          <SelectField label="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} error={errors.country}>
            {countries.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </SelectField>
          <SelectField label="Preferred currency" value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value })} error={errors.base_currency}>
            {currencies?.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency_name}</option>)}
          </SelectField>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={!dirty || update.isPending} onClick={() => { setForm(initial); setErrors({}); }}>Reset</Button>
          <Button type="submit" disabled={!dirty} loading={update.isPending}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}

function ChangePasswordCard() {
  const change = useChangePassword();
  const toast = useToast();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.current_password) errs.current_password = "Enter your current password.";
    if (form.new_password.length < 8) errs.new_password = "Password must be at least 8 characters long.";
    else if (!/[A-Za-z]/.test(form.new_password) || !/[0-9]/.test(form.new_password)) errs.new_password = "Password must contain at least one letter and one number.";
    if (form.new_password !== form.confirm_password) errs.confirm_password = "Passwords do not match.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    change.mutate(form, {
      onSuccess: (m) => {
        toast.push({ kind: "success", title: "Password changed", message: m.message });
        setForm({ current_password: "", new_password: "", confirm_password: "" });
      },
      onError: (er) => {
        if (!isApiError(er)) return;
        const fe = er.fieldErrors;
        if (er.code === "invalid_password") fe.current_password = er.message;
        if (er.code === "password_reused") fe.new_password = er.message;
        if (fe._form) fe.confirm_password = fe._form;
        setErrors(fe);
      },
    });
  };

  return (
    <Card>
      <CardHeader title="Change password" subtitle="Other sessions are signed out after a change." />
      <form onSubmit={submit} noValidate className="space-y-4 px-5 pb-5">
        <FormError message={change.isError && !Object.values(errors).some(Boolean) ? errorMessage(change.error) : null} />
        <TextField label="Current password" type="password" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} error={errors.current_password} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="New password" type="password" autoComplete="new-password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} error={errors.new_password} hint="8+ characters, a letter and a number." />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} error={errors.confirm_password} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="dark" loading={change.isPending}>Update password</Button>
        </div>
      </form>
    </Card>
  );
}
