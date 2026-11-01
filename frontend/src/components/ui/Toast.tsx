import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastInput {
  kind?: ToastKind;
  title: string;
  message?: string;
  link?: { to: string; label: string };
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  push: (t: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const STYLES: Record<ToastKind, { bar: string; icon: string; name: Parameters<typeof Icon>[0]["name"] }> = {
  success: { bar: "bg-money-500", icon: "text-money-600", name: "check-circle" },
  error: { bar: "bg-loss", icon: "text-loss", name: "alert" },
  warning: { bar: "bg-warn", icon: "text-warn", name: "alert" },
  info: { bar: "bg-ink-400", icon: "text-ink-500", name: "info" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.durationMs ?? (t.kind === "error" ? 8000 : 5500));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {items.map((t) => {
          const s = STYLES[t.kind ?? "info"];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className="pointer-events-auto relative flex w-full max-w-sm animate-slide-up overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop"
            >
              <span className={`w-1 shrink-0 ${s.bar}`} aria-hidden />
              <div className="flex flex-1 gap-3 p-3.5 pr-2">
                <Icon name={s.name} className={`mt-0.5 h-5 w-5 shrink-0 ${s.icon}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">{t.title}</p>
                  {t.message && <p className="mt-0.5 text-sm text-ink-600">{t.message}</p>}
                  {t.link && (
                    <Link
                      to={t.link.to}
                      onClick={() => dismiss(t.id)}
                      className="mt-1.5 inline-block text-sm font-semibold text-money-700 hover:underline"
                    >
                      {t.link.label}
                    </Link>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="h-7 w-7 shrink-0 rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                  aria-label="Dismiss notification"
                >
                  <Icon name="x" className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
