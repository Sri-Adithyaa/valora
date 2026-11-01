export const SIMULATION_NOTICE = "SIMULATION MODE — All balances and transactions are virtual. No real money is transferred.";

/** Permanent slim banner required on every page. */
export function SimulationBanner() {
  return (
    <div className="bg-ink-950 text-ink-200">
      <p className="mx-auto max-w-[1400px] px-4 py-1.5 text-center text-[11px] font-medium tracking-wide sm:px-6 sm:text-xs">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-money-400 align-middle" aria-hidden />
        <strong className="font-bold text-white">SIMULATION MODE</strong>
        <span> — All balances and transactions are virtual. No real money is transferred.</span>
      </p>
    </div>
  );
}
