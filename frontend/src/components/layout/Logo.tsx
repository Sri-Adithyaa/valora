import { Link } from "react-router-dom";

/** Valora Money mark: a "V" whose right stroke rises like a price line, ending in a settled dot. */
export function LogoMark({ className = "h-8 w-8", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill={dark ? "#ffffff" : "#111418"} />
      <path d="M8 9.5h3.6l4.4 11.2 4.4-11.2H24l-6.3 14h-3.4z" fill="#10B266" />
      <circle cx="23.5" cy="23.5" r="2" fill="#10B266" />
    </svg>
  );
}

export function Logo({ to = "/", dark = false, compact = false }: { to?: string; dark?: boolean; compact?: boolean }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 rounded-md" aria-label="Valora Money home">
      <LogoMark className="h-8 w-8" dark={dark} />
      {!compact && (
        <span className={`text-[17px] leading-none font-extrabold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>
          Valora<span className="font-semibold text-money-500"> Money</span>
        </span>
      )}
    </Link>
  );
}
