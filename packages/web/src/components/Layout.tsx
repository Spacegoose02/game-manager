import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { avatarUrl } from "../api";
import { useAuth } from "../auth";

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const user = me?.user;
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Home">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <span>LootDen</span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/library">Library</NavLink>
          {!me?.user?.kidMode && <NavLink to="/discover">Discover</NavLink>}
          {!me?.user?.kidMode && <NavLink to="/calendar">Calendar</NavLink>}
          <NavLink to="/news">News</NavLink>
          <NavLink to="/apps">Get the app</NavLink>
          {me?.role === "admin" && <NavLink to="/downloads">Downloads</NavLink>}
          {me?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="topbar-right">
          {user ? (
            <NavLink to="/profile" className="me" aria-label="Profile">
              <img src={avatarUrl(user.avatar)} alt="" width={36} height={36} className="avatar" />
              <span className="me-name">{user.displayName}</span>
            </NavLink>
          ) : (
            <span className="muted">Service token</span>
          )}
          <button
            className="ghost"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
