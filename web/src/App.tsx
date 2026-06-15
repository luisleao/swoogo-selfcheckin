import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";

import { FirebaseAuthBoundary } from "./auth/AuthBoundary";
import { AuthProvider } from "./auth/AuthContext";
import { LoadingState } from "./components/primitives";
import { ApiProvider } from "./context/ApiContext";
import { EventProvider } from "./context/EventContext";
import { useEventContext } from "./context/EventContext";
import {
  AreasSessionsScreen,
  AttendeesScreen,
  EventConfigScreen,
  EventDetailScreen,
  QueuesTerminalsScreen,
  SendGridConfigScreen,
  SwoogoConfigScreen,
  UsersRolesScreen,
} from "./features/admin/AdminScreens";
import {
  EventRequiredScreen,
  InactiveEventScreen,
  InactiveMemberScreen,
  MissingTerminalScreen,
  NoAccessScreen,
  SignInScreen,
} from "./features/app/Screens";
import {
  DashboardScreen,
  LayoutEditorScreen,
  PreCheckInScreen,
  UnifiedScanScreen,
} from "./features/operations/OperationalScreens";
import { RequireActiveEvent, RequireAuth, RequireEvent, RoleGuard } from "./features/routes/RouteGuards";
import { eventPath } from "./features/routes/routes";
import { PrintPickupScreen } from "./features/terminal/PrintPickupScreen";
import { AppLayout } from "./layouts/AppLayout";

const guarded = (roles: Parameters<typeof RoleGuard>[0]["roles"], element: ReactNode) => (
  <RequireEvent>
    <RoleGuard roles={roles}>{element}</RoleGuard>
  </RequireEvent>
);

const operational = (roles: Parameters<typeof RoleGuard>[0]["roles"], element: ReactNode) => (
  <RequireEvent>
    <RequireActiveEvent>
      <RoleGuard roles={roles}>{element}</RoleGuard>
    </RequireActiveEvent>
  </RequireEvent>
);

const EventSlugBoundary = () => {
  const { eventSlug } = useParams();
  const {
    availableEvents,
    eventsStatus,
    selectEvent,
    selectedEvent,
  } = useEventContext();

  useEffect(() => {
    if (eventSlug && selectedEvent?.id !== eventSlug) {
      selectEvent(eventSlug);
    }
  }, [eventSlug, selectEvent, selectedEvent?.id]);

  if (!eventSlug) {
    return <Navigate replace to="/" />;
  }

  if (selectedEvent?.id === eventSlug) {
    return <Outlet />;
  }

  if (eventsStatus === "idle" || eventsStatus === "loading") {
    return <LoadingState label="Loading event context" />;
  }

  if (availableEvents.some((event) => event.id === eventSlug)) {
    return <LoadingState label="Selecting event" />;
  }

  return <Navigate replace to="/" />;
};

const LegacySelectedEventRedirect = ({ path = "" }: { path?: string }) => {
  const { selectedEvent } = useEventContext();

  return <Navigate replace to={selectedEvent ? eventPath(selectedEvent.id, path) : "/"} />;
};

const LegacyEventParamRedirect = ({ path = "" }: { path?: string }) => {
  const { eventSlug } = useParams();

  return <Navigate replace to={eventSlug ? eventPath(eventSlug, path) : "/"} />;
};

const AppRoutes = () => (
  <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
    <Routes>
      <Route path="/login" element={<SignInScreen />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
        path="/"
      >
        <Route path="event-required" element={<EventRequiredScreen />} />
        <Route path="inactive-member" element={<InactiveMemberScreen />} />
        <Route path="inactive-event" element={<InactiveEventScreen />} />
        <Route path="missing-terminal" element={<MissingTerminalScreen />} />
        <Route path="no-access" element={<NoAccessScreen />} />
        <Route index element={<EventConfigScreen />} />

        <Route path="admin/event" element={<Navigate replace to="/" />} />
        <Route path="admin/event/:eventSlug" element={<LegacyEventParamRedirect path="admin" />} />
        <Route path="admin/attendees" element={<LegacySelectedEventRedirect path="attendees" />} />
        <Route path="admin/swoogo" element={<LegacySelectedEventRedirect path="admin/swoogo" />} />
        <Route path="admin/sendgrid" element={<LegacySelectedEventRedirect path="admin/sendgrid" />} />
        <Route path="admin/users-roles" element={<LegacySelectedEventRedirect path="admin/users-roles" />} />
        <Route path="admin/areas-sessions" element={<LegacySelectedEventRedirect path="admin/areas-sessions" />} />
        <Route path="admin/gates-sessions" element={<LegacySelectedEventRedirect path="admin/areas-sessions" />} />
        <Route path="admin/queues-terminals" element={<LegacySelectedEventRedirect path="admin/queues-terminals" />} />
        <Route path="pre-check-in" element={<LegacySelectedEventRedirect path="checkin" />} />
        <Route path="print-pickup" element={<LegacySelectedEventRedirect path="print" />} />
        <Route path="sessions" element={<LegacySelectedEventRedirect path="scan" />} />
        <Route path="gates" element={<LegacySelectedEventRedirect path="scan" />} />
        <Route path="dashboard" element={<LegacySelectedEventRedirect />} />
        <Route path="layout-editor" element={<LegacySelectedEventRedirect path="layout" />} />

        <Route path=":eventSlug" element={<EventSlugBoundary />}>
          <Route index element={guarded(["dashboard_viewer"], <DashboardScreen />)} />
          <Route path="admin" element={guarded(["event_admin", "event_manager"], <EventDetailScreen />)} />
          <Route path="admin/swoogo" element={guarded(["event_admin", "event_manager"], <SwoogoConfigScreen />)} />
          <Route path="admin/sendgrid" element={guarded(["event_admin", "event_manager"], <SendGridConfigScreen />)} />
          <Route path="admin/users-roles" element={guarded(["event_admin"], <UsersRolesScreen />)} />
          <Route path="admin/areas-sessions" element={guarded(["event_admin", "event_manager"], <AreasSessionsScreen />)} />
          <Route path="admin/queues-terminals" element={guarded(["event_admin", "event_manager"], <QueuesTerminalsScreen />)} />
          <Route path="attendees" element={guarded(["event_admin", "event_manager"], <AttendeesScreen />)} />
          <Route path="checkin" element={operational(["pre_checkin_operator"], <PreCheckInScreen />)} />
          <Route path="print" element={operational(["print_operator", "pickup_operator"], <PrintPickupScreen />)} />
          <Route path="scan" element={operational(["session_operator", "gate_operator"], <UnifiedScanScreen />)} />
          <Route path="layout" element={guarded(["layout_editor"], <LayoutEditorScreen />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  </BrowserRouter>
);

export const App = () => (
  <AuthProvider>
    <ApiProvider>
      <EventProvider>
        <FirebaseAuthBoundary>
          <AppRoutes />
        </FirebaseAuthBoundary>
      </EventProvider>
    </ApiProvider>
  </AuthProvider>
);
