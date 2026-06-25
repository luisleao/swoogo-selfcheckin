import type { ApiClient } from "./client";
import type { ConnectionTestResult, EventRole, EventSummary, EventStatus } from "../types";

export interface EventUpsertRequest {
  defaultBadgeLayoutId?: string | null;
  defaultQueueId?: string;
  eventId?: string;
  name: string;
  registration?: boolean;
  status: EventStatus;
  swoogoBaseUrl?: string;
  swoogoEventId?: string | null;
  timezone: string;
}

export interface SwoogoConfig {
  baseUrl: string;
  credentialsConfigured: boolean;
  credentialsUpdatedAt: string | null;
  eventId: string;
  lastTest: ConnectionTestResult;
  registrationTypeCount: number;
}

export interface SwoogoConfigSaveRequest {
  apiKey?: string;
  baseUrl: string;
  clearRegistrationTypesOnEventChange?: boolean;
  consumerKey?: string;
  consumerSecret?: string;
  eventId: string;
}

export interface SwoogoRegistrationTypesImportRequest extends SwoogoConfigSaveRequest {
  replaceExisting?: boolean;
}

export interface SwoogoRegistrationTypesImportResult {
  config: SwoogoConfig;
  importedCount: number;
  registrationTypes: RegistrationTypeSummary[];
}

export interface SwoogoParticipantsImportRequest extends Partial<SwoogoConfigSaveRequest> {
  maxPages?: number;
  perPage?: number;
}

export interface SwoogoParticipantsImportResult {
  createdCount: number;
  importedCount: number;
  participantIds: string[];
  skippedCount: number;
  updatedCount: number;
}

export interface SwoogoCacheClearResult {
  config: SwoogoConfig;
  participantsDeletedCount: number;
  participantsSkippedCount: number;
  registrationTypesDeletedCount: number;
}

export type SwoogoConfigTestRequest = Omit<SwoogoConfigSaveRequest, "clearRegistrationTypesOnEventChange">;

export interface SendGridConfig {
  availableTemplates: SendGridTemplateSummary[];
  credentialsConfigured: boolean;
  credentialsUpdatedAt: string | null;
  fromEmail: string;
  fromName: string;
  lastTest: ConnectionTestResult;
  replyToEmail: string;
  templates: Record<string, string>;
  templatesCachedAt: string | null;
}

export interface SendGridTemplateSummary {
  id: string;
  name: string;
  updatedAt: string | null;
}

export interface SendGridConfigSaveRequest {
  apiKey?: string;
  fromEmail: string;
  fromName: string;
  replyToEmail: string;
  templates: Record<string, string>;
}

export type SendGridConfigTestRequest = Partial<SendGridConfigSaveRequest>;

export interface EventRoleAssignment {
  email: string;
  name: string;
  roles: EventRole[];
  scope: {
    allowedAreaIds: string[];
    allowedGateIds: string[];
    allowedQueueIds: string[];
    allowedSessionIds: string[];
  };
  scopeModes: {
    areas: "all" | "none" | "selected";
    gates: "all" | "none" | "selected";
    queues: "all" | "none" | "selected";
    sessions: "all" | "none" | "selected";
  };
  uid: string;
}

export interface EventRoleUpsertRequest {
  email: string;
  name: string;
  roles: EventRole[];
  scope: EventRoleAssignment["scope"];
  scopeModes: EventRoleAssignment["scopeModes"];
}

export interface AdminUserSummary {
  createdAt: string | null;
  disabled: boolean;
  displayName: string;
  email: string;
  source: "auth" | "firestore" | "merged";
  uid: string;
}

export interface AdminUserCreateRequest {
  displayName: string;
  email: string;
  password: string;
}

export interface AreaSummary {
  id: string;
  name: string;
  registrationTypeIds: string[];
  status: "active" | "paused" | "disabled";
}

export interface AreaUpsertRequest {
  name: string;
  registrationTypeIds: string[];
  status: AreaSummary["status"];
}

export interface GateSummary {
  areaId: string;
  id: string;
  name: string;
  status: "active" | "paused" | "disabled";
}

export interface GateUpsertRequest {
  areaId: string;
  name: string;
  status: GateSummary["status"];
}

export interface RegistrationTypeSummary {
  id: string;
  name: string;
}

export interface SessionSummary {
  areaId: string;
  id: string;
  name: string;
  status: "active" | "paused" | "disabled";
  swoogoSessionId: string;
}

export interface SessionUpsertRequest {
  areaId: string;
  name: string;
  status: SessionSummary["status"];
  swoogoSessionId: string;
}

