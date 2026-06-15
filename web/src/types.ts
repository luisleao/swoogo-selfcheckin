export type AppMode =
  | "admin"
  | "pre-check-in"
  | "print-pickup"
  | "sessions"
  | "gates"
  | "dashboard"
  | "layout-editor";

export type EventRole =
  | "super_admin"
  | "event_admin"
  | "event_manager"
  | "pre_checkin_operator"
  | "print_operator"
  | "pickup_operator"
  | "session_operator"
  | "gate_operator"
  | "dashboard_viewer"
  | "layout_editor";

export type EventStatus = "draft" | "active" | "paused" | "archived";

export interface RoleScope {
  allowedAreaIds: string[];
  allowedGateIds: string[];
  allowedQueueIds: string[];
  allowedSessionIds: string[];
}

export interface EventMembership {
  active: boolean;
  eventId: string;
  roles: EventRole[];
  scope: RoleScope;
}

export interface AuthUser {
  displayName: string;
  email: string;
  globalRoles: EventRole[];
  memberships: EventMembership[];
  uid: string;
}

export interface EventSummary {
  defaultQueueId?: string;
  id: string;
  membership?: EventMembership;
  name: string;
  registration: boolean;
  status: EventStatus;
  swoogoBaseUrl?: string;
  swoogoEventId?: string | null;
  timezone: string;
}

export type ConnectionStatus = "untested" | "success" | "failure";

export interface ConnectionTestResult {
  checkedAt: string | null;
  message: string;
  status: ConnectionStatus;
}

export type ScannerResultState =
  | "ready"
  | "scanning"
  | "allowed"
  | "denied"
  | "duplicate"
  | "invalid_badge"
  | "invalid_participant"
  | "sync_failure"
  | "offline_pending"
  | "blocked";
