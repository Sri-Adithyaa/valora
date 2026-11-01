import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthAside } from "../components/AuthAside";
import { AuthLayout } from "../components/layout/Layouts";
import { Button } from "../components/ui/Button";
import { FormError, TextField } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useLogin } from "../hooks/useAuth";
import { errorMessage, isApiError } from "../services/api";

export function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const login = useLogin();
  const toast = useToast();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (identifier.trim().length < 3) errs.identifier = "Enter your email address or username.";
    if (!password) errs.password = "Enter your password.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    login.mutate(
      { identifier: identifier.trim(), password },
      {
        onSuccess: (me) => toast.push({ kind: "success", title: `Welcome back, ${me.user.full_name.split(" ")[0]}.` }),
        onError: (err) => {
          if (isApiError(err)) setErrors(err.fieldErrors);
        },
      },
    );
  };

  const formError = login.isError ? errorMessage(login.error) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Log in">
      <FormError message={formError} />
      <TextField
        label="Email or username"
        name="identifier"
        autoComplete="username"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        error={errors.identifier}
        placeholder="you@example.com or username"
        autoFocus
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <Button type="submit" size="lg" block loading={login.isPending}>
        Log in
      </Button>
    </form>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  return (
    <AuthLayout aside={<AuthAside />}>
      <p className="label mb-2">Welcome back</p>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Log in to Valora Money</h1>
      <p className="mt-2 mb-7 text-sm text-ink-500">
        {next ? "Please log in to continue where you left off." : "Use your email address or username."}
      </p>
      <LoginForm />
      <p className="mt-6 text-sm text-ink-600">
        New to Valora Money?{" "}
        <Link to="/register" className="font-semibold text-money-700 hover:underline">
          Create an account
        </Link>
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-ink-200 bg-white px-4 py-3 text-[13px] text-ink-600">
        <p className="font-semibold text-ink-800">Demo account</p>
        <p className="mt-0.5">
          Username <code className="num rounded bg-ink-100 px-1">demo</code> · password{" "}
          <code className="num rounded bg-ink-100 px-1">ValoraDemo123</code>
        </p>
      </div>
    </AuthLayout>
  );
}
