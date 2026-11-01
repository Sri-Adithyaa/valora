import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthAside } from "../components/AuthAside";
import { AuthLayout } from "../components/layout/Layouts";
import { Button } from "../components/ui/Button";
import { FormError, SelectField, TextField } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useRegister } from "../hooks/useAuth";
import { useCurrencies } from "../hooks/useMarket";
import { COUNTRIES, suggestedCurrency } from "../lib/countries";
import { errorMessage, isApiError } from "../services/api";
import type { RegisterInput } from "../services/types";

const EMPTY: RegisterInput = {
  full_name: "",
  username: "",
  email: "",
  phone: "",
  password: "",
  confirm_password: "",
  country: "",
  base_currency: "",
};

/** Client-side checks that mirror the server's rules; the server remains the authority. */
export function validateRegistration(v: RegisterInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.full_name.trim().length < 2) e.full_name = "Enter your full name.";
  if (!/^[A-Za-z0-9_.]{3,32}$/.test(v.username.trim())) e.username = "Username must be 3–32 characters: letters, numbers, '_' or '.'";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (!/^\+?[0-9][0-9 -]{6,18}[0-9]$/.test(v.phone.trim())) e.phone = "Enter a valid phone number, e.g. +91 98765 43210";
  if (v.password.length < 8) e.password = "Password must be at least 8 characters long.";
  else if (!/[A-Za-z]/.test(v.password) || !/[0-9]/.test(v.password)) e.password = "Password must contain at least one letter and one number.";
  if (!v.confirm_password) e.confirm_password = "Confirm your password.";
  else if (v.password !== v.confirm_password) e.confirm_password = "Passwords do not match.";
  if (!v.country) e.country = "Select your country.";
  if (!v.base_currency) e.base_currency = "Select a base currency.";
  return e;
}

export default function RegisterPage() {
  const [form, setForm] = useState<RegisterInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const register = useRegister();
  const { data: currencies, isLoading: curLoading } = useCurrencies();
  const navigate = useNavigate();
  const toast = useToast();

  const set = <K extends keyof RegisterInput>(k: K, v: RegisterInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  const onCountry = (country: string) => {
    setForm((f) => {
      const sug = suggestedCurrency(country);
      const supported = sug && currencies?.some((c) => c.currency_code === sug);
      return { ...f, country, base_currency: f.base_currency || (supported ? sug! : f.base_currency) };
    });
    if (errors.country) setErrors((e) => ({ ...e, country: "" }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateRegistration(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    register.mutate(
      { ...form, full_name: form.full_name.trim(), username: form.username.trim(), email: form.email.trim(), phone: form.phone.trim() },
      {
        onSuccess: () => {
          toast.push({ kind: "success", title: "Account created", message: "Now open your Valora Wallet." });
          navigate("/wallet/setup", { replace: true });
        },
        onError: (err) => {
          if (!isApiError(err)) return;
          const fe = err.fieldErrors;
          if (err.code === "email_taken") fe.email = err.message;
          if (err.code === "username_taken") fe.username = err.message;
          // A model-level error (passwords do not match) arrives with an empty field name.
          if (fe._form && /match/i.test(fe._form)) fe.confirm_password = fe._form;
          setErrors(fe);
        },
      },
    );
  };

  return (
    <AuthLayout aside={<AuthAside />}>
      <p className="label mb-2">Open an account</p>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Create your Valora account</h1>
      <p className="mt-2 mb-7 text-sm text-ink-500">Next, you'll open a wallet and receive virtual starting funds.</p>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Register">
        <FormError message={register.isError ? errorMessage(register.error) : null} />
        <TextField label="Full name" autoComplete="name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} error={errors.full_name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Username" autoComplete="username" value={form.username} onChange={(e) => set("username", e.target.value)} error={errors.username} />
          <TextField label="Phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} />
        </div>
        <TextField label="Email address" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            error={errors.password}
            hint="8+ characters, with a letter and a number."
          />
          <TextField label="Confirm password" type="password" autoComplete="new-password" value={form.confirm_password} onChange={(e) => set("confirm_password", e.target.value)} error={errors.confirm_password} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Country" value={form.country} onChange={(e) => onCountry(e.target.value)} error={errors.country} autoComplete="country-name">
            <option value="">Select country…</option>
            {COUNTRIES.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </SelectField>
          <SelectField
            label="Base currency"
            value={form.base_currency}
            onChange={(e) => set("base_currency", e.target.value)}
            error={errors.base_currency}
            disabled={curLoading}
            hint="Your portfolio is valued in this currency."
          >
            <option value="">{curLoading ? "Loading…" : "Select currency…"}</option>
            {currencies?.map((c) => (
              <option key={c.currency_code} value={c.currency_code}>
                {c.currency_code} — {c.currency_name}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" size="lg" block loading={register.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-600">
        Already registered?{" "}
        <Link to="/login" className="font-semibold text-money-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
