import type { ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useMe } from "../../hooks/useAuth";
import { errorMessage } from "../../services/api";
import { safeNextPath } from "../AppProviders";
import { ErrorState } from "../ui/Display";
import { FullPageLoader } from "../ui/Spinner";
import { Logo } from "./Logo";
import { StaleDataBanner } from "./MarketStatus";
import { SimulationBanner } from "./SimulationBanner";
import { TopNav } from "./TopNav";

function Footer() {
  return (
    <footer className="border-t border-ink-200/70 bg-white/60">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-1 px-4 py-5 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-semibold text-ink-700">Valora Money</span> — Where Money Becomes an Asset.
        </p>
        <p>Simulated trading environment. Rates are stored snapshots refreshed about every 2 minutes, not real-time ticks.</p>
      </div>
    </footer>
  );
}

/** Shell for signed-in pages: simulation banner, top nav, stale-data warning, content. */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <SimulationBanner />
      <TopNav />
      <StaleDataBanner />
      <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

/** Shell for public auth pages (login/register/wallet setup). */
export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SimulationBanner />
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col px-5 py-6 sm:px-10">
          <Logo />
          <main id="main" className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[440px]">{children}</div>
          </main>
          <p className="text-xs text-ink-500">
            © Valora Money · <Link to="/" className="hover:text-ink-800">Home</Link>
          </p>
        </div>
        <aside className="relative hidden overflow-hidden bg-ink-900 lg:block">{aside}</aside>
      </div>
    </div>
  );
}

function loginRedirect(pathname: string, search: string) {
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}

/** Requires a session; otherwise redirects to /login and back afterwards. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { data: me, isLoading, isError, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (!me) return <Navigate to={loginRedirect(location.pathname, location.search)} replace />;
  return children ? <>{children}</> : <Outlet />;
}

/** Requires a session AND an active wallet; otherwise sends the user to wallet setup. */
export function RequireWallet({ children }: { children?: ReactNode }) {
  const { data: me, isLoading, isError, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (!me) return <Navigate to={loginRedirect(location.pathname, location.search)} replace />;
  if (!me.wallet) return <Navigate to="/wallet/setup" replace />;
  return children ? <>{children}</> : <Outlet />;
}

/**
 * Login/register: signed-in users skip straight ahead — to the page they originally asked for (`?next=`),
 * or the dashboard; users without a wallet always go to wallet setup first.
 */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (me) {
    const next = safeNextPath(new URLSearchParams(location.search).get("next"));
    const target = !me.wallet ? "/wallet/setup" : next && next !== "/wallet/setup" ? next : "/dashboard";
    return <Navigate to={target} replace />;
  }
  return <>{children}</>;
}
