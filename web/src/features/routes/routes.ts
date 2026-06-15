import type { EventRole } from "../../types";

export interface AppNavItem {
  label: string;
  path: string;
  roles: EventRole[];
}

export const DEFAULT_AUTHENTICATED_ROUTE = "/";

export const PRIMARY_NAV_ITEMS: AppNavItem[] = [
  { label: "Dashboard", path: "", roles: ["dashboard_viewer"] },
  { label: "Admin", path: "admin", roles: ["event_admin", "event_manager"] },
  { label: "Attendees", path: "attendees", roles: ["event_admin", "event_manager"] },
  { label: "Check-in", path: "checkin", roles: ["pre_checkin_operator"] },
  { label: "Print", path: "print", roles: ["print_operator", "pickup_operator"] },
  { label: "Scan", path: "scan", roles: ["session_operator", "gate_operator"] },
  { label: "Layout", path: "layout", roles: ["layout_editor"] },
];

export const ADMIN_NAV_ITEMS: AppNavItem[] = [
  { label: "Event", path: "admin", roles: ["event_admin", "event_manager"] },
  { label: "Swoogo", path: "admin/swoogo", roles: ["event_admin", "event_manager"] },
  { label: "SendGrid", path: "admin/sendgrid", roles: ["event_admin", "event_manager"] },
  { label: "Event members", path: "admin/users-roles", roles: ["event_admin"] },
  { label: "Areas and sessions", path: "admin/areas-sessions", roles: ["event_admin", "event_manager"] },
  { label: "Queues and terminals", path: "admin/queues-terminals", roles: ["event_admin", "event_manager"] },
];

export const eventPath = (eventSlug: string, path = "") => {
  const suffix = path.replace(/^\/+/, "").replace(/\/+$/, "");

  return suffix ? `/${eventSlug}/${suffix}` : `/${eventSlug}`;
};
