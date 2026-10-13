import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { avatarUrl } from "../api";
import { useAuth } from "../auth";
import { AlertsBell } from "./AlertsBell";

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const user = me?.user;
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Home">
          {__BRAND__.wordmark ? (
            <img src={__BRAND__.wordmark} alt="LootDen" height={36} className="wordmark" />
          ) : (
            <>
              <img src={__BRAND__.logo ?? "/logo.svg"} alt="" width={36} height={36} />
              <span>LootDen</span>
            </>
          )}
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/emulation">Emulation</NavLink>
          {!me?.user?.kidMode && <NavLink to="/discover">Discover</NavLink>}
          {!me?.user?.kidMode && <NavLink to="/wishlist">Wishlist</NavLink>}
          {!me?.user?.kidMode && <NavLink to="/calendar">Calendar</NavLink>}
          <NavLink to="/news">News</NavLink>
          <NavLink to="/apps">Get the app</NavLink>
          {me?.role === "admin" && <NavLink to="/downloads">Downloads</NavLink>}
          {me?.role === "admin" && <NavLink to="/settings">Settings</NavLink>}
        </nav>
        <div className="topbar-right">
          {me?.role === "admin" && <AlertsBell />}
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
