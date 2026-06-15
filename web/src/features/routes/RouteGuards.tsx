import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { LoadingState } from "../../components/primitives";
import { useEventContext } from "../../context/EventContext";
import type { EventRole } from "../../types";

export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { status } = useAuth();

  if (status === "loading") {
    return <LoadingState label="Checking session" />;
  }

  if (status === "unauthenticated") {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  return <>{children}</>;
};

export const RequireEvent = ({ children }: { children: ReactNode }) => {
  const { eventsStatus, selectedEvent, selectedMembership } = useEventContext();

  if (!selectedEvent) {
    if (eventsStatus === "idle" || eventsStatus === "loading") {
      return <LoadingState label="Loading event context" />;
    }

    return <Navigate replace to="/event-required" />;
  }

  if (!selectedMembership?.active) {
    return <Navigate replace to="/inactive-member" />;
  }

  return <>{children}</>;
};

export const RequireActiveEvent = ({ children }: { children: ReactNode }) => {
  const { selectedEvent } = useEventContext();

  if (selectedEvent && (!selectedEvent.registration || selectedEvent.status !== "active")) {
    return <Navigate replace to="/inactive-event" />;
  }

  return <>{children}</>;
};

export const RoleGuard = ({
  children,
  roles,
}: {
  children: ReactNode;
  roles: EventRole[];
}) => {
  const { hasAnyRole } = useEventContext();

  if (!hasAnyRole(roles)) {
    return <Navigate replace to="/no-access" />;
  }

  return <>{children}</>;
};
