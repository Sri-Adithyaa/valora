export function Spinner({ className = "h-5 w-5", label }: { className?: string; label?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageLoader({ label = "Loading Valora Money" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-money-600">
      <Spinner className="h-7 w-7" label={label} />
    </div>
  );
}