export interface QueueSummary {
  activeTerminalCount: number;
  id: string;
  name: string;
  registrationTypeIds: string[];
  status: "active" | "paused" | "disabled";
}

export interface QueueUpsertRequest {
  name: string;
  registrationTypeIds: string[];
  status: QueueSummary["status"];
}

export interface DeleteQueueResult {
  deleted: boolean;
  id: string;
}

export interface AttendeeSummary {
  activeBadgeId: string;
  company: string;
  credentialStatus: string;
  email: string;
  id: string;
  jobTitle: string;
  name: string;
  registrationTypeId: string;
  swoogoRegistrantId: string;
}

export type AttendeeEventRecord = Record<string, unknown> & { id: string };

export interface AttendeeDetail {
  areaPassages: AttendeeEventRecord[];
  attendee: AttendeeSummary;
  credentials: AttendeeEventRecord[];
  participant: AttendeeEventRecord;
  participantAccessPassages: AttendeeEventRecord[];
  printJobs: AttendeeEventRecord[];
  sessionCheckins: AttendeeEventRecord[];
}

export interface ReissueCredentialResult {
  attendee: AttendeeSummary;
  credentialBadgeId: string;
  printJobId: string;
}

export interface TerminalSummary {
  id: string;
  lastHeartbeatAt: string | null;
  name: string;
  queueIds: string[];
  status: "online" | "offline" | "disabled";
  type: "pre-check-in" | "print" | "pickup";
}

export interface TerminalUpsertRequest {
  name: string;
  queueIds: string[];
  status: TerminalSummary["status"];
  type: TerminalSummary["type"];
}

export interface DeleteTerminalResult {
  deleted: boolean;
  id: string;
}

