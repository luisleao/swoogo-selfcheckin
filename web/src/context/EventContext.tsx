import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { useApi } from "./ApiContext";
import type { EventMembership, EventRole, EventSummary } from "../types";

const SELECTED_EVENT_STORAGE_KEY = "swoogo.event.selected";
const OPERATIONAL_SELECTION_KEYS = [
  "swoogo.terminal.selected",
  "swoogo.session.selected",
  "swoogo.gate.selected",
];

export const MOCK_EVENTS: EventSummary[] = [
  {
    defaultQueueId: "standard",
    id: "demo-event",
    membership: {
      active: true,
      eventId: "demo-event",
      roles: [
        "event_admin",
        "pre_checkin_operator",
        "print_operator",
        "pickup_operator",
        "session_operator",
        "gate_operator",
        "dashboard_viewer",
        "layout_editor",
      ],
      scope: {
        allowedAreaIds: ["expo-floor", "vip-lounge"],
        allowedGateIds: ["north-gate"],
        allowedQueueIds: ["standard", "speaker"],
        allowedSessionIds: ["opening-keynote"],
      },
    },
    name: "Implementation Demo Event",
    registration: true,
    status: "active",
    swoogoBaseUrl: "https://api.swoogo.com",
    swoogoEventId: "8048",
    timezone: "America/Sao_Paulo",
  },
];

type EventsStatus = "idle" | "loading" | "ready" | "error";

interface EventContextValue {
  availableEvents: EventSummary[];
  eventsError: string | null;
  eventsStatus: EventsStatus;
  hasAnyRole: (roles: EventRole[]) => boolean;
  reloadEvents: () => Promise<EventSummary[]>;
  selectedEvent: EventSummary | null;
  selectedMembership: EventMembership | null;
  selectedRoles: EventRole[];
  selectEvent: (eventId: string) => void;
}

const EventContext = createContext<EventContextValue | undefined>(undefined);

const readSelectedEventId = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(SELECTED_EVENT_STORAGE_KEY);
};

const writeSelectedEventId = (eventId: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (eventId) {
    window.localStorage.setItem(SELECTED_EVENT_STORAGE_KEY, eventId);
    return;
  }

  window.localStorage.removeItem(SELECTED_EVENT_STORAGE_KEY);
};

const clearOperationalSelections = () => {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of OPERATIONAL_SELECTION_KEYS) {
    window.localStorage.removeItem(key);
  }
};

const emptyScope = {
  allowedAreaIds: [],
  allowedGateIds: [],
  allowedQueueIds: [],
  allowedSessionIds: [],
};

const allOperationalRoles: EventRole[] = [
  "event_admin",
  "event_manager",
  "pre_checkin_operator",
  "print_operator",
  "pickup_operator",
  "session_operator",
  "gate_operator",
  "dashboard_viewer",
  "layout_editor",
];

const isGlobalAdmin = (roles: EventRole[]) => roles.includes("super_admin");
const isGlobalEventManager = (roles: EventRole[]) => roles.includes("event_manager");

export const EventProvider = ({ children }: { children: ReactNode }) => {
  const api = useApi();
  const { authMode, status, user } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsStatus, setEventsStatus] = useState<EventsStatus>("idle");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(() => readSelectedEventId());
  const globalRoles = useMemo(() => user?.globalRoles ?? [], [user]);

  const reloadEvents = useCallback(async () => {
    if (authMode === "mock") {
      setEvents(MOCK_EVENTS);
      setEventsError(null);
      setEventsStatus("ready");
      return MOCK_EVENTS;
    }

    if (status !== "authenticated") {
      setEvents([]);
      setEventsError(null);
      setEventsStatus("idle");
      return [];
    }

    setEventsStatus("loading");

    try {
      const loadedEvents = await api.listMyEvents();
      setEvents(loadedEvents);
      setEventsError(null);
      setEventsStatus("ready");
      return loadedEvents;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load events.";
      setEvents([]);
      setEventsError(message);
      setEventsStatus("error");
      return [];
    }
  }, [api, authMode, status]);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  const availableEvents = events;

  const memberships = useMemo(() => {
    const byEventId = new Map<string, EventMembership>();

    for (const membership of user?.memberships ?? []) {
      if (membership.active) {
        byEventId.set(membership.eventId, membership);
      }
    }

    for (const event of availableEvents) {
      if (event.membership?.active) {
        byEventId.set(event.id, event.membership);
      } else if (isGlobalAdmin(globalRoles)) {
        byEventId.set(event.id, {
          active: true,
          eventId: event.id,
          roles: allOperationalRoles,
          scope: emptyScope,
        });
      }
    }

    return Array.from(byEventId.values());
  }, [availableEvents, globalRoles, user?.memberships]);

  const effectiveSelectedEventId = useMemo(() => {
    if (selectedEventId && availableEvents.some((event) => event.id === selectedEventId)) {
      return selectedEventId;
    }

    return null;
  }, [availableEvents, selectedEventId]);

  useEffect(() => {
    if (eventsStatus !== "ready") {
      return;
    }

    if (!availableEvents.length) {
      setSelectedEventId(null);
      writeSelectedEventId(null);
      return;
    }

    const currentSelectionIsValid = selectedEventId
      ? availableEvents.some((event) => event.id === selectedEventId)
      : false;

    if (selectedEventId && !currentSelectionIsValid) {
      setSelectedEventId(null);
      writeSelectedEventId(null);
    }
  }, [availableEvents, eventsStatus, selectedEventId]);

  const selectEvent = useCallback((eventId: string) => {
    const nextEventId = eventId || null;
    setSelectedEventId(nextEventId);
    writeSelectedEventId(nextEventId);
    clearOperationalSelections();
  }, []);

  const selectedEvent = useMemo(
    () => availableEvents.find((event) => event.id === effectiveSelectedEventId) ?? null,
    [availableEvents, effectiveSelectedEventId]
  );

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.eventId === effectiveSelectedEventId) ?? null,
    [memberships, effectiveSelectedEventId]
  );

  const selectedRoles = useMemo<EventRole[]>(() => {
    if (selectedMembership?.roles.length) {
      return selectedMembership.roles;
    }

    if (isGlobalAdmin(globalRoles)) {
      return ["super_admin"];
    }

    return isGlobalEventManager(globalRoles) ? ["event_manager"] : [];
  }, [globalRoles, selectedMembership]);

  const hasAnyRole = useCallback(
    (roles: EventRole[]) => {
      if (!roles.length) {
        return true;
      }

      if (isGlobalAdmin(globalRoles)) {
        return true;
      }

      if (selectedRoles.includes("event_admin")) {
        return true;
      }

      if (!selectedEvent) {
        return memberships.some((membership) =>
          membership.roles.some((role) => roles.includes(role))
        ) || roles.some((role) => globalRoles.includes(role));
      }

      return roles.some((role) => selectedRoles.includes(role) || globalRoles.includes(role));
    },
    [globalRoles, memberships, selectedEvent, selectedRoles]
  );

  const value = useMemo<EventContextValue>(
    () => ({
      availableEvents,
      eventsError,
      eventsStatus,
      hasAnyRole,
      reloadEvents,
      selectedEvent,
      selectedMembership,
      selectedRoles,
      selectEvent,
    }),
    [
      availableEvents,
      eventsError,
      eventsStatus,
      hasAnyRole,
      reloadEvents,
      selectedEvent,
      selectedMembership,
      selectedRoles,
      selectEvent,
    ]
  );

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
};

export const useEventContext = () => {
  const value = useContext(EventContext);

  if (!value) {
    throw new Error("useEventContext must be used within EventProvider");
  }

  return value;
};
