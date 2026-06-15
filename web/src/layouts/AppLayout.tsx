import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/primitives";
import { useEventContext } from "../context/EventContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { SERVICE_WORKER_UPDATE_EVENT } from "../lib/serviceWorker";
import { ADMIN_NAV_ITEMS, eventPath, PRIMARY_NAV_ITEMS } from "../features/routes/routes";

const NavItems = () => {
  const { hasAnyRole, selectedEvent } = useEventContext();

  const visibleItems = selectedEvent ? PRIMARY_NAV_ITEMS.filter((item) => hasAnyRole(item.roles)) : [];

  return (
    <nav aria-label="Primary navigation" className="side-nav">
      <NavLink className={({ isActive }) => (isActive ? "active" : undefined)} end to="/">
        Events
      </NavLink>
      {selectedEvent ? visibleItems.map((item) => (
        <NavLink
          className={({ isActive }) => (isActive ? "active" : undefined)}
          end={item.path === ""}
          key={item.path || "dashboard"}
          to={eventPath(selectedEvent.id, item.path)}
        >
          {item.label}
        </NavLink>
      )) : null}
    </nav>
  );
};

const AdminSubnav = () => {
  const location = useLocation();
  const { hasAnyRole, selectedEvent } = useEventContext();

  if (!selectedEvent || !location.pathname.startsWith(eventPath(selectedEvent.id, "admin"))) {
    return null;
  }

  return (
    <nav aria-label="Admin configuration" className="tabs">
      {ADMIN_NAV_ITEMS.filter((item) => hasAnyRole(item.roles)).map((item) => (
        <NavLink
          className={({ isActive }) => (isActive ? "active" : undefined)}
          end={item.path === "admin"}
          key={item.path}
          to={eventPath(selectedEvent.id, item.path)}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
};

const PwaUpdatePrompt = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setUpdateAvailable(true);

    window.addEventListener(SERVICE_WORKER_UPDATE_EVENT, handleUpdate);

    return () => window.removeEventListener(SERVICE_WORKER_UPDATE_EVENT, handleUpdate);
  }, []);

  if (!updateAvailable) {
    return null;
  }

  return (
    <div className="app-banner app-banner-update" role="status">
      <span>Update available</span>
      <button className="button button-secondary" onClick={() => window.location.reload()} type="button">
        Reload
      </button>
    </div>
  );
};

export const AppLayout = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { selectedEvent, selectedRoles } = useEventContext();
  const isOnline = useOnlineStatus();
  const isEventListRoute = location.pathname === "/";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Swoogo Check-in</strong>
            <small>Operations</small>
          </div>
        </div>
        <NavItems />
      </aside>

      <div className="app-main">
        <header className={`topbar${isEventListRoute ? " topbar-simple" : ""}`}>
          {!isEventListRoute ? (
            <>
              <div className="topbar-event">
                <span>Event</span>
                <strong>{selectedEvent?.name ?? "No event selected"}</strong>
                <NavLink to="/">{selectedEvent ? "Change" : "Open events"}</NavLink>
              </div>
              <div className="topbar-status">
                <StatusBadge label={isOnline ? "Online" : "Offline"} tone={isOnline ? "good" : "warn"} />
                {selectedEvent ? <StatusBadge label={selectedEvent.status} tone="neutral" /> : null}
              </div>
            </>
          ) : null}
          <div className="user-menu">
            {!isEventListRoute ? (
              <>
                <span>{user?.displayName}</span>
                <small>{selectedRoles.join(" / ")}</small>
              </>
            ) : null}
            <button className="button button-secondary" onClick={() => void signOut()} type="button">
              Sign out
            </button>
          </div>
        </header>

        <main className="content">
          {!isOnline ? (
            <div className="app-banner app-banner-offline" role="status">
              Offline. Sensitive workflows stay blocked until the connection returns.
            </div>
          ) : null}
          <PwaUpdatePrompt />
          <AdminSubnav />
          <Outlet />
        </main>
      </div>
    </div>
  );
};
