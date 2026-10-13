import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { installSpatialNavigation } from "./gamepad";
import { Admin } from "./pages/Admin";
import { Apps } from "./pages/Apps";
import { Wishlist } from "./pages/Wishlist";
import { Calendar } from "./pages/Calendar";
import { Discover } from "./pages/Discover";
import { DiscoverGame } from "./pages/DiscoverGame";
import { Downloads } from "./pages/Downloads";
import { Emulation, EmulationSystem } from "./pages/Emulation";
import { EmulatorSetup } from "./pages/EmulatorSetup";
import { PlayInBrowser } from "./pages/PlayInBrowser";
import { GameDetail } from "./pages/GameDetail";
import { Home } from "./pages/Home";
import { Library } from "./pages/Library";
import { Login } from "./pages/Login";
import { News } from "./pages/News";
import { Profile } from "./pages/Profile";
import { useTheme } from "./theme";

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted center">Loading…</p>;
  if (!me) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

export function App() {
  useTheme(); // applies the saved theme on load
  const navigate = useNavigate();
  useEffect(() => installSpatialNavigation(() => navigate(-1)), [navigate]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="library" element={<Library />} />
        <Route path="games/:id" element={<GameDetail />} />
        <Route path="news" element={<News />} />
        <Route path="discover" element={<Discover />} />
        <Route path="discover/:provider/:id" element={<DiscoverGame />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route path="emulation" element={<Emulation />} />
        <Route path="play/:id" element={<PlayInBrowser />} />
        <Route path="emulation/setup" element={<EmulatorSetup />} />
        <Route path="emulation/:platform" element={<EmulationSystem />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin" element={<Admin />} />
        <Route path="downloads" element={<Downloads />} />
        <Route path="apps" element={<Apps />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
