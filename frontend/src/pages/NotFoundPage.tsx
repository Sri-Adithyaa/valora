import { Logo } from "../components/layout/Logo";
import { SimulationBanner } from "../components/layout/SimulationBanner";
import { ButtonLink } from "../components/ui/Button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SimulationBanner />
      <div className="px-5 py-5 sm:px-8"><Logo /></div>
      <main id="main" className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="num text-7xl font-semibold tracking-tight text-ink-200 sm:text-8xl">404</p>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">This page isn't on the market.</h1>
        <p className="mt-2 max-w-md text-sm text-ink-500">The address may be mistyped, or the page has moved.</p>
        <div className="mt-6 flex gap-2">
          <ButtonLink to="/dashboard">Go to dashboard</ButtonLink>
          <ButtonLink to="/" variant="secondary">Home</ButtonLink>
        </div>
      </main>
    </div>
  );
}
