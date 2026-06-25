import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ConfirmationModal,
  DataTable,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  Modal,
  StatusBadge,
  Toast,
} from "../../components/primitives";
import type {
  AdminUserSummary,
  AreaSummary,
  AreaUpsertRequest,
  AttendeeDetail,
  AttendeeSummary,
  EventRoleAssignment,
  EventRoleUpsertRequest,
  QueueSummary,
  QueueUpsertRequest,
  RegistrationTypeSummary,
  SendGridConfig,
  SendGridConfigSaveRequest,
  SendGridTemplateSummary,
  SessionSummary,
  SessionUpsertRequest,
  SwoogoConfig,
  SwoogoConfigSaveRequest,
  TerminalSummary,
  TerminalUpsertRequest,
} from "../../api/admin";
import { useApi } from "../../context/ApiContext";
import { useEventContext } from "../../context/EventContext";
import type { EventRole, EventStatus, EventSummary } from "../../types";
import { eventPath } from "../routes/routes";

const eventStatuses: EventStatus[] = ["draft", "active", "paused", "archived"];
const preferredTimezones = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Recife",
  "America/Fortaleza",
  "America/Rio_Branco",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];
const fallbackTimezones = [
  ...preferredTimezones,
  "Africa/Johannesburg",
  "America/Asuncion",
  "America/Caracas",
  "America/Montevideo",
  "America/Panama",
  "America/Puerto_Rico",
  "America/Toronto",
  "Asia/Seoul",
  "Europe/Amsterdam",
  "Europe/Lisbon",
  "Pacific/Auckland",
];
const browserTimezones =
  (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf?.("timeZone") ?? [];
const timezoneOptions = Array.from(new Set([...preferredTimezones, ...(browserTimezones.length > 0 ? browserTimezones : fallbackTimezones)]))
  .sort((left, right) => left.localeCompare(right));
const secondaryTimezones = timezoneOptions.filter((timezone) => !preferredTimezones.includes(timezone));
const eventRoleOptions: EventRole[] = [
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
const queueStatuses: QueueSummary["status"][] = ["active", "paused", "disabled"];
const resourceStatuses: AreaSummary["status"][] = ["active", "paused", "disabled"];
const terminalStatuses: TerminalSummary["status"][] = ["online", "offline", "disabled"];
const terminalTypes: TerminalSummary["type"][] = ["pre-check-in", "print", "pickup"];
const scopeModeOptions = ["all", "selected", "none"] as const;
const sendGridTemplatePurposes = [
  "credential_confirmation",
  "manual_registration_confirmation",
  "badge_reissue_confirmation",
  "session_reminder",
];

const emptyConnection = {
  checkedAt: null,
  message: "Not tested",
  status: "untested" as const,
};

const defaultSwoogoConfig: SwoogoConfig = {
  baseUrl: "https://api.swoogo.com",
  credentialsConfigured: false,
  credentialsUpdatedAt: null,
  eventId: "",
  lastTest: emptyConnection,
  registrationTypeCount: 0,
};

const defaultSendGridConfig: SendGridConfig = {
  availableTemplates: [],
  credentialsConfigured: false,
  credentialsUpdatedAt: null,
  fromEmail: "",
  fromName: "",
  lastTest: emptyConnection,
  replyToEmail: "",
  templates: {
    credential_confirmation: "",
    manual_registration_confirmation: "",
    badge_reissue_confirmation: "",
  },
  templatesCachedAt: null,
};

const slugifyEventId = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

interface EventFormState {
  defaultQueueId: string;
  eventId: string;
  name: string;
  registration: boolean;
  status: EventStatus;
  timezone: string;
}

const defaultEventForm: EventFormState = {
  defaultQueueId: "",
  eventId: "",
  name: "",
  registration: true,
  status: "draft",
  timezone: "America/Sao_Paulo",
};

const eventFormFromEvent = (event: EventSummary | null): EventFormState => {
  if (!event) {
    return defaultEventForm;
  }

  return {
    defaultQueueId: event.defaultQueueId ?? "",
    eventId: event.id,
    name: event.name,
    registration: event.registration,
    status: event.status,
    timezone: event.timezone || "America/Sao_Paulo",
  };
};

const eventRequestFromForm = (form: EventFormState) => ({
  defaultQueueId: form.defaultQueueId.trim() || undefined,
  eventId: form.eventId.trim(),
  name: form.name.trim(),
  registration: form.registration,
  status: form.status,
  timezone: form.timezone.trim(),
});

const eventDetailPath = (eventId: string) => `/${eventId}/admin`;

const TimezoneSelect = ({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) => {
  const knownTimezone = timezoneOptions.includes(value);

  return (
    <select onChange={(event) => onChange(event.target.value)} required value={value}>
      {!knownTimezone && value ? <option value={value}>{value} (saved)</option> : null}
      <optgroup label="Common event timezones">
        {preferredTimezones.map((timezone) => (
          <option key={timezone} value={timezone}>
            {timezone}
          </option>
        ))}
      </optgroup>
      <optgroup label="All timezones">
        {secondaryTimezones.map((timezone) => (
          <option key={timezone} value={timezone}>
            {timezone}
          </option>
        ))}
      </optgroup>
    </select>
  );
};

const PageFrame = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => {
  const { selectedEvent } = useEventContext();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin configuration</p>
          <h1>{title}</h1>
        </div>
        {selectedEvent ? <StatusBadge label={selectedEvent.name} tone="neutral" /> : null}
      </header>
      {children}
    </div>
  );
};

export const EventConfigScreen = () => {
  const api = useApi();
  const {
    availableEvents,
    eventsError,
    eventsStatus,
    reloadEvents,
    selectEvent,
  } = useEventContext();
  const navigate = useNavigate();
  const [createForm, setCreateForm] = useState<EventFormState>(defaultEventForm);
  const [isSlugManual, setIsSlugManual] = useState(false);
  const [activeModal, setActiveModal] = useState<"create" | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"create" | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    selectEvent("");
  }, [selectEvent]);

  useEffect(() => {
    if (eventsStatus === "ready" && availableEvents.length === 0) {
      setActiveModal("create");
    }
  }, [availableEvents.length, eventsStatus]);

  const updateCreateForm = <TKey extends keyof EventFormState>(key: TKey, value: EventFormState[TKey]) => {
    setCreateForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleCreateNameChange = (value: string) => {
    setCreateForm((current) => ({
      ...current,
      eventId: isSlugManual ? current.eventId : slugifyEventId(value),
      name: value,
    }));
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setToast(null);
    setSubmittingAction("create");

    try {
      const createdEvent = await api.createEvent(eventRequestFromForm(createForm));
      await reloadEvents();
      selectEvent(createdEvent.id);
      setCreateForm(defaultEventForm);
      setIsSlugManual(false);
      setActiveModal(null);
      setToast({ message: "Credentialing event created.", tone: "good" });
      navigate(eventDetailPath(createdEvent.id));
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to create event.",
        tone: "bad",
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const openCreatePanel = () => {
    setActiveModal("create");
  };

  return (
    <PageFrame title="Events">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {eventsError ? <Toast message={eventsError} tone="bad" /> : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Events</h2>
          </div>
          <div className="panel-actions">
            <button className="button button-secondary" onClick={() => void reloadEvents()} type="button">
              Refresh
            </button>
            <button className="button button-primary" onClick={openCreatePanel} type="button">
              Create event
            </button>
          </div>
        </div>
        {eventsStatus === "loading" ? (
          <LoadingState label="Loading events" />
        ) : availableEvents.length === 0 ? (
          <EmptyState
            action={
              <button className="button button-primary" onClick={openCreatePanel} type="button">
                Create Firestore event
              </button>
            }
            description="Create the first credentialing event in Firestore."
            title="No credentialing events"
          />
        ) : (
          <div className="event-list">
            {availableEvents.map((event) => (
              <Link
                className="event-list-item"
                key={event.id}
                onClick={() => {
                  selectEvent(event.id);
                }}
                to={eventDetailPath(event.id)}
              >
                <span className="event-list-main">
                  <span className="event-list-title">
                    <strong>{event.name}</strong>
                    <small>{event.id}</small>
                  </span>
                  <span className="event-list-badges">
                    <StatusBadge label={event.status} tone={event.status === "active" ? "good" : "warn"} />
                    <StatusBadge
                      label={event.registration ? "credentialing" : "disabled"}
                      tone={event.registration ? "good" : "warn"}
                    />
                  </span>
                </span>
                <span className="event-list-meta">
                  <span>{event.timezone}</span>
                  <span>{event.swoogoEventId ? `Swoogo ${event.swoogoEventId}` : "Swoogo not set"}</span>
                  <span>{event.defaultQueueId ? `Queue ${event.defaultQueueId}` : "No default queue"}</span>
                </span>
                <span className="event-list-action">Open configuration</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {activeModal === "create" ? (
        <Modal onClose={() => setActiveModal(null)} title="Create event">
        <form className="form-grid" onSubmit={(event) => void handleCreate(event)}>
          <div className="panel-header form-grid-full">
            <div>
              <p>Create a credentialing event in the attendee-registry Firestore database.</p>
            </div>
            <StatusBadge label="attendee-registry" tone="neutral" />
          </div>
          <FormField label="Event name">
            <input
              onChange={(event) => handleCreateNameChange(event.target.value)}
              required
              value={createForm.name}
            />
          </FormField>
          <FormField label="Event slug">
            <input
              onChange={(event) => {
                setIsSlugManual(true);
                updateCreateForm("eventId", slugifyEventId(event.target.value));
              }}
              pattern="[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?"
              required
              value={createForm.eventId}
            />
          </FormField>
          <FormField label="Timezone">
            <TimezoneSelect onChange={(value) => updateCreateForm("timezone", value)} value={createForm.timezone} />
          </FormField>
          <FormField label="Status">
            <select
              onChange={(event) => updateCreateForm("status", event.target.value as EventStatus)}
              value={createForm.status}
            >
              {eventStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Registration">
            <span className="checkbox-field">
              <input
                checked={createForm.registration}
                onChange={(event) => updateCreateForm("registration", event.target.checked)}
                type="checkbox"
              />
              <span>{createForm.registration ? "Enabled" : "Disabled"}</span>
            </span>
          </FormField>
          <div className="form-actions form-grid-full">
            <button className="button button-primary" disabled={submittingAction === "create"} type="submit">
              {submittingAction === "create" ? "Creating" : "Create event"}
            </button>
          </div>
        </form>
        </Modal>
      ) : null}

    </PageFrame>
  );
};

export const EventDetailScreen = () => {
  const api = useApi();
  const { eventSlug } = useParams();
  const {
    availableEvents,
    eventsError,
    eventsStatus,
    reloadEvents,
    selectEvent,
  } = useEventContext();
  const [fallbackEvent, setFallbackEvent] = useState<EventSummary | null>(null);
  const [fallbackStatus, setFallbackStatus] = useState<"idle" | "loading" | "error">("idle");
  const [editForm, setEditForm] = useState<EventFormState>(defaultEventForm);
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [queuesError, setQueuesError] = useState<string | null>(null);
  const [queuesStatus, setQueuesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [submittingAction, setSubmittingAction] = useState<"update" | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);
  const detailEvent = availableEvents.find((event) => event.id === eventSlug) ?? fallbackEvent;

  useEffect(() => {
    if (eventSlug) {
      selectEvent(eventSlug);
    }
  }, [eventSlug, selectEvent]);

  useEffect(() => {
    setFallbackEvent(null);

    if (!eventSlug || availableEvents.some((event) => event.id === eventSlug) || eventsStatus === "idle" || eventsStatus === "loading") {
      return;
    }

    setFallbackStatus("loading");
    void api.getEvent(eventSlug)
      .then((loadedEvent) => {
        setFallbackEvent(loadedEvent);
        setFallbackStatus("idle");
      })
      .catch(() => {
        setFallbackStatus("error");
      });
  }, [api, availableEvents, eventSlug, eventsStatus]);

  useEffect(() => {
    setEditForm(eventFormFromEvent(detailEvent));
  }, [detailEvent]);

  useEffect(() => {
    if (!eventSlug) {
      setQueues([]);
      setQueuesError(null);
      setQueuesStatus("idle");
      return;
    }

    setQueuesStatus("loading");
    void api.listQueues(eventSlug)
      .then((loadedQueues) => {
        setQueues(loadedQueues);
        setQueuesError(null);
        setQueuesStatus("ready");
      })
      .catch((error) => {
        setQueues([]);
        setQueuesError(error instanceof Error ? error.message : "Unable to load queues.");
        setQueuesStatus("error");
      });
  }, [api, eventSlug]);

  const updateEditForm = <TKey extends keyof EventFormState>(key: TKey, value: EventFormState[TKey]) => {
    setEditForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!detailEvent) {
      return;
    }

    setToast(null);
    setSubmittingAction("update");

    try {
      const updatedEvent = await api.updateEvent(
        detailEvent.id,
        eventRequestFromForm({
          ...editForm,
          eventId: detailEvent.id,
        })
      );
      await reloadEvents();
      selectEvent(updatedEvent.id);
      setFallbackEvent(updatedEvent);
      setToast({ message: "Event configuration updated.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to update event.",
        tone: "bad",
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  if (eventsStatus === "loading" || fallbackStatus === "loading") {
    return (
      <PageFrame title="Event configuration">
        <LoadingState label="Loading event" />
      </PageFrame>
    );
  }

  if (!eventSlug || fallbackStatus === "error" || (!detailEvent && eventsStatus === "ready")) {
    return (
      <PageFrame title="Event configuration">
        <ErrorState
          action={
            <Link className="button button-secondary" to="/">
              Back to events
            </Link>
          }
          message={eventsError ?? "This event could not be found or you do not have access to manage it."}
          title="Event not found"
        />
      </PageFrame>
    );
  }

  if (!detailEvent) {
    return (
      <PageFrame title="Event configuration">
        <LoadingState label="Loading event" />
      </PageFrame>
    );
  }

  return (
    <PageFrame title="Event configuration">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <form className="panel form-grid" onSubmit={(event) => void handleUpdate(event)}>
        <div className="panel-header form-grid-full">
          <div>
            <h2>{detailEvent.name}</h2>
            <p>Manage the Firestore event document and credentialing defaults.</p>
          </div>
          <div className="panel-actions">
            <StatusBadge label={detailEvent.id} tone="neutral" />
            <Link className="button button-secondary" to="/">
              Back to events
            </Link>
          </div>
        </div>
        <FormField label="Event name">
          <input
            onChange={(event) => updateEditForm("name", event.target.value)}
            required
            value={editForm.name}
          />
        </FormField>
        <FormField label="Event slug">
          <input readOnly value={detailEvent.id} />
        </FormField>
        <FormField label="Timezone">
          <TimezoneSelect onChange={(value) => updateEditForm("timezone", value)} value={editForm.timezone} />
        </FormField>
        <FormField label="Status">
          <select
            onChange={(event) => updateEditForm("status", event.target.value as EventStatus)}
            value={editForm.status}
          >
            {eventStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          hint="Used only when the routing engine cannot match a registration type to a specific print queue."
          label="Fallback print queue"
        >
          <select
            disabled={queuesStatus === "loading"}
            onChange={(event) => updateEditForm("defaultQueueId", event.target.value)}
            value={editForm.defaultQueueId}
          >
            <option value="">No fallback queue</option>
            {editForm.defaultQueueId && !queues.some((queue) => queue.id === editForm.defaultQueueId) ? (
              <option value={editForm.defaultQueueId}>{editForm.defaultQueueId} (missing queue)</option>
            ) : null}
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.name}
              </option>
            ))}
          </select>
          {queuesError ? <small>{queuesError}</small> : null}
        </FormField>
        <FormField label="Registration">
          <span className="checkbox-field">
            <input
              checked={editForm.registration}
              onChange={(event) => updateEditForm("registration", event.target.checked)}
              type="checkbox"
            />
            <span>{editForm.registration ? "Enabled" : "Disabled"}</span>
          </span>
        </FormField>
        <div className="form-actions form-grid-full">
          <button className="button button-primary" disabled={submittingAction === "update"} type="submit">
            {submittingAction === "update" ? "Saving" : "Save changes"}
          </button>
        </div>
      </form>
    </PageFrame>
  );
};

export const SwoogoConfigScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [config, setConfig] = useState<SwoogoConfig>(defaultSwoogoConfig);
  const [credentialDraft, setCredentialDraft] = useState({ consumerKey: "", consumerSecret: "" });
  const [savedEventId, setSavedEventId] = useState("");
  const [confirmSwoogoAction, setConfirmSwoogoAction] = useState<"save" | "import" | null>(null);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "testing" | "importing-types" | "clearing-cache">("idle");
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    setStatus("loading");
    void api.getSwoogoConfig(selectedEvent.id)
      .then((loadedConfig) => {
        setConfig({ ...defaultSwoogoConfig, ...loadedConfig });
        setSavedEventId(loadedConfig.eventId);
        setStatus("idle");
      })
      .catch((error) => {
        setToast({
          message: error instanceof Error ? error.message : "Unable to load Swoogo configuration.",
          tone: "bad",
        });
        setStatus("idle");
      });
  }, [api, selectedEvent]);

  const swoogoEventIdChangedWithTypes = Boolean(
    savedEventId
      && config.eventId.trim()
      && savedEventId !== config.eventId.trim()
      && config.registrationTypeCount > 0
  );

  const buildSwoogoPayload = (options: { clearRegistrationTypesOnEventChange?: boolean; replaceExisting?: boolean } = {}) => ({
    baseUrl: config.baseUrl,
    eventId: config.eventId,
    ...(credentialDraft.consumerKey.trim() ? { consumerKey: credentialDraft.consumerKey.trim() } : {}),
    ...(credentialDraft.consumerSecret.trim() ? { consumerSecret: credentialDraft.consumerSecret.trim() } : {}),
    ...options,
  });

  const saveConfig = async (confirmedReset = false) => {
    if (!selectedEvent) {
      return;
    }

    if (swoogoEventIdChangedWithTypes && !confirmedReset) {
      setConfirmSwoogoAction("save");
      return;
    }

    setToast(null);
    setStatus("saving");

    try {
      const payload: SwoogoConfigSaveRequest = buildSwoogoPayload({
        clearRegistrationTypesOnEventChange: confirmedReset && swoogoEventIdChangedWithTypes,
      });
      const savedConfig = await api.saveSwoogoConfig(selectedEvent.id, payload);
      setConfig({ ...defaultSwoogoConfig, ...savedConfig });
      setSavedEventId(savedConfig.eventId);
      setCredentialDraft({ consumerKey: "", consumerSecret: "" });
      setConfirmSwoogoAction(null);
      setToast({ message: "Swoogo configuration saved.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to save Swoogo configuration.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const testConfig = async () => {
    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("testing");

    try {
      const draftPayload = buildSwoogoPayload();
      const lastTest = await api.testSwoogo(selectedEvent.id, draftPayload);
      setConfig((current) => ({ ...current, lastTest }));
      setToast({ message: lastTest.message, tone: lastTest.status === "success" ? "good" : "warn" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to test Swoogo configuration.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const importRegistrationTypes = async (confirmedReset = false) => {
    if (!selectedEvent) {
      return;
    }

    if (swoogoEventIdChangedWithTypes && !confirmedReset) {
      setConfirmSwoogoAction("import");
      return;
    }

    setToast(null);
    setStatus("importing-types");

    try {
      const result = await api.importSwoogoRegistrationTypes(selectedEvent.id, buildSwoogoPayload({
        clearRegistrationTypesOnEventChange: confirmedReset && swoogoEventIdChangedWithTypes,
        replaceExisting: confirmedReset && swoogoEventIdChangedWithTypes,
      }));
      setConfig({ ...defaultSwoogoConfig, ...result.config });
      setSavedEventId(result.config.eventId);
      setCredentialDraft({ consumerKey: "", consumerSecret: "" });
      setConfirmSwoogoAction(null);
      setToast({
        message: `${result.importedCount} registration types imported from Swoogo.`,
        tone: result.importedCount > 0 ? "good" : "warn",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to import Swoogo registration types.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const clearSwoogoCache = async () => {
    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("clearing-cache");

    try {
      const result = await api.clearSwoogoCache(selectedEvent.id);
      setConfig({ ...defaultSwoogoConfig, ...result.config });
      setSavedEventId(result.config.eventId);
      setConfirmClearCache(false);
      setToast({
        message: `${result.participantsDeletedCount} cached participants and ${result.registrationTypesDeletedCount} registration types deleted. ${result.participantsSkippedCount} participants with operational state were preserved.`,
        tone: result.participantsSkippedCount > 0 ? "warn" : "good",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to clear Swoogo cache.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  return (
    <PageFrame title="Swoogo integration">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <section className="panel form-grid">
        <div className="panel-header form-grid-full">
          <div>
            <h2>Swoogo event API</h2>
          </div>
          <div className="panel-actions">
            <StatusBadge
              label={config.credentialsConfigured ? "credentials configured" : "credentials missing"}
              tone={config.credentialsConfigured ? "good" : "warn"}
            />
            <StatusBadge label={config.lastTest.status} tone={config.lastTest.status === "success" ? "good" : "warn"} />
          </div>
        </div>
        <FormField label="Swoogo event ID">
          <input
            onChange={(event) => setConfig((current) => ({ ...current, eventId: event.target.value }))}
            value={config.eventId}
          />
        </FormField>
        <FormField label="Base URL">
          <input
            onChange={(event) => setConfig((current) => ({ ...current, baseUrl: event.target.value }))}
            type="url"
            value={config.baseUrl}
          />
        </FormField>
        <FormField hint="Saved by the backend and not returned to the browser after saving." label="Consumer key / API key">
          <input
            autoComplete="off"
            onChange={(event) => setCredentialDraft((current) => ({ ...current, consumerKey: event.target.value }))}
            placeholder={config.credentialsConfigured ? "Leave blank to keep saved key" : ""}
            value={credentialDraft.consumerKey}
          />
        </FormField>
        <FormField hint="Saved by the backend and not returned to the browser after saving." label="Consumer secret">
          <input
            autoComplete="new-password"
            onChange={(event) => setCredentialDraft((current) => ({ ...current, consumerSecret: event.target.value }))}
            placeholder={config.credentialsConfigured ? "Leave blank to keep saved secret" : ""}
            type="password"
            value={credentialDraft.consumerSecret}
          />
        </FormField>
        <FormField label="Credentials updated">
          <input readOnly value={config.credentialsUpdatedAt ?? "Never"} />
        </FormField>
        <FormField label="Last test">
          <input readOnly value={config.lastTest.checkedAt ?? config.lastTest.message} />
        </FormField>
        <FormField label="Imported registration types">
          <input readOnly value={`${config.registrationTypeCount} types`} />
        </FormField>
        <div className="form-actions form-grid-full">
          <button className="button button-secondary" disabled={status !== "idle"} onClick={() => void testConfig()} type="button">
            {status === "testing" ? "Testing" : "Test"}
          </button>
          <button
            className="button button-secondary"
            disabled={status !== "idle"}
            onClick={() => void importRegistrationTypes()}
            type="button"
          >
            {status === "importing-types" ? "Importing types" : "Import registration types"}
          </button>
          <button className="button button-primary" disabled={status !== "idle"} onClick={() => void saveConfig()} type="button">
            {status === "saving" ? "Saving" : "Save"}
          </button>
        </div>
        <div className="form-actions form-grid-full">
          <button
            className="button button-danger"
            disabled={status !== "idle"}
            onClick={() => setConfirmClearCache(true)}
            type="button"
          >
            {status === "clearing-cache" ? "Clearing cache" : "Clear Swoogo cache"}
          </button>
        </div>
      </section>
      {confirmSwoogoAction ? (
        <Modal onClose={() => setConfirmSwoogoAction(null)} title="Replace registration types">
          <div className="form-grid">
            <p className="form-grid-full">
              Changing the Swoogo event ID from {savedEventId} to {config.eventId} will delete {config.registrationTypeCount} imported registration types for this event.
            </p>
            <div className="form-actions form-grid-full">
              <button className="button button-secondary" onClick={() => setConfirmSwoogoAction(null)} type="button">
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={() => {
                  if (confirmSwoogoAction === "save") {
                    void saveConfig(true);
                    return;
                  }

                  void importRegistrationTypes(true);
                }}
                type="button"
              >
                Delete and continue
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {confirmClearCache ? (
        <Modal onClose={() => setConfirmClearCache(false)} title="Clear Swoogo cache">
          <div className="form-grid">
            <p className="form-grid-full">
              This deletes Swoogo-imported registration types and cached participants that do not have credentialing or print activity. Participants with operational state are preserved.
            </p>
            <div className="form-actions form-grid-full">
              <button className="button button-secondary" onClick={() => setConfirmClearCache(false)} type="button">
                Cancel
              </button>
              <button
                className="button button-danger"
                disabled={status === "clearing-cache"}
                onClick={() => void clearSwoogoCache()}
                type="button"
              >
                {status === "clearing-cache" ? "Clearing" : "Clear cache"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </PageFrame>
  );
};

export const SendGridConfigScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [config, setConfig] = useState<SendGridConfig>(defaultSendGridConfig);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [availableTemplates, setAvailableTemplates] = useState<SendGridTemplateSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "testing" | "listing-templates">("idle");
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    setStatus("loading");
    void api.getSendGridConfig(selectedEvent.id)
      .then((loadedConfig) => {
        const cachedTemplates = loadedConfig.availableTemplates ?? [];

        setConfig({
          ...defaultSendGridConfig,
          ...loadedConfig,
          availableTemplates: cachedTemplates,
          templates: {
            ...defaultSendGridConfig.templates,
            ...loadedConfig.templates,
          },
        });
        setAvailableTemplates(cachedTemplates);
        setStatus("idle");
      })
      .catch((error) => {
        setToast({
          message: error instanceof Error ? error.message : "Unable to load SendGrid configuration.",
          tone: "bad",
        });
        setStatus("idle");
      });
  }, [api, selectedEvent]);

  const updateTemplate = (key: string, value: string) => {
    setConfig((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [key]: value,
      },
    }));
  };

  const saveConfig = async () => {
    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("saving");

    try {
      const payload: SendGridConfigSaveRequest = {
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        replyToEmail: config.replyToEmail,
        templates: config.templates,
        ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      };
      const savedConfig = await api.saveSendGridConfig(selectedEvent.id, payload);
      const cachedTemplates = savedConfig.availableTemplates ?? availableTemplates;

      setConfig({
        ...defaultSendGridConfig,
        ...savedConfig,
        availableTemplates: cachedTemplates,
        credentialsConfigured: savedConfig.credentialsConfigured || Boolean(apiKeyDraft.trim()),
        templates: {
          ...defaultSendGridConfig.templates,
          ...savedConfig.templates,
        },
      });
      setAvailableTemplates(cachedTemplates);
      setApiKeyDraft("");
      setToast({ message: "SendGrid configuration saved.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to save SendGrid configuration.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const testConfig = async () => {
    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("testing");

    try {
      const lastTest = await api.testSendGrid(selectedEvent.id, {
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        replyToEmail: config.replyToEmail,
        templates: config.templates,
        ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      });
      setConfig((current) => ({ ...current, lastTest }));
      setToast({ message: lastTest.message, tone: lastTest.status === "success" ? "good" : "warn" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to test SendGrid configuration.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const listTemplates = async () => {
    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("listing-templates");

    try {
      const loadedTemplates = await api.listSendGridTemplates(selectedEvent.id, {
        ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      });
      const templatesCachedAt = new Date().toISOString();

      setAvailableTemplates(loadedTemplates);
      setConfig((current) => ({
        ...current,
        availableTemplates: loadedTemplates,
        templatesCachedAt,
      }));
      setToast({
        message: loadedTemplates.length > 0 ? `${loadedTemplates.length} SendGrid templates loaded and cached.` : "No SendGrid templates returned. Cache was updated.",
        tone: loadedTemplates.length > 0 ? "good" : "warn",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to list SendGrid templates.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  return (
    <PageFrame title="SendGrid integration">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <section className="panel form-grid">
        <div className="panel-header form-grid-full">
          <div>
            <h2>SendGrid sender</h2>
          </div>
          <div className="panel-actions">
            <StatusBadge
              label={config.credentialsConfigured ? "api key configured" : "api key missing"}
              tone={config.credentialsConfigured ? "good" : "warn"}
            />
            <StatusBadge label={config.lastTest.status} tone={config.lastTest.status === "success" ? "good" : "warn"} />
          </div>
        </div>
        <FormField label="Sender email">
          <input
            onChange={(event) => setConfig((current) => ({ ...current, fromEmail: event.target.value }))}
            type="email"
            value={config.fromEmail}
          />
        </FormField>
        <FormField label="Sender name">
          <input
            onChange={(event) => setConfig((current) => ({ ...current, fromName: event.target.value }))}
            value={config.fromName}
          />
        </FormField>
        <FormField label="Reply-to email">
          <input
            onChange={(event) => setConfig((current) => ({ ...current, replyToEmail: event.target.value }))}
            type="email"
            value={config.replyToEmail}
          />
        </FormField>
        <FormField hint="Saved by the backend and not returned to the browser after saving." label="SendGrid API key">
          <input
            autoComplete="new-password"
            onChange={(event) => setApiKeyDraft(event.target.value)}
            placeholder={config.credentialsConfigured ? "Leave blank to keep saved API key" : ""}
            type="password"
            value={apiKeyDraft}
          />
        </FormField>
        <FormField label="Credentials updated">
          <input readOnly value={config.credentialsUpdatedAt ?? "Never"} />
        </FormField>
        <FormField label="Last test">
          <input readOnly value={config.lastTest.checkedAt ?? config.lastTest.message} />
        </FormField>
        <div className="form-actions form-grid-full">
          <button className="button button-secondary" disabled={status === "loading" || status === "saving"} onClick={() => void testConfig()} type="button">
            {status === "testing" ? "Testing" : "Test"}
          </button>
          <button className="button button-primary" disabled={status === "loading" || status === "testing"} onClick={() => void saveConfig()} type="button">
            {status === "saving" ? "Saving" : "Save"}
          </button>
        </div>
      </section>
      <section className="panel form-grid">
        <div className="panel-header form-grid-full">
          <div>
            <h2>Template purpose mapping</h2>
          </div>
          <div className="panel-actions">
            <StatusBadge label={`${availableTemplates.length} templates`} tone={availableTemplates.length > 0 ? "good" : "neutral"} />
            <StatusBadge label={config.templatesCachedAt ? "cache saved" : "not cached"} tone={config.templatesCachedAt ? "good" : "neutral"} />
            <button className="button button-secondary" disabled={status === "loading" || status === "saving" || status === "listing-templates"} onClick={() => void listTemplates()} type="button">
              {status === "listing-templates" ? "Listing templates" : "List templates"}
            </button>
          </div>
        </div>
        {sendGridTemplatePurposes.map((key) => {
          const value = config.templates[key] ?? "";
          const selectedTemplateIsMissing = value && !availableTemplates.some((template) => template.id === value);

          return (
          <FormField key={key} label={key.replace(/_/g, " ")}>
            <select onChange={(event) => updateTemplate(key, event.target.value)} value={value}>
              <option value="">not set</option>
              {selectedTemplateIsMissing ? <option value={value}>{value} (saved)</option> : null}
              {availableTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </FormField>
          );
        })}
        <div className="form-actions form-grid-full">
          <button className="button button-primary" disabled={status === "saving"} onClick={() => void saveConfig()} type="button">
            Save templates
          </button>
        </div>
      </section>
    </PageFrame>
  );
};

const emptyScopeModes: EventRoleAssignment["scopeModes"] = {
  areas: "all",
  gates: "all",
  queues: "all",
  sessions: "all",
};

const emptyMemberForm = (): EventRoleUpsertRequest => ({
  email: "",
  name: "",
  roles: ["pre_checkin_operator"],
  scope: {
    allowedAreaIds: [],
    allowedGateIds: [],
    allowedQueueIds: [],
    allowedSessionIds: [],
  },
  scopeModes: emptyScopeModes,
});

const emptyUserForm = () => ({
  displayName: "",
  email: "",
  password: "",
});

const scopeSummary = (member: EventRoleAssignment) => {
  const entries: Array<[string, "all" | "none" | "selected", string[]]> = [
    ["areas", member.scopeModes?.areas ?? "all", member.scope.allowedAreaIds],
    ["queues", member.scopeModes?.queues ?? "all", member.scope.allowedQueueIds],
    ["sessions", member.scopeModes?.sessions ?? "all", member.scope.allowedSessionIds],
  ];

  return entries
    .map(([label, mode, values]) => {
      if (mode === "all") {
        return `${label}: all`;
      }

      if (mode === "none") {
        return `${label}: none`;
      }

      return `${label}: ${values.length ? values.join(" / ") : "selected none"}`;
    })
    .join(" | ");
};

interface ScopeResource {
  id: string;
  name: string;
}

const scopeFieldMap = {
  areas: "allowedAreaIds",
  gates: "allowedGateIds",
  queues: "allowedQueueIds",
  sessions: "allowedSessionIds",
} as const;

const ScopeSelector = ({
  label,
  mode,
  onModeChange,
  onToggleResource,
  resources,
  selectedIds,
}: {
  label: string;
  mode: "all" | "none" | "selected";
  onModeChange: (mode: "all" | "none" | "selected") => void;
  onToggleResource: (id: string) => void;
  resources: ScopeResource[];
  selectedIds: string[];
}) => (
  <div className="scope-selector">
    <div className="scope-selector-header">
      <strong>{label}</strong>
      <div className="segmented-control" role="group" aria-label={`${label} scope`}>
        {scopeModeOptions.map((option) => (
          <button
            className={mode === option ? "active" : ""}
            key={option}
            onClick={() => onModeChange(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
    {mode === "selected" ? (
      <div className="checkbox-list">
        {resources.length === 0 ? <small>No records created yet.</small> : null}
        {resources.map((resource) => (
          <label className="checkbox-field" key={resource.id}>
            <input checked={selectedIds.includes(resource.id)} onChange={() => onToggleResource(resource.id)} type="checkbox" />
            {resource.name}
          </label>
        ))}
      </div>
    ) : null}
  </div>
);

const ResourceCheckboxList = ({
  disabled = false,
  emptyLabel = "No options available.",
  onChange,
  options,
  selectedIds,
}: {
  disabled?: boolean;
  emptyLabel?: string;
  onChange: (ids: string[]) => void;
  options: { id: string; name: string }[];
  selectedIds: string[];
}) => {
  const toggle = (id: string) => {
    onChange(selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id]);
  };

  return (
    <div className="resource-checkbox-block">
      <div className="mini-actions">
        <button className="button button-secondary" disabled={disabled || options.length === 0} onClick={() => onChange(options.map((option) => option.id))} type="button">
          Select all
        </button>
        <button className="button button-secondary" disabled={disabled} onClick={() => onChange([])} type="button">
          Clear
        </button>
      </div>
      <div className="checkbox-list table-checkbox-list">
        {options.length === 0 ? <small>{emptyLabel}</small> : null}
        {options.map((option) => (
          <label className="checkbox-field" key={option.id}>
            <input checked={selectedIds.includes(option.id)} disabled={disabled} onChange={() => toggle(option.id)} type="checkbox" />
            {option.name}
          </label>
        ))}
      </div>
    </div>
  );
};

export const UsersRolesScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [members, setMembers] = useState<EventRoleAssignment[]>([]);
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "creating-user">("idle");
  const [memberModal, setMemberModal] = useState<"create" | "edit" | null>(null);
  const [memberSource, setMemberSource] = useState<"existing" | "new">("existing");
  const [memberUid, setMemberUid] = useState("");
  const [memberForm, setMemberForm] = useState<EventRoleUpsertRequest>(() => emptyMemberForm());
  const [userForm, setUserForm] = useState(() => emptyUserForm());
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedEvent) {
      setUsers([]);
      setMembers([]);
      return;
    }

    setStatus("loading");
    setToast(null);

    try {
      const [loadedUsers, loadedMembers, loadedAreas, loadedQueues, loadedSessions] = await Promise.all([
        api.listUsers(selectedEvent.id),
        api.listUsersAndRoles(selectedEvent.id),
        api.listAreas(selectedEvent.id),
        api.listQueues(selectedEvent.id),
        api.listSessions(selectedEvent.id),
      ]);
      setUsers(loadedUsers);
      setMembers(loadedMembers);
      setAreas(loadedAreas);
      setQueues(loadedQueues);
      setSessions(loadedSessions);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to load users and roles.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  }, [api, selectedEvent]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const memberUids = useMemo(() => new Set(members.map((member) => member.uid)), [members]);
  const assignableUsers = useMemo(
    () => users.filter((user) => !memberUids.has(user.uid)),
    [memberUids, users]
  );

  const applySelectedUser = (uid: string) => {
    const selectedUser = users.find((user) => user.uid === uid);

    setMemberUid(uid);
    setMemberForm((current) => ({
      ...current,
      email: selectedUser?.email ?? current.email,
      name: selectedUser?.displayName ?? current.name,
    }));
  };

  const openCreateMember = () => {
    const firstUser = assignableUsers[0];
    const source = firstUser ? "existing" : "new";

    setMemberSource(source);
    setMemberUid(firstUser?.uid ?? "");
    setMemberForm({
      ...emptyMemberForm(),
      email: firstUser?.email ?? "",
      name: firstUser?.displayName ?? "",
    });
    setUserForm(emptyUserForm());
    setMemberModal("create");
  };

  const openEditMember = (member: EventRoleAssignment) => {
    setMemberUid(member.uid);
    setMemberForm({
      email: member.email,
      name: member.name,
      roles: member.roles.length > 0 ? member.roles : ["pre_checkin_operator"],
      scope: member.scope,
      scopeModes: member.scopeModes ?? emptyScopeModes,
    });
    setMemberSource("existing");
    setMemberModal("edit");
  };

  const toggleMemberRole = (role: EventRole) => {
    setMemberForm((current) => {
      const nextRoles = current.roles.includes(role)
        ? current.roles.filter((currentRole) => currentRole !== role)
        : [...current.roles, role];

      return {
        ...current,
        roles: nextRoles,
      };
    });
  };

  const setScopeMode = (key: keyof typeof scopeFieldMap, mode: "all" | "none" | "selected") => {
    setMemberForm((current) => ({
      ...current,
      scope: mode === "selected"
        ? current.scope
        : {
            ...current.scope,
            [scopeFieldMap[key]]: [],
          },
      scopeModes: {
        ...current.scopeModes,
        [key]: mode,
      },
    }));
  };

  const toggleScopeResource = (key: keyof typeof scopeFieldMap, id: string) => {
    const field = scopeFieldMap[key];

    setMemberForm((current) => {
      const currentIds = current.scope[field];
      const nextIds = currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id];

      return {
        ...current,
        scope: {
          ...current.scope,
          [field]: nextIds,
        },
        scopeModes: {
          ...current.scopeModes,
          [key]: "selected",
        },
      };
    });
  };

  const saveMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvent) {
      return;
    }

    if (memberForm.roles.length === 0) {
      setToast({ message: "Select at least one role.", tone: "warn" });
      return;
    }

    setStatus("saving");
    setToast(null);

    try {
      let uid = memberUid.trim();
      let payload = memberForm;

      if (memberModal === "create" && memberSource === "new") {
        setStatus("creating-user");
        const user = await api.createUser(selectedEvent.id, userForm);
        uid = user.uid;
        payload = {
          ...memberForm,
          email: user.email,
          name: user.displayName,
        };
        setUsers((current) => [user, ...current.filter((currentUser) => currentUser.uid !== user.uid)]);
      }

      if (!uid) {
        setToast({ message: "Select or create a user before saving roles.", tone: "warn" });
        setStatus("idle");
        return;
      }

      setStatus("saving");
      await api.saveUserRole(selectedEvent.id, uid, payload);
      setMemberModal(null);
      setMemberUid("");
      setUserForm(emptyUserForm());
      await loadData();
      setToast({ message: "Member permissions saved.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to save member permissions.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const scopeResources = {
    areas: areas.map((area) => ({ id: area.id, name: area.name })),
    queues: queues.map((queue) => ({ id: queue.id, name: queue.name })),
    sessions: sessions.map((session) => ({ id: session.id, name: session.name })),
  };

  return (
    <PageFrame title="Event members">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Event members</h2>
            <p>Select an existing user or create a new login while assigning event permissions.</p>
          </div>
          <div className="panel-actions">
            <button className="button button-secondary" disabled={status === "loading"} onClick={() => void loadData()} type="button">
              Refresh
            </button>
            <button className="button button-primary" onClick={openCreateMember} type="button">
              Add event member
            </button>
          </div>
        </div>
        {status === "loading" && members.length === 0 ? (
          <LoadingState label="Loading members" />
        ) : members.length === 0 ? (
          <EmptyState
            action={<button className="button button-primary" onClick={openCreateMember} type="button">Add event member</button>}
            description="No users have event permissions yet."
            title="No event members"
          />
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "roles", label: "Roles" },
              { key: "scope", label: "Allowed scope" },
              { key: "actions", label: "Actions" },
            ]}
            rows={members.map((member) => ({
              actions: (
                <button className="button button-secondary" onClick={() => openEditMember(member)} type="button">
                  Edit
                </button>
              ),
              email: member.email || "No email",
              name: member.name || member.email || "No name",
              roles: member.roles.join(" / ") || "No roles",
              scope: scopeSummary(member),
            }))}
          />
        )}
      </section>

      {memberModal ? (
        <Modal
          onClose={() => setMemberModal(null)}
          title={memberModal === "edit" ? "Edit event permissions" : "Add event member"}
        >
          <form className="form-grid" onSubmit={(event) => void saveMember(event)}>
            {memberModal === "create" ? (
              <div className="form-grid-full scope-selector">
                <div className="scope-selector-header">
                  <strong>User</strong>
                  <div className="segmented-control" role="group" aria-label="Member source">
                    <button
                      className={memberSource === "existing" ? "active" : ""}
                      disabled={assignableUsers.length === 0}
                      onClick={() => {
                        const firstUser = assignableUsers[0];
                        setMemberSource("existing");
                        setMemberUid(firstUser?.uid ?? "");
                        setMemberForm((current) => ({
                          ...current,
                          email: firstUser?.email ?? "",
                          name: firstUser?.displayName ?? "",
                        }));
                      }}
                      type="button"
                    >
                      Existing user
                    </button>
                    <button
                      className={memberSource === "new" ? "active" : ""}
                      onClick={() => {
                        setMemberSource("new");
                        setMemberUid("");
                        setMemberForm((current) => ({
                          ...current,
                          email: "",
                          name: "",
                        }));
                      }}
                      type="button"
                    >
                      New user
                    </button>
                  </div>
                </div>

                {memberSource === "existing" ? (
                  <FormField label="Existing user">
                    <select
                      onChange={(event) => applySelectedUser(event.target.value)}
                      required
                      value={memberUid}
                    >
                      <option value="">Select a user</option>
                      {assignableUsers.map((user) => (
                        <option key={user.uid} value={user.uid}>
                          {user.email || user.displayName || "Unnamed user"}
                        </option>
                      ))}
                    </select>
                    {assignableUsers.length === 0 ? <small>All existing users are already event members.</small> : null}
                  </FormField>
                ) : (
                  <div className="form-grid">
                    <FormField label="Email">
                      <input
                        onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                        required
                        type="email"
                        value={userForm.email}
                      />
                    </FormField>
                    <FormField label="Password">
                      <input
                        autoComplete="new-password"
                        minLength={6}
                        onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                        required
                        type="password"
                        value={userForm.password}
                      />
                    </FormField>
                    <FormField label="Display name">
                      <input
                        onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))}
                        value={userForm.displayName}
                      />
                    </FormField>
                  </div>
                )}
              </div>
            ) : (
              <>
                <FormField label="Email">
                  <input readOnly value={memberForm.email} />
                </FormField>
                <FormField label="Name">
                  <input readOnly value={memberForm.name} />
                </FormField>
              </>
            )}
            {memberModal === "create" && memberSource === "existing" ? (
              <>
                <FormField label="Email">
                  <input readOnly value={memberForm.email} />
                </FormField>
                <FormField label="Name">
                  <input readOnly value={memberForm.name} />
                </FormField>
              </>
            ) : null}
            <div className="form-field form-grid-full">
              <span>Roles</span>
              <div className="checkbox-list">
                {eventRoleOptions.map((role) => (
                  <label className="checkbox-field" key={role}>
                    <input checked={memberForm.roles.includes(role)} onChange={() => toggleMemberRole(role)} type="checkbox" />
                    {role}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-grid-full scope-grid">
              <ScopeSelector
                label="Allowed areas"
                mode={memberForm.scopeModes.areas}
                onModeChange={(mode) => setScopeMode("areas", mode)}
                onToggleResource={(id) => toggleScopeResource("areas", id)}
                resources={scopeResources.areas}
                selectedIds={memberForm.scope.allowedAreaIds}
              />
              <ScopeSelector
                label="Allowed queues"
                mode={memberForm.scopeModes.queues}
                onModeChange={(mode) => setScopeMode("queues", mode)}
                onToggleResource={(id) => toggleScopeResource("queues", id)}
                resources={scopeResources.queues}
                selectedIds={memberForm.scope.allowedQueueIds}
              />
              <ScopeSelector
                label="Allowed sessions"
                mode={memberForm.scopeModes.sessions}
                onModeChange={(mode) => setScopeMode("sessions", mode)}
                onToggleResource={(id) => toggleScopeResource("sessions", id)}
                resources={scopeResources.sessions}
                selectedIds={memberForm.scope.allowedSessionIds}
              />
            </div>
            <div className="form-actions form-grid-full">
              <button className="button button-secondary" onClick={() => setMemberModal(null)} type="button">
                Cancel
              </button>
              <button className="button button-primary" disabled={status === "saving" || status === "creating-user"} type="submit">
                {status === "creating-user" ? "Creating user" : status === "saving" ? "Saving" : "Save permissions"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </PageFrame>
  );
};

const sameIdSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
};

const registrationTypeLabel = (registrationTypes: RegistrationTypeSummary[], id: string) =>
  registrationTypes.find((type) => type.id === id)?.name ?? id;

const registrationTypeSummary = (registrationTypes: RegistrationTypeSummary[], ids: string[]) =>
  ids.length
    ? ids.map((id) => registrationTypeLabel(registrationTypes, id)).join(" / ")
    : "No default registration types";

export const AreasSessionsScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [registrationTypes, setRegistrationTypes] = useState<RegistrationTypeSummary[]>([]);
  const [registrationTypesStatus, setRegistrationTypesStatus] = useState<"idle" | "loading" | "ready" | "blocked" | "error">("idle");
  const [registrationTypesError, setRegistrationTypesError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [swoogoConfig, setSwoogoConfig] = useState<SwoogoConfig>(defaultSwoogoConfig);
  const [areaDrafts, setAreaDrafts] = useState<Record<string, AreaUpsertRequest>>({});
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, SessionUpsertRequest>>({});
  const [areaForm, setAreaForm] = useState<AreaUpsertRequest>({ name: "", registrationTypeIds: [], status: "active" });
  const [sessionForm, setSessionForm] = useState<SessionUpsertRequest>({ areaId: "", name: "", status: "active", swoogoSessionId: "" });
  const [createModal, setCreateModal] = useState<"area" | "session" | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving-area" | "saving-session">("idle");
  const [savingResourceId, setSavingResourceId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);
  const swoogoReady = Boolean(swoogoConfig.eventId && swoogoConfig.credentialsConfigured);
  const canConfigureAreas = swoogoReady && registrationTypesStatus === "ready";

  const loadResources = useCallback(async () => {
    if (!selectedEvent) {
      return;
    }

    setStatus("loading");
    setRegistrationTypesStatus("loading");
    setRegistrationTypesError(null);

    try {
      const loadedSwoogoConfig = await api.getSwoogoConfig(selectedEvent.id);
      const [loadedAreas, loadedSessions] = await Promise.all([
        api.listAreas(selectedEvent.id),
        api.listSessions(selectedEvent.id),
      ]);
      let loadedRegistrationTypes: RegistrationTypeSummary[] = [];

      if (loadedSwoogoConfig.eventId && loadedSwoogoConfig.credentialsConfigured) {
        try {
          loadedRegistrationTypes = await api.listRegistrationTypes(selectedEvent.id);
          setRegistrationTypesStatus("ready");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to load Swoogo registration types.";
          setRegistrationTypesStatus("error");
          setRegistrationTypesError(message);
        }
      } else {
        setRegistrationTypesStatus("blocked");
      }

      setSwoogoConfig(loadedSwoogoConfig);
      setAreas(loadedAreas);
      setSessions(loadedSessions);
      setRegistrationTypes(loadedRegistrationTypes);
      setAreaDrafts(Object.fromEntries(loadedAreas.map((area) => [area.id, {
        name: area.name,
        registrationTypeIds: area.registrationTypeIds,
        status: area.status,
      }])));
      setSessionDrafts(Object.fromEntries(loadedSessions.map((session) => [session.id, {
        areaId: session.areaId,
        name: session.name,
        status: session.status,
        swoogoSessionId: session.swoogoSessionId,
      }])));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load areas and sessions.";
      setRegistrationTypesStatus("error");
      setRegistrationTypesError(message);
      setToast({
        message,
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  }, [api, selectedEvent]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const createArea = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvent) {
      return;
    }

    if (!canConfigureAreas) {
      setToast({ message: "Verify the Swoogo event ID, API key, and secret before creating areas.", tone: "warn" });
      return;
    }

    setStatus("saving-area");
    setToast(null);

    try {
      await api.createArea(selectedEvent.id, areaForm);
      setAreaForm({ name: "", registrationTypeIds: [], status: "active" });
      setCreateModal(null);
      await loadResources();
      setToast({ message: "Area saved.", tone: "good" });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Unable to save area.", tone: "bad" });
    } finally {
      setStatus("idle");
    }
  };

  const createSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvent) {
      return;
    }

    setStatus("saving-session");
    setToast(null);

    try {
      await api.createSession(selectedEvent.id, sessionForm);
      setSessionForm({ areaId: "", name: "", status: "active", swoogoSessionId: "" });
      setCreateModal(null);
      await loadResources();
      setToast({ message: "Session saved.", tone: "good" });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Unable to save session.", tone: "bad" });
    } finally {
      setStatus("idle");
    }
  };

  const saveAreaUpdate = async (area: AreaSummary) => {
    if (!selectedEvent) {
      return;
    }

    if (!canConfigureAreas) {
      setToast({ message: "Verify Swoogo before changing area access rules.", tone: "warn" });
      return;
    }

    setSavingResourceId(`area:${area.id}`);

    try {
      await api.updateArea(selectedEvent.id, area.id, areaDrafts[area.id]);
      await loadResources();
      setToast({ message: "Area updated.", tone: "good" });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Unable to update area.", tone: "bad" });
    } finally {
      setSavingResourceId(null);
    }
  };

  const saveSessionUpdate = async (session: SessionSummary) => {
    if (!selectedEvent) {
      return;
    }

    setSavingResourceId(`session:${session.id}`);

    try {
      await api.updateSession(selectedEvent.id, session.id, sessionDrafts[session.id]);
      await loadResources();
      setToast({ message: "Session updated.", tone: "good" });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Unable to update session.", tone: "bad" });
    } finally {
      setSavingResourceId(null);
    }
  };

  const registrationTypeOptions = registrationTypes.map((type) => ({ id: type.id, name: type.name }));

  return (
    <PageFrame title="Areas and sessions">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {!swoogoReady ? (
        <div className="app-banner app-banner-offline" role="status">
          <span>Configure the event Swoogo ID, API key, and secret before creating areas or loading allowed registration types.</span>
          {selectedEvent ? (
            <Link className="button button-secondary" to={eventPath(selectedEvent.id, "admin/swoogo")}>
              Configure Swoogo
            </Link>
          ) : null}
        </div>
      ) : null}
      {swoogoReady && registrationTypesStatus === "error" ? (
        <div className="app-banner app-banner-offline" role="status">
          <span>{registrationTypesError ?? "Unable to verify Swoogo credentials or load registration types."}</span>
          {selectedEvent ? (
            <Link className="button button-secondary" to={eventPath(selectedEvent.id, "admin/swoogo")}>
              Fix Swoogo
            </Link>
          ) : null}
        </div>
      ) : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Areas</h2>
            <p>Areas define participant presence and badge access rules.</p>
          </div>
          <div className="panel-actions">
            <button className="button button-secondary" disabled={status === "loading"} onClick={() => void loadResources()} type="button">Refresh</button>
            <button className="button button-primary" disabled={!canConfigureAreas} onClick={() => setCreateModal("area")} type="button">Create area</button>
          </div>
        </div>
        {status === "loading" && areas.length === 0 ? <LoadingState label="Loading areas" /> : (
          <DataTable
            columns={[
              { key: "name", label: "Area" },
              { key: "registrationTypes", label: "Allowed registration types" },
              { key: "status", label: "Status" },
              { key: "actions", label: "Actions" },
            ]}
            rows={areas.map((area) => {
              const draft = areaDrafts[area.id] ?? { name: area.name, registrationTypeIds: area.registrationTypeIds, status: area.status };
              const isSaving = savingResourceId === `area:${area.id}`;
              const isDirty = draft.name !== area.name
                || draft.status !== area.status
                || !sameIdSet(draft.registrationTypeIds, area.registrationTypeIds);

              return {
                actions: <button className="button button-secondary" disabled={!canConfigureAreas || !isDirty || isSaving} onClick={() => void saveAreaUpdate(area)} type="button">{isSaving ? "Saving" : "Save"}</button>,
                name: <input className="table-control" onChange={(event) => setAreaDrafts((current) => ({ ...current, [area.id]: { ...draft, name: event.target.value } }))} value={draft.name} />,
                registrationTypes: (
                  <ResourceCheckboxList
                    disabled={!canConfigureAreas}
                    emptyLabel="Create registration types from Swoogo before restricting this area."
                    onChange={(ids) => setAreaDrafts((current) => ({ ...current, [area.id]: { ...draft, registrationTypeIds: ids } }))}
                    options={registrationTypeOptions}
                    selectedIds={draft.registrationTypeIds}
                  />
                ),
                status: (
                  <select className="table-control" onChange={(event) => setAreaDrafts((current) => ({ ...current, [area.id]: { ...draft, status: event.target.value as AreaSummary["status"] } }))} value={draft.status}>
                    {resourceStatuses.map((resourceStatus) => <option key={resourceStatus} value={resourceStatus}>{resourceStatus}</option>)}
                  </select>
                ),
              };
            })}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Sessions</h2>
            <p>Sessions can be linked to an area, so a session scan also updates participant presence.</p>
          </div>
          <button className="button button-primary" onClick={() => setCreateModal("session")} type="button">Create session</button>
        </div>
        {status === "loading" && sessions.length === 0 ? <LoadingState label="Loading sessions" /> : (
          <DataTable
            columns={[
              { key: "name", label: "Session" },
              { key: "swoogoSessionId", label: "Swoogo session ID" },
              { key: "area", label: "Presence area" },
              { key: "status", label: "Status" },
              { key: "actions", label: "Actions" },
            ]}
            rows={sessions.map((session) => {
              const draft = sessionDrafts[session.id] ?? { areaId: session.areaId, name: session.name, status: session.status, swoogoSessionId: session.swoogoSessionId };
              const isSaving = savingResourceId === `session:${session.id}`;
              const isDirty = draft.name !== session.name
                || draft.areaId !== session.areaId
                || draft.status !== session.status
                || draft.swoogoSessionId !== session.swoogoSessionId;

              return {
                actions: <button className="button button-secondary" disabled={!isDirty || isSaving} onClick={() => void saveSessionUpdate(session)} type="button">{isSaving ? "Saving" : "Save"}</button>,
                area: (
                  <select className="table-control" onChange={(event) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, areaId: event.target.value } }))} value={draft.areaId}>
                    <option value="">No area</option>
                    {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                ),
                name: <input className="table-control" onChange={(event) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, name: event.target.value } }))} value={draft.name} />,
                status: (
                  <select className="table-control" onChange={(event) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, status: event.target.value as SessionSummary["status"] } }))} value={draft.status}>
                    {resourceStatuses.map((resourceStatus) => <option key={resourceStatus} value={resourceStatus}>{resourceStatus}</option>)}
                  </select>
                ),
                swoogoSessionId: <input className="table-control" onChange={(event) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, swoogoSessionId: event.target.value } }))} value={draft.swoogoSessionId} />,
              };
            })}
          />
        )}
      </section>

      {createModal === "area" ? (
        <Modal onClose={() => setCreateModal(null)} title="Create area">
          <form className="form-grid" onSubmit={(event) => void createArea(event)}>
            <FormField label="Area name">
              <input onChange={(event) => setAreaForm((current) => ({ ...current, name: event.target.value }))} required value={areaForm.name} />
            </FormField>
            <div className="form-field form-grid-full">
              <span>Allowed registration types</span>
              <ResourceCheckboxList
                disabled={!canConfigureAreas}
                emptyLabel="Create registration types from Swoogo before restricting this area."
                onChange={(ids) => setAreaForm((current) => ({ ...current, registrationTypeIds: ids }))}
                options={registrationTypeOptions}
                selectedIds={areaForm.registrationTypeIds}
              />
              <small>{registrationTypeSummary(registrationTypes, areaForm.registrationTypeIds)}</small>
            </div>
            <FormField label="Status">
              <select onChange={(event) => setAreaForm((current) => ({ ...current, status: event.target.value as AreaSummary["status"] }))} value={areaForm.status}>
                {resourceStatuses.map((resourceStatus) => <option key={resourceStatus} value={resourceStatus}>{resourceStatus}</option>)}
              </select>
            </FormField>
            <div className="form-actions form-grid-full">
              <button className="button button-secondary" onClick={() => setCreateModal(null)} type="button">Cancel</button>
              <button className="button button-primary" disabled={status === "saving-area"} type="submit">{status === "saving-area" ? "Saving" : "Save area"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {createModal === "session" ? (
        <Modal onClose={() => setCreateModal(null)} title="Create session">
          <form className="form-grid" onSubmit={(event) => void createSession(event)}>
            <FormField label="Session name">
              <input onChange={(event) => setSessionForm((current) => ({ ...current, name: event.target.value }))} required value={sessionForm.name} />
            </FormField>
            <FormField label="Swoogo session ID">
              <input onChange={(event) => setSessionForm((current) => ({ ...current, swoogoSessionId: event.target.value }))} value={sessionForm.swoogoSessionId} />
            </FormField>
            <FormField label="Area">
              <select onChange={(event) => setSessionForm((current) => ({ ...current, areaId: event.target.value }))} value={sessionForm.areaId}>
                <option value="">No area</option>
                {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </FormField>
            <FormField label="Status">
              <select onChange={(event) => setSessionForm((current) => ({ ...current, status: event.target.value as SessionSummary["status"] }))} value={sessionForm.status}>
                {resourceStatuses.map((resourceStatus) => <option key={resourceStatus} value={resourceStatus}>{resourceStatus}</option>)}
              </select>
            </FormField>
            <div className="form-actions form-grid-full">
              <button className="button button-secondary" onClick={() => setCreateModal(null)} type="button">Cancel</button>
              <button className="button button-primary" disabled={status === "saving-session"} type="submit">{status === "saving-session" ? "Saving" : "Save session"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </PageFrame>
  );
};

const credentialTone = (status: string): "good" | "neutral" | "warn" | "bad" => {
  if (["active", "allowed", "complete", "completed", "issued", "printed", "success", "synced"].includes(status)) {
    return "good";
  }

  if (["blocked", "cancelled", "denied", "failed", "failure", "rejected", "revoked", "void", "voided"].includes(status)) {
    return "bad";
  }

  if (["queued", "pending", "printing"].includes(status)) {
    return "warn";
  }

  return "neutral";
};

const detailValue = (value: unknown, fallback = "-") => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
};

const firstDetailValue = (record: Record<string, unknown>, keys: string[], fallback = "-") => {
  for (const key of keys) {
    const value = detailValue(record[key], "");

    if (value) {
      return value;
    }
  }

  return fallback;
};

const recordTime = (record: Record<string, unknown>) =>
  firstDetailValue(record, ["updatedAt", "createdAt", "issuedAt", "printedAt", "checkedInAt", "scannedAt"], "-");

const recordStatus = (record: Record<string, unknown>) =>
  firstDetailValue(record, ["status", "result", "state"], "-");

const recordDetails = (record: Record<string, unknown>, keys: string[]) =>
  keys
    .map((key) => {
      const value = detailValue(record[key], "");
      return value ? `${key}: ${value}` : "";
    })
    .filter(Boolean)
    .join(" | ") || "-";

const RecordTable = ({
  emptyLabel,
  records,
  title,
  detailKeys,
}: {
  detailKeys: string[];
  emptyLabel: string;
  records: Record<string, unknown>[];
  title: string;
}) => (
  <div className="detail-section">
    <h3>{title}</h3>
    {records.length === 0 ? (
      <EmptyState description={emptyLabel} title="No records" />
    ) : (
      <DataTable
        columns={[
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "time", label: "Time" },
          { key: "details", label: "Details" },
        ]}
        rows={records.map((record) => ({
          details: recordDetails(record, detailKeys),
          id: detailValue(record.id),
          status: <StatusBadge label={recordStatus(record)} tone={credentialTone(recordStatus(record))} />,
          time: recordTime(record),
        }))}
      />
    )}
  </div>
);

export const AttendeesScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [attendees, setAttendees] = useState<AttendeeSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "importing">("idle");
  const [detail, setDetail] = useState<AttendeeDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reissuingId, setReissuingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  const loadAttendees = useCallback(async () => {
    if (!selectedEvent) {
      setAttendees([]);
      return;
    }

    setStatus("loading");
    setToast(null);

    try {
      setAttendees(await api.listAttendees(selectedEvent.id));
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to load attendees.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  }, [api, selectedEvent]);

  useEffect(() => {
    void loadAttendees();
  }, [loadAttendees]);

  const reissueCredential = async (attendee: AttendeeSummary) => {
    if (!selectedEvent) {
      return;
    }

    setReissuingId(attendee.id);
    setToast(null);

    try {
      const result = await api.reissueCredential(selectedEvent.id, attendee.id);
      await loadAttendees();
      setToast({
        message: `Credential ${result.credentialBadgeId} queued for printing (${result.printJobId}).`,
        tone: "good",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to reissue credential.",
        tone: "bad",
      });
    } finally {
      setReissuingId(null);
    }
  };

  const importFromSwoogo = async () => {
    if (!selectedEvent) {
      return;
    }

    setStatus("importing");
    setToast(null);

    try {
      const result = await api.importSwoogoParticipants(selectedEvent.id);
      setAttendees(await api.listAttendees(selectedEvent.id));
      setToast({
        message: `${result.importedCount} participants cached from Swoogo (${result.createdCount} new, ${result.updatedCount} updated, ${result.skippedCount} skipped).`,
        tone: "good",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to import participants from Swoogo.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const openAttendeeDetail = async (attendee: AttendeeSummary) => {
    if (!selectedEvent) {
      return;
    }

    setDetail({
      areaPassages: [],
      attendee,
      credentials: [],
      participant: { id: attendee.id },
      participantAccessPassages: [],
      printJobs: [],
      sessionCheckins: [],
    });
    setDetailError(null);
    setDetailStatus("loading");

    try {
      setDetail(await api.getAttendeeDetail(selectedEvent.id, attendee.id));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load attendee detail.");
    } finally {
      setDetailStatus("idle");
    }
  };

  return (
    <PageFrame title="Attendees">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Participants</h2>
          </div>
          <div className="panel-actions">
            <button
              className="button button-secondary"
              disabled={status === "loading" || status === "importing"}
              onClick={() => void importFromSwoogo()}
              type="button"
            >
              {status === "importing" ? "Importing" : "Import from Swoogo"}
            </button>
            <button className="button button-secondary" disabled={status === "loading" || status === "importing"} onClick={() => void loadAttendees()} type="button">
              Refresh
            </button>
          </div>
        </div>
        {status === "importing" ? (
          <LoadingState label="Importing participants from Swoogo" />
        ) : status === "loading" && attendees.length === 0 ? (
          <LoadingState label="Loading attendees" />
        ) : attendees.length === 0 ? (
          <EmptyState description="No participants have been imported or manually registered yet." title="No attendees" />
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "company", label: "Company" },
              { key: "jobTitle", label: "Job title" },
              { key: "registrationType", label: "Registration type" },
              { key: "credential", label: "Credential" },
              { key: "badge", label: "Active badge" },
              { key: "actions", label: "Actions" },
            ]}
            rows={attendees.map((attendee) => {
              const isReissuing = reissuingId === attendee.id;
              const credentialStatus = attendee.credentialStatus || "not issued";

              return {
                actions: (
                  <button
                    className="button button-secondary"
                    disabled={isReissuing}
                    onClick={() => void reissueCredential(attendee)}
                    type="button"
                  >
                    {isReissuing ? "Reissuing" : "Reissue credential"}
                  </button>
                ),
                badge: attendee.activeBadgeId || "No active badge",
                company: attendee.company || "-",
                credential: <StatusBadge label={credentialStatus} tone={credentialTone(credentialStatus)} />,
                email: attendee.email || "No email",
                jobTitle: attendee.jobTitle || "-",
                name: (
                  <button className="table-link" onClick={() => void openAttendeeDetail(attendee)} type="button">
                    {attendee.name || attendee.email || "Unnamed attendee"}
                  </button>
                ),
                registrationType: attendee.registrationTypeId || "-",
              };
            })}
          />
        )}
      </section>
      {detail ? (
        <Modal onClose={() => {
          setDetail(null);
          setDetailError(null);
        }} title={detail.attendee.name || detail.attendee.email || "Attendee detail"}>
          {detailStatus === "loading" ? <LoadingState label="Loading attendee detail" /> : null}
          {detailError ? <ErrorState message={detailError} /> : null}
          {detailStatus !== "loading" && !detailError ? (
            <div className="detail-stack">
              <div className="detail-grid">
                <div>
                  <span>Name</span>
                  <strong>{detail.attendee.name || "-"}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{detail.attendee.email || "No email"}</strong>
                </div>
                <div>
                  <span>Swoogo registrant ID</span>
                  <strong>{detail.attendee.swoogoRegistrantId}</strong>
                </div>
                <div>
                  <span>Registration type</span>
                  <strong>{detail.attendee.registrationTypeId || "-"}</strong>
                </div>
                <div>
                  <span>Company</span>
                  <strong>{detail.attendee.company || "-"}</strong>
                </div>
                <div>
                  <span>Job title</span>
                  <strong>{detail.attendee.jobTitle || "-"}</strong>
                </div>
                <div>
                  <span>Credential status</span>
                  <StatusBadge label={detail.attendee.credentialStatus || "unknown"} tone={credentialTone(detail.attendee.credentialStatus || "unknown")} />
                </div>
                <div>
                  <span>Active badge</span>
                  <strong>{detail.attendee.activeBadgeId || "No active badge"}</strong>
                </div>
              </div>
              <RecordTable
                detailKeys={["badgeId", "credentialId", "credentialQrPayload", "qrPayload", "printJobId", "reissuedAsBadgeId", "replacedByBadgeId"]}
                emptyLabel="No badges have been issued for this attendee."
                records={detail.credentials}
                title="Badges issued"
              />
              <RecordTable
                detailKeys={["credentialBadgeId", "queueId", "terminalId", "reason", "error"]}
                emptyLabel="No print jobs found for this attendee."
                records={detail.printJobs}
                title="Print jobs"
              />
              <RecordTable
                detailKeys={["sessionId", "credentialBadgeId", "operatorUid", "deviceId", "swoogoScanId", "error"]}
                emptyLabel="No session check-ins found for this attendee."
                records={detail.sessionCheckins}
                title="Session check-ins"
              />
              <RecordTable
                detailKeys={["gateId", "targetAreaId", "fromAreaId", "toAreaId", "credentialBadgeId", "reason", "source"]}
                emptyLabel="No area passages found for this attendee."
                records={detail.areaPassages}
                title="Area passages"
              />
              <RecordTable
                detailKeys={["gateId", "targetAreaId", "fromAreaId", "toAreaId", "credentialBadgeId", "reason", "source"]}
                emptyLabel="No participant-local access passages found for this attendee."
                records={detail.participantAccessPassages}
                title="Participant access log"
              />
              <details className="detail-json">
                <summary>Participant document</summary>
                <pre>{JSON.stringify(detail.participant, null, 2)}</pre>
              </details>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </PageFrame>
  );
};

export const QueuesTerminalsScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [registrationTypes, setRegistrationTypes] = useState<RegistrationTypeSummary[]>([]);
  const [queueDrafts, setQueueDrafts] = useState<Record<string, QueueUpsertRequest>>({});
  const [terminalDrafts, setTerminalDrafts] = useState<Record<string, TerminalUpsertRequest>>({});
  const [queueForm, setQueueForm] = useState<QueueUpsertRequest>({
    name: "",
    registrationTypeIds: [],
    status: "active",
  });
  const [terminalForm, setTerminalForm] = useState({
    name: "",
    queueIds: [] as string[],
    status: "offline" as TerminalSummary["status"],
    type: "print" as TerminalSummary["type"],
  });
  const [createModal, setCreateModal] = useState<"queue" | "terminal" | null>(null);
  const [queueToDelete, setQueueToDelete] = useState<QueueSummary | null>(null);
  const [terminalToDelete, setTerminalToDelete] = useState<TerminalSummary | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving-queue" | "saving-terminal">("idle");
  const [savingResourceId, setSavingResourceId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  const loadResources = useCallback(async () => {
    if (!selectedEvent) {
      setQueues([]);
      setTerminals([]);
      setRegistrationTypes([]);
      setQueueDrafts({});
      setTerminalDrafts({});
      return;
    }

    setStatus("loading");

    try {
      const [loadedQueues, loadedTerminals, loadedRegistrationTypes] = await Promise.all([
        api.listQueues(selectedEvent.id),
        api.listTerminals(selectedEvent.id),
        api.listRegistrationTypes(selectedEvent.id),
      ]);
      setQueues(loadedQueues);
      setTerminals(loadedTerminals);
      setRegistrationTypes(loadedRegistrationTypes);
      setQueueDrafts(Object.fromEntries(
        loadedQueues.map((queue) => [queue.id, {
          name: queue.name,
          registrationTypeIds: queue.registrationTypeIds,
          status: queue.status,
        }])
      ));
      setTerminalDrafts(Object.fromEntries(
        loadedTerminals.map((terminal) => [
          terminal.id,
          {
            name: terminal.name,
            queueIds: terminal.queueIds,
            status: terminal.status,
            type: terminal.type,
          },
        ])
      ));
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to load queues and terminals.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  }, [api, selectedEvent]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const createQueue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("saving-queue");

    try {
      await api.createQueue(selectedEvent.id, queueForm);
      setQueueForm({ name: "", registrationTypeIds: [], status: "active" });
      setCreateModal(null);
      await loadResources();
      setToast({ message: "Queue saved.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to save queue.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const updateQueueDraft = (queueId: string, patch: Partial<QueueUpsertRequest>) => {
    setQueueDrafts((current) => ({
      ...current,
      [queueId]: {
        name: current[queueId]?.name ?? "",
        registrationTypeIds: current[queueId]?.registrationTypeIds ?? [],
        status: current[queueId]?.status ?? "active",
        ...patch,
      },
    }));
  };

  const updateTerminalDraft = (terminalId: string, patch: Partial<TerminalUpsertRequest>) => {
    setTerminalDrafts((current) => ({
      ...current,
      [terminalId]: {
        name: current[terminalId]?.name ?? "",
        queueIds: current[terminalId]?.queueIds ?? [],
        status: current[terminalId]?.status ?? "offline",
        type: current[terminalId]?.type ?? "print",
        ...patch,
      },
    }));
  };

  const queueDisableReasons = (queue: QueueSummary) => {
    const reasons: string[] = [];

    if (selectedEvent?.defaultQueueId === queue.id) {
      reasons.push("selected as the fallback print queue");
    }

    const assignedTerminals = terminals
      .filter((terminal) => terminal.status !== "disabled" && terminal.queueIds.includes(queue.id))
      .map((terminal) => terminal.name);

    if (assignedTerminals.length > 0) {
      reasons.push(`assigned to ${assignedTerminals.join(" / ")}`);
    }

    return reasons;
  };

  const saveQueueUpdate = async (queue: QueueSummary) => {
    if (!selectedEvent) {
      return;
    }

    const draft = queueDrafts[queue.id] ?? {
      name: queue.name,
      registrationTypeIds: queue.registrationTypeIds,
      status: queue.status,
    };
    const disableReasons = queueDisableReasons(queue);

    if (draft.status === "disabled" && queue.status !== "disabled" && disableReasons.length > 0) {
      setToast({
        message: `Queue cannot be disabled while it is ${disableReasons.join(" and ")}.`,
        tone: "warn",
      });
      return;
    }

    setToast(null);
    setSavingResourceId(`queue:${queue.id}`);

    try {
      await api.updateQueue(selectedEvent.id, queue.id, draft);
      await loadResources();
      setToast({ message: "Queue updated.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to update queue.",
        tone: "bad",
      });
    } finally {
      setSavingResourceId(null);
    }
  };

  const confirmQueueDelete = (queue: QueueSummary) => {
    const dependencies = queueDisableReasons(queue);

    if (dependencies.length > 0) {
      setToast({
        message: `Queue cannot be removed while it is ${dependencies.join(" and ")}.`,
        tone: "warn",
      });
      return;
    }

    setQueueToDelete(queue);
  };

  const deleteQueue = async () => {
    if (!selectedEvent || !queueToDelete) {
      return;
    }

    const dependencies = queueDisableReasons(queueToDelete);

    if (dependencies.length > 0) {
      setToast({
        message: `Queue cannot be removed while it is ${dependencies.join(" and ")}.`,
        tone: "warn",
      });
      setQueueToDelete(null);
      return;
    }

    setToast(null);
    setSavingResourceId(`queue-delete:${queueToDelete.id}`);

    try {
      await api.deleteQueue(selectedEvent.id, queueToDelete.id);
      setQueueToDelete(null);
      await loadResources();
      setToast({ message: "Queue removed.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to remove queue.",
        tone: "bad",
      });
    } finally {
      setSavingResourceId(null);
    }
  };

  const saveTerminalUpdate = async (terminal: TerminalSummary) => {
    if (!selectedEvent) {
      return;
    }

    const draft = terminalDrafts[terminal.id] ?? {
      name: terminal.name,
      queueIds: terminal.queueIds,
      status: terminal.status,
      type: terminal.type,
    };

    setToast(null);
    setSavingResourceId(`terminal:${terminal.id}`);

    try {
      await api.updateTerminal(selectedEvent.id, terminal.id, draft);
      await loadResources();
      setToast({ message: "Terminal updated.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to update terminal.",
        tone: "bad",
      });
    } finally {
      setSavingResourceId(null);
    }
  };

  const createTerminal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvent) {
      return;
    }

    setToast(null);
    setStatus("saving-terminal");

    try {
      await api.createTerminal(selectedEvent.id, {
        name: terminalForm.name,
        queueIds: terminalForm.queueIds,
        status: terminalForm.status,
        type: terminalForm.type,
      });
      setTerminalForm({
        name: "",
        queueIds: [],
        status: "offline",
        type: "print",
      });
      setCreateModal(null);
      await loadResources();
      setToast({ message: "Terminal saved.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to save terminal.",
        tone: "bad",
      });
    } finally {
      setStatus("idle");
    }
  };

  const deleteTerminal = async () => {
    if (!selectedEvent || !terminalToDelete) {
      return;
    }

    setToast(null);
    setSavingResourceId(`terminal-delete:${terminalToDelete.id}`);

    try {
      await api.deleteTerminal(selectedEvent.id, terminalToDelete.id);
      setTerminalToDelete(null);
      await loadResources();
      setToast({ message: "Terminal removed.", tone: "good" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Unable to remove terminal.",
        tone: "bad",
      });
    } finally {
      setSavingResourceId(null);
    }
  };

  const registrationTypeOptions = registrationTypes.map((type) => ({ id: type.id, name: type.name }));
  const queueOptions = queues.map((queue) => ({ id: queue.id, name: queue.name }));

  return (
    <PageFrame title="Queues and terminals">
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Queues</h2>
          </div>
          <button className="button button-secondary" disabled={status === "loading"} onClick={() => void loadResources()} type="button">
            Refresh
          </button>
          <button className="button button-primary" onClick={() => setCreateModal("queue")} type="button">
            Create queue
          </button>
        </div>
        {status === "loading" && queues.length === 0 ? (
          <LoadingState label="Loading queues" />
        ) : queues.length === 0 ? (
          <EmptyState description="Create a queue before assigning print terminals or fallback queues." title="No queues" />
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Queue" },
              { key: "registrationTypes", label: "Registration types" },
              { key: "status", label: "Status" },
              { key: "activeTerminals", label: "Assigned terminals" },
              { key: "actions", label: "Actions" },
            ]}
            rows={queues.map((queue) => {
              const draft = queueDrafts[queue.id] ?? {
                name: queue.name,
                registrationTypeIds: queue.registrationTypeIds,
                status: queue.status,
              };
              const disableReasons = queueDisableReasons(queue);
              const disableOptionBlocked = queue.status !== "disabled" && disableReasons.length > 0;
              const isDirty = draft.name !== queue.name
                || draft.status !== queue.status
                || !sameIdSet(draft.registrationTypeIds, queue.registrationTypeIds);
              const isSaving = savingResourceId === `queue:${queue.id}`;
              const isDeleting = savingResourceId === `queue-delete:${queue.id}`;

              return {
                actions: (
                  <div className="mini-actions">
                    <button
                      className="button button-secondary"
                      disabled={!isDirty || isSaving || isDeleting}
                      onClick={() => void saveQueueUpdate(queue)}
                      type="button"
                    >
                      {isSaving ? "Saving" : "Save"}
                    </button>
                    <button
                      className="button button-danger"
                      disabled={isSaving || isDeleting}
                      onClick={() => confirmQueueDelete(queue)}
                      type="button"
                    >
                      {isDeleting ? "Removing" : "Remove"}
                    </button>
                  </div>
                ),
                activeTerminals: String(queue.activeTerminalCount),
                name: (
                  <input
                    className="table-control"
                    onChange={(event) => updateQueueDraft(queue.id, { name: event.target.value })}
                    value={draft.name}
                  />
                ),
                registrationTypes: (
                  <ResourceCheckboxList
                    emptyLabel="No registration types loaded yet."
                    onChange={(ids) => updateQueueDraft(queue.id, { registrationTypeIds: ids })}
                    options={registrationTypeOptions}
                    selectedIds={draft.registrationTypeIds}
                  />
                ),
                status: (
                  <div className="table-field">
                    <select
                      className="table-control"
                      onChange={(event) => updateQueueDraft(queue.id, { status: event.target.value as QueueSummary["status"] })}
                      value={draft.status}
                    >
                      {queueStatuses.map((queueStatus) => (
                        <option
                          disabled={queueStatus === "disabled" && disableOptionBlocked}
                          key={queueStatus}
                          value={queueStatus}
                        >
                          {queueStatus}
                        </option>
                      ))}
                    </select>
                    {disableOptionBlocked ? (
                      <small className="table-hint">Cannot disable while {disableReasons.join(" and ")}.</small>
                    ) : null}
                  </div>
                ),
              };
            })}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Terminals</h2>
          </div>
          <button className="button button-primary" onClick={() => setCreateModal("terminal")} type="button">
            Create terminal
          </button>
        </div>
        {status === "loading" && terminals.length === 0 ? (
          <LoadingState label="Loading terminals" />
        ) : terminals.length === 0 ? (
          <EmptyState description="Create terminal records for pre-check-in, print, or pickup stations." title="No terminals" />
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Terminal" },
              { key: "type", label: "Type" },
              { key: "queues", label: "Queues" },
              { key: "heartbeat", label: "Heartbeat" },
              { key: "status", label: "Status" },
              { key: "actions", label: "Actions" },
            ]}
            rows={terminals.map((terminal) => {
              const draft = terminalDrafts[terminal.id] ?? {
                name: terminal.name,
                queueIds: terminal.queueIds,
                status: terminal.status,
                type: terminal.type,
              };
              const isDirty = draft.name !== terminal.name
                || draft.status !== terminal.status
                || draft.type !== terminal.type
                || !sameIdSet(draft.queueIds, terminal.queueIds);
              const isSaving = savingResourceId === `terminal:${terminal.id}`;
              const isDeleting = savingResourceId === `terminal-delete:${terminal.id}`;

              return {
                actions: (
                  <div className="mini-actions">
                    <button
                      className="button button-secondary"
                      disabled={!isDirty || isSaving || isDeleting}
                      onClick={() => void saveTerminalUpdate(terminal)}
                      type="button"
                    >
                      {isSaving ? "Saving" : "Save"}
                    </button>
                    <button
                      className="button button-danger"
                      disabled={isSaving || isDeleting}
                      onClick={() => setTerminalToDelete(terminal)}
                      type="button"
                    >
                      {isDeleting ? "Removing" : "Remove"}
                    </button>
                  </div>
                ),
                heartbeat: terminal.lastHeartbeatAt ?? "Not connected",
                name: (
                  <input
                    className="table-control"
                    onChange={(event) => updateTerminalDraft(terminal.id, { name: event.target.value })}
                    value={draft.name}
                  />
                ),
                queues: (
                  <ResourceCheckboxList
                    emptyLabel="No queues available"
                    onChange={(ids) => updateTerminalDraft(terminal.id, { queueIds: ids })}
                    options={queueOptions}
                    selectedIds={draft.queueIds}
                  />
                ),
                status: (
                  <select
                    className="table-control"
                    onChange={(event) => updateTerminalDraft(terminal.id, { status: event.target.value as TerminalSummary["status"] })}
                    value={draft.status}
                  >
                    {terminalStatuses.map((terminalStatus) => (
                      <option key={terminalStatus} value={terminalStatus}>
                        {terminalStatus}
                      </option>
                    ))}
                  </select>
                ),
                type: (
                  <select
                    className="table-control"
                    onChange={(event) => updateTerminalDraft(terminal.id, { type: event.target.value as TerminalSummary["type"] })}
                    value={draft.type}
                  >
                    {terminalTypes.map((terminalType) => (
                      <option key={terminalType} value={terminalType}>
                        {terminalType}
                      </option>
                    ))}
                  </select>
                ),
              };
            })}
          />
        )}
      </section>

      {createModal === "queue" ? (
        <Modal onClose={() => setCreateModal(null)} title="Create queue">
        <form className="form-grid" onSubmit={(event) => void createQueue(event)}>
          <FormField label="Queue name">
            <input
              onChange={(event) => setQueueForm((current) => ({ ...current, name: event.target.value }))}
              required
              value={queueForm.name}
            />
          </FormField>
          <FormField label="Status">
            <select
              onChange={(event) => setQueueForm((current) => ({ ...current, status: event.target.value as QueueSummary["status"] }))}
              value={queueForm.status}
            >
              {queueStatuses.map((queueStatus) => (
                <option key={queueStatus} value={queueStatus}>
                  {queueStatus}
                </option>
              ))}
            </select>
          </FormField>
          <div className="form-field form-grid-full">
            <span>Registration types routed to this queue</span>
            <ResourceCheckboxList
              emptyLabel="No registration types loaded yet."
              onChange={(ids) => setQueueForm((current) => ({ ...current, registrationTypeIds: ids }))}
              options={registrationTypeOptions}
              selectedIds={queueForm.registrationTypeIds}
            />
            <small>{registrationTypeSummary(registrationTypes, queueForm.registrationTypeIds)}</small>
          </div>
          <div className="form-actions form-grid-full">
            <button className="button button-primary" disabled={status === "saving-queue"} type="submit">
              {status === "saving-queue" ? "Saving" : "Create queue"}
            </button>
          </div>
        </form>
        </Modal>
      ) : null}

      {createModal === "terminal" ? (
        <Modal onClose={() => setCreateModal(null)} title="Create terminal">
        <form className="form-grid" onSubmit={(event) => void createTerminal(event)}>
        <FormField label="Terminal name">
          <input
            onChange={(event) => setTerminalForm((current) => ({ ...current, name: event.target.value }))}
            required
            value={terminalForm.name}
          />
        </FormField>
        <FormField label="Type">
          <select
            onChange={(event) => setTerminalForm((current) => ({ ...current, type: event.target.value as TerminalSummary["type"] }))}
            value={terminalForm.type}
          >
            {terminalTypes.map((terminalType) => (
              <option key={terminalType} value={terminalType}>
                {terminalType}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Status">
          <select
            onChange={(event) => setTerminalForm((current) => ({ ...current, status: event.target.value as TerminalSummary["status"] }))}
            value={terminalForm.status}
          >
            {terminalStatuses.map((terminalStatus) => (
              <option key={terminalStatus} value={terminalStatus}>
                {terminalStatus}
              </option>
            ))}
          </select>
        </FormField>
        <div className="form-field form-grid-full">
          <span>Queues</span>
          <ResourceCheckboxList
            emptyLabel="No queues available"
            onChange={(ids) => setTerminalForm((current) => ({ ...current, queueIds: ids }))}
            options={queueOptions}
            selectedIds={terminalForm.queueIds}
          />
        </div>
        <div className="form-actions form-grid-full">
          <button className="button button-primary" disabled={status === "saving-terminal"} type="submit">
            {status === "saving-terminal" ? "Saving" : "Create terminal"}
          </button>
        </div>
        </form>
        </Modal>
      ) : null}

      {queueToDelete ? (
        <ConfirmationModal
          body={`Remove queue "${queueToDelete.name}"? This deletes the queue configuration and cannot be undone.`}
          confirmLabel="Remove queue"
          onCancel={() => setQueueToDelete(null)}
          onConfirm={() => void deleteQueue()}
          title="Remove queue"
        />
      ) : null}

      {terminalToDelete ? (
        <ConfirmationModal
          body={`Remove terminal "${terminalToDelete.name}"? Any print worker using this saved terminal will need to re-register before it can start again.`}
          confirmLabel="Remove terminal"
          onCancel={() => setTerminalToDelete(null)}
          onConfirm={() => void deleteTerminal()}
          title="Remove terminal"
        />
      ) : null}
    </PageFrame>
  );
};
