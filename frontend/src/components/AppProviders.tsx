import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { keys } from "../hooks/keys";
import { isApiError } from "../services/api";
import { ToastProvider } from "./ui/Toast";

/** 401 codes that are ordinary form errors, not "your session is gone". */
const FORM_401_CODES = new Set(["invalid_credentials", "account_inactive"]);

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Only same-origin absolute paths; reject protocol-relative ("//x") and backslash tricks ("/\x").
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  return raw;
}

/**
 * Creates the QueryClient and routes global API failures:
 * 401 → /login (remembering where the user was), 404 wallet_required → /wallet/setup.
 */
export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef({ navigate, location });
  useEffect(() => {
    navRef.current = { navigate, location };
  }, [navigate, location]);

  const [queryClient] = useState(() => {
    const handle = (error: unknown, isMeQuery: boolean) => {
      if (!isApiError(error)) return;
      const { navigate: nav, location: loc } = navRef.current;
      if (error.status === 401 && !isMeQuery && !FORM_401_CODES.has(error.code)) {
        qc.setQueryData(keys.me, null);
        if (!loc.pathname.startsWith("/login")) {
          const next = `${loc.pathname}${loc.search}`;
          nav(`/login?next=${encodeURIComponent(next)}`, { replace: true });
        }
      } else if (error.status === 404 && error.code === "wallet_required") {
        if (loc.pathname !== "/wallet/setup") nav("/wallet/setup", { replace: true });
      }
    };
    const qc =
      client ??
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => handle(error, query.queryKey[0] === keys.me[0]),
        }),
        mutationCache: new MutationCache({ onError: (error) => handle(error, false) }),
        defaultOptions: {
          queries: {
            retry: (count, e) => !(isApiError(e) && e.status > 0 && e.status < 500) && count < 2,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: false },
        },
      });
    return qc;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
