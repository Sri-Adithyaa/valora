import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../../hooks/useAuth";
import { Icon } from "../ui/Icon";
import { useToast } from "../ui/Toast";
import { Logo } from "./Logo";
import { MarketStatusPill } from "./MarketStatus";
import { NotificationBell } from "./NotificationBell";

export const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/markets", label: "Markets" },
  { to: "/trade", label: "Trade" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/transactions", label: "Transactions" },
  { to: "/profile", label: "Profile" },
] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "V";
}

export function TopNav() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const doLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        toast.push({ kind: "info", title: "You have been logged out." });
        navigate("/login", { replace: true });
      },
    });

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `relative rounded-md px-3 py-2 text-sm font-semibold transition-colors ${isActive ? "text-ink-900" : "text-ink-500 hover:text-ink-900"}`;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100 lg:hidden"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          <Icon name={mobileOpen ? "x" : "menu"} />
        </button>
        <Logo to="/dashboard" />

        <nav aria-label="Main" className="ml-6 hidden items-center gap-0.5 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkCls}>
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-money-600" aria-hidden />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
          <MarketStatusPill />
          <NotificationBell fallbackUnread={me?.unread_notifications ?? 0} />
          {me && (
            <NavLink
              to="/profile"
              className="hidden items-center gap-2 rounded-lg py-1 pr-2 pl-1 hover:bg-ink-100 md:inline-flex"
              title={`${me.user.full_name} (@${me.user.username})`}
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-money-100 text-xs font-bold text-money-800">
                {initials(me.user.full_name)}
              </span>
              <span className="hidden max-w-[120px] truncate text-sm font-semibold text-ink-800 xl:inline">{me.user.full_name.split(" ")[0]}</span>
            </NavLink>
          )}
          <button
            type="button"
            onClick={doLogout}
            disabled={logout.isPending}
            className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
          >
            <Icon name="logout" className="h-4 w-4" />
            <span className="hidden md:inline">Logout</span>
            <span className="sr-only md:hidden">Logout</span>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="mobile-nav" ref={menuRef} className="animate-fade-in border-t border-ink-100 bg-white lg:hidden">
          <nav aria-label="Main mobile" className="mx-auto grid max-w-[1400px] gap-0.5 px-3 py-3">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-[15px] font-semibold ${isActive ? "bg-money-50 text-money-800" : "text-ink-700 hover:bg-ink-50"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={doLogout}
              className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold text-ink-700 hover:bg-ink-50"
            >
              <Icon name="logout" className="h-4 w-4" /> Logout
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
