import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout, PublicOnly, RequireAuth, RequireWallet } from "./components/layout/Layouts";
import { FullPageLoader } from "./components/ui/Spinner";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const WalletSetupPage = lazy(() => import("./pages/WalletSetupPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const MarketsPage = lazy(() => import("./pages/MarketsPage"));
const TradePage = lazy(() => import("./pages/TradePage"));
const PortfolioPage = lazy(() => import("./pages/PortfolioPage"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage"));
const TradeDetailPage = lazy(() => import("./pages/TradeDetailPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

export function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route path="/wallet/setup" element={<RequireAuth><WalletSetupPage /></RequireAuth>} />

        <Route element={<RequireWallet />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/trade" element={<TradePage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/:tradeId" element={<TradeDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
