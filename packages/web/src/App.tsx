import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { installSpatialNavigation } from "./gamepad";
import { Admin } from "./pages/Admin";
import { Apps } from "./pages/Apps";
import { Calendar } from "./pages/Calendar";
import { Discover } from "./pages/Discover";
import { Downloads } from "./pages/Downloads";
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
        <Route path="calendar" element={<Calendar />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin" element={<Admin />} />
        <Route path="downloads" element={<Downloads />} />
        <Route path="apps" element={<Apps />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