export const createAdminApi = (client: ApiClient) => ({
  createArea: (eventId: string, body: AreaUpsertRequest) =>
    client.post<AreaSummary, AreaUpsertRequest>(`/api/events/${eventId}/areas`, body),
  createGate: (eventId: string, body: GateUpsertRequest) =>
    client.post<GateSummary, GateUpsertRequest>(`/api/events/${eventId}/gates`, body),
  createQueue: (eventId: string, body: QueueUpsertRequest) =>
    client.post<QueueSummary, QueueUpsertRequest>(`/api/events/${eventId}/queues`, body),
  deleteQueue: (eventId: string, queueId: string) =>
    client.delete<DeleteQueueResult>(`/api/events/${eventId}/queues/${queueId}`),
  createSession: (eventId: string, body: SessionUpsertRequest) =>
    client.post<SessionSummary, SessionUpsertRequest>(`/api/events/${eventId}/sessions`, body),
  createTerminal: (eventId: string, body: TerminalUpsertRequest) =>
    client.post<TerminalSummary, TerminalUpsertRequest>(`/api/events/${eventId}/terminals`, body),
  deleteTerminal: (eventId: string, terminalId: string) =>
    client.delete<DeleteTerminalResult>(`/api/events/${eventId}/terminals/${terminalId}`),
  createEvent: (body: EventUpsertRequest) => client.post<EventSummary, EventUpsertRequest>("/api/events", body),
  createUser: (eventId: string, body: AdminUserCreateRequest) =>
    client.post<AdminUserSummary, AdminUserCreateRequest>(`/api/events/${eventId}/users`, body),
  getEvent: (eventId: string) => client.get<EventSummary>(`/api/events/${eventId}`),
  getSendGridConfig: (eventId: string) =>
    client.get<SendGridConfig>(`/api/events/${eventId}/integrations/sendgrid`),
  getSwoogoConfig: (eventId: string) =>
    client.get<SwoogoConfig>(`/api/events/${eventId}/integrations/swoogo`),
  listEvents: () => client.get<EventSummary[]>("/api/events?registration=true"),
  listAreas: (eventId: string) => client.get<AreaSummary[]>(`/api/events/${eventId}/areas`),
  listAttendees: (eventId: string) => client.get<AttendeeSummary[]>(`/api/events/${eventId}/attendees`),
  getAttendeeDetail: (eventId: string, attendeeId: string) =>
    client.get<AttendeeDetail>(`/api/events/${eventId}/attendees/${encodeURIComponent(attendeeId)}`),
  listGates: (eventId: string) => client.get<GateSummary[]>(`/api/events/${eventId}/gates`),
  listMyEvents: () => client.get<EventSummary[]>("/api/me/events"),
  listQueues: (eventId: string) => client.get<QueueSummary[]>(`/api/events/${eventId}/queues`),
  listRegistrationTypes: (eventId: string) =>
    client.get<RegistrationTypeSummary[]>(`/api/events/${eventId}/registration-types`),
  listSessions: (eventId: string) => client.get<SessionSummary[]>(`/api/events/${eventId}/sessions`),
  listSendGridTemplates: (eventId: string, body: Partial<SendGridConfigSaveRequest> = {}) =>
    Object.keys(body).length > 0
      ? client.post<SendGridTemplateSummary[], Partial<SendGridConfigSaveRequest>>(
          `/api/events/${eventId}/integrations/sendgrid/templates`,
          body
        )
      : client.get<SendGridTemplateSummary[]>(`/api/events/${eventId}/integrations/sendgrid/templates`),
  listTerminals: (eventId: string) => client.get<TerminalSummary[]>(`/api/events/${eventId}/terminals`),
  listUsers: (eventId: string) => client.get<AdminUserSummary[]>(`/api/events/${eventId}/users`),
  listUsersAndRoles: (eventId: string) =>
    client.get<EventRoleAssignment[]>(`/api/events/${eventId}/roles`),
  saveUserRole: (eventId: string, uid: string, body: EventRoleUpsertRequest) =>
    client.put<EventRoleAssignment, EventRoleUpsertRequest>(
      `/api/events/${eventId}/roles/${encodeURIComponent(uid)}`,
      body
    ),
  reissueCredential: (eventId: string, attendeeId: string) =>
    client.post<ReissueCredentialResult, Record<string, never>>(
      `/api/events/${eventId}/attendees/${encodeURIComponent(attendeeId)}/credentials/reissue`,
      {}
    ),
  saveSendGridConfig: (eventId: string, body: SendGridConfigSaveRequest) =>
    client.put<SendGridConfig, SendGridConfigSaveRequest>(`/api/events/${eventId}/integrations/sendgrid`, body),
  saveSwoogoConfig: (eventId: string, body: SwoogoConfigSaveRequest) =>
    client.put<SwoogoConfig, SwoogoConfigSaveRequest>(`/api/events/${eventId}/integrations/swoogo`, body),
  importSwoogoRegistrationTypes: (eventId: string, body: SwoogoRegistrationTypesImportRequest) =>
    client.post<SwoogoRegistrationTypesImportResult, SwoogoRegistrationTypesImportRequest>(
      `/api/events/${eventId}/integrations/swoogo/registration-types/import`,
      body
    ),
  importSwoogoParticipants: (eventId: string, body: SwoogoParticipantsImportRequest = {}) =>
    client.post<SwoogoParticipantsImportResult, SwoogoParticipantsImportRequest>(
      `/api/events/${eventId}/integrations/swoogo/participants/import`,
      body
    ),
  clearSwoogoCache: (eventId: string) =>
    client.delete<SwoogoCacheClearResult>(`/api/events/${eventId}/integrations/swoogo/cache`),
  testSendGrid: (eventId: string, body: SendGridConfigTestRequest = {}) =>
    client.post<ConnectionTestResult, SendGridConfigTestRequest>(
      `/api/events/${eventId}/integrations/sendgrid/test`,
      body
    ),
  testSwoogo: (eventId: string, body: Partial<SwoogoConfigTestRequest> = {}) =>
    client.post<ConnectionTestResult, Partial<SwoogoConfigTestRequest>>(
      `/api/events/${eventId}/integrations/swoogo/test`,
      body
    ),
  updateEvent: (eventId: string, body: EventUpsertRequest) =>
    client.put<EventSummary, EventUpsertRequest>(`/api/events/${eventId}`, body),
  updateArea: (eventId: string, areaId: string, body: AreaUpsertRequest) =>
    client.put<AreaSummary, AreaUpsertRequest>(`/api/events/${eventId}/areas/${areaId}`, body),
  updateGate: (eventId: string, gateId: string, body: GateUpsertRequest) =>
    client.put<GateSummary, GateUpsertRequest>(`/api/events/${eventId}/gates/${gateId}`, body),
  updateQueue: (eventId: string, queueId: string, body: QueueUpsertRequest) =>
    client.put<QueueSummary, QueueUpsertRequest>(`/api/events/${eventId}/queues/${queueId}`, body),
  updateSession: (eventId: string, sessionId: string, body: SessionUpsertRequest) =>
    client.put<SessionSummary, SessionUpsertRequest>(`/api/events/${eventId}/sessions/${sessionId}`, body),
  updateTerminal: (eventId: string, terminalId: string, body: TerminalUpsertRequest) =>
    client.put<TerminalSummary, TerminalUpsertRequest>(`/api/events/${eventId}/terminals/${terminalId}`, body),
});
