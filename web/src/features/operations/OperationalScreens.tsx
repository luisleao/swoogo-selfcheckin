import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import jsQR from "jsqr";

import { DataTable, FormField, LoadingState, ScannerResult, StatusBadge, Toast } from "../../components/primitives";
import type { AreaSummary, QueueSummary, SessionSummary, TerminalSummary } from "../../api/admin";
import { useApi } from "../../context/ApiContext";
import { useEventContext } from "../../context/EventContext";
import type { ScannerResultState } from "../../types";

interface ScanRecord {
  detail: string;
  id: string;
  status: string;
  target: string;
  time: string;
}

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const addScanRecord = (records: ScanRecord[], record: Omit<ScanRecord, "id" | "time">) => [
  {
    ...record,
    id: crypto.randomUUID(),
    time: nowLabel(),
  },
  ...records,
].slice(0, 8);

const WorkflowFrame = ({
  actions,
  children,
  eyebrow = "Workflow",
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  title: string;
}) => (
  <div className="page-stack">
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {actions}
    </header>
    {children}
  </div>
);

const RecentScans = ({ records }: { records: ScanRecord[] }) => (
  <section className="panel">
    <div className="panel-header">
      <div>
        <h2>Recent scans</h2>
      </div>
    </div>
    {records.length === 0 ? (
      <p className="muted-copy">No scans in this browser session.</p>
    ) : (
      <DataTable
        columns={[
          { key: "time", label: "Time" },
          { key: "target", label: "Target" },
          { key: "status", label: "Status" },
          { key: "detail", label: "Detail" },
        ]}
        rows={records.map((record) => ({
          detail: record.detail,
          status: record.status,
          target: record.target,
          time: record.time,
        }))}
      />
    )}
  </section>
);

const QrCameraScanner = ({
  label,
  onScan,
  paused = false,
}: {
  label: string;
  onScan: (payload: string) => void;
  paused?: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanRef = useRef({ at: 0, value: "" });
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);
  const [cameraState, setCameraState] = useState<"loading" | "ready" | "blocked">("loading");
  const [cameraMessage, setCameraMessage] = useState("Starting camera");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let cancelled = false;

    const scanFrame = () => {
      frameRef.current = window.requestAnimationFrame(scanFrame);

      if (cancelled || pausedRef.current) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      const width = video.videoWidth;
      const height = video.videoHeight;

      if (!width || !height) {
        return;
      }

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        return;
      }

      context.drawImage(video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });

      if (!code?.data) {
        return;
      }

      const now = Date.now();
      const lastScan = lastScanRef.current;

      if (lastScan.value === code.data && now - lastScan.at < 1800) {
        return;
      }

      lastScanRef.current = { at: now, value: code.data };
      onScanRef.current(code.data);
    };

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("blocked");
        setCameraMessage("Camera access is not available in this browser.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setCameraState("ready");
        setCameraMessage("Camera active");
        scanFrame();
      } catch (error) {
        setCameraState("blocked");
        setCameraMessage(error instanceof Error ? error.message : "Unable to open camera.");
      }
    };

    void startCamera();

    return () => {
      cancelled = true;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div className="qr-camera">
      <video aria-label={label} className="qr-camera-video" muted playsInline ref={videoRef} />
      <canvas aria-hidden="true" className="qr-camera-canvas" ref={canvasRef} />
      <div className="qr-camera-overlay" aria-hidden="true">
        <span />
      </div>
      <div className={`qr-camera-status qr-camera-status-${cameraState}`}>
        {cameraMessage}
      </div>
    </div>
  );
};

const ScannerWorkflowFrame = ({
  children,
  eyebrow,
  onScan,
  scannerLabel,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  onScan: (payload: string) => void;
  scannerLabel: string;
  title: string;
}) => (
  <div className="scanner-shell">
    <section className="scanner-camera-panel">
      <QrCameraScanner label={scannerLabel} onScan={onScan} />
    </section>
    <aside className="scanner-side-panel">
      <header className="scanner-side-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <StatusBadge label="Auto scan" tone="good" />
      </header>
      {children}
    </aside>
  </div>
);

const extractRegistrationTypeId = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const explicitMatch = normalized.match(/(?:registrationtypeid|registrationtype|registranttype|type)[:=]([a-z0-9-]+)/i);

  if (explicitMatch?.[1]) {
    return explicitMatch[1];
  }

  if (normalized.includes("vip")) {
    return "vip";
  }

  if (normalized.includes("speaker")) {
    return "speaker";
  }

  if (normalized.includes("staff")) {
    return "staff";
  }

  if (normalized.includes("sponsor")) {
    return "sponsor";
  }

  if (normalized.includes("press")) {
    return "press";
  }

  return "standard";
};

const findRoutingQueue = (queues: QueueSummary[], registrationTypeId: string, fallbackQueueId?: string) => {
  const activeQueues = queues.filter((queue) => queue.status === "active");
  const matchedQueue = activeQueues.find((queue) => queue.registrationTypeIds.includes(registrationTypeId));

  if (matchedQueue) {
    return {
      queue: matchedQueue,
      reason: `matched ${registrationTypeId}`,
    };
  }

  const fallbackQueue = fallbackQueueId
    ? activeQueues.find((queue) => queue.id === fallbackQueueId)
    : undefined;

  if (fallbackQueue) {
    return {
      queue: fallbackQueue,
      reason: "event fallback",
    };
  }

  if (activeQueues[0]) {
    return {
      queue: activeQueues[0],
      reason: "first active queue",
    };
  }

  return {
    queue: null,
    reason: "no active queue",
  };
};

const cancelledCredential = (payload: string) => {
  const normalized = payload.toLowerCase();
  return normalized.includes("cancel") || normalized.includes("void") || normalized.includes("revoked");
};

export const PreCheckInScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [email, setEmail] = useState("");
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [result, setResult] = useState<{ detail: string; state: ScannerResultState; title: string }>({
    detail: "Camera is waiting for a confirmation QR code.",
    state: "scanning",
    title: "Scanning",
  });
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    void api.listQueues(selectedEvent.id)
      .then((loadedQueues) => {
        setQueues(loadedQueues);
      })
      .catch((error) => {
        setToast({
          message: error instanceof Error ? error.message : "Unable to load queues.",
          tone: "bad",
        });
      });
  }, [api, selectedEvent]);

  const completePreCheckIn = useCallback((rawValue: string, source: "Email" | "QR") => {
    const value = rawValue.trim();

    if (!value) {
      setResult({
        detail: "Enter an email address before continuing.",
        state: "invalid_participant",
        title: "Missing participant",
      });
      return;
    }

    const registrationTypeId = extractRegistrationTypeId(value);
    const routing = findRoutingQueue(queues, registrationTypeId, selectedEvent?.defaultQueueId);
    const detail = routing.queue
      ? `${source} accepted. Registration type ${registrationTypeId} routed to ${routing.queue.name} (${routing.reason}).`
      : `${source} accepted, but no active print queue is available.`;

    setResult({
      detail,
      state: routing.queue ? "allowed" : "offline_pending",
      title: routing.queue ? "Pre-check-in completed" : "Print routing pending",
    });
    setRecords((current) => addScanRecord(current, {
      detail,
      status: routing.queue ? "queued" : "pending",
      target: value,
    }));
    setEmail("");
  }, [queues, selectedEvent?.defaultQueueId]);

  const handleEmailSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    completePreCheckIn(email, "Email");
  };

  const activeQueueCount = queues.filter((queue) => queue.status === "active").length;

  return (
    <ScannerWorkflowFrame
      eyebrow={selectedEvent?.name ?? "Pre-check-in"}
      onScan={(payload) => completePreCheckIn(payload, "QR")}
      scannerLabel="Pre-check-in QR scanner"
      title="Pre-check-in"
    >
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <ScannerResult detail={result.detail} state={result.state} title={result.title} />
      <section className="panel form-grid">
        <form className="form-grid form-grid-full" onSubmit={handleEmailSubmit}>
          <FormField label="Email lookup">
            <input
              autoComplete="off"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="participant@example.com"
              type="email"
              value={email}
            />
          </FormField>
          <div className="form-actions">
            <button className="button button-primary" type="submit">
              Next
            </button>
          </div>
        </form>
      </section>
      <section className="panel scanner-routing-panel">
        <div>
          <span>Active print queues</span>
          <strong>{activeQueueCount}</strong>
        </div>
        <div>
          <span>Fallback queue</span>
          <strong>{queues.find((queue) => queue.id === selectedEvent?.defaultQueueId)?.name ?? "Not set"}</strong>
        </div>
      </section>
      <RecentScans records={records} />
    </ScannerWorkflowFrame>
  );
};

export const SessionsScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [result, setResult] = useState<{ detail: string; state: ScannerResultState; title: string }>({
    detail: "Choose the active session. The camera will read badge QR codes automatically.",
    state: "scanning",
    title: "Scanning",
  });
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    void Promise.all([
      api.listSessions(selectedEvent.id),
      api.listAreas(selectedEvent.id),
    ])
      .then(([loadedSessions, loadedAreas]) => {
        setSessions(loadedSessions);
        setAreas(loadedAreas);
        setSessionId((current) => current || loadedSessions.find((session) => session.status === "active")?.id || loadedSessions[0]?.id || "");
      })
      .catch((error) => {
        setToast({
          message: error instanceof Error ? error.message : "Unable to load sessions.",
          tone: "bad",
        });
      });
  }, [api, selectedEvent]);

  const handleSessionScan = useCallback((payload: string) => {
    const session = sessions.find((currentSession) => currentSession.id === sessionId);

    if (!session) {
      setResult({
        detail: "Select a session before reading badges.",
        state: "invalid_participant",
        title: "No session selected",
      });
      return;
    }

    if (cancelledCredential(payload)) {
      const detail = "Credential is cancelled and session access must be denied.";
      setResult({ detail, state: "invalid_badge", title: "Cancelled badge" });
      setRecords((current) => addScanRecord(current, {
        detail,
        status: "denied",
        target: session.name,
      }));
      return;
    }

    const areaName = areas.find((area) => area.id === session.areaId)?.name;
    const detail = areaName
      ? `Credential accepted for ${session.name}. Presence moved to ${areaName}.`
      : `Credential accepted for ${session.name}.`;

    setResult({ detail, state: "allowed", title: "Session check-in saved" });
    setRecords((current) => addScanRecord(current, {
      detail,
      status: "checked in",
      target: session.name,
    }));
  }, [areas, sessionId, sessions]);

  return (
    <ScannerWorkflowFrame
      eyebrow={selectedEvent?.name ?? "Sessions"}
      onScan={handleSessionScan}
      scannerLabel="Session badge scanner"
      title="Sessions"
    >
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <ScannerResult detail={result.detail} state={result.state} title={result.title} />
      <section className="panel form-grid">
        <FormField label="Active session">
          <select onChange={(event) => setSessionId(event.target.value)} value={sessionId}>
            <option value="">Select session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </FormField>
      </section>
      <RecentScans records={records} />
    </ScannerWorkflowFrame>
  );
};

export const GatesScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [areaId, setAreaId] = useState("");
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [result, setResult] = useState<{ detail: string; state: ScannerResultState; title: string }>({
    detail: "Choose the controlled area. The camera will validate badge QR codes automatically.",
    state: "scanning",
    title: "Scanning",
  });
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    void api.listAreas(selectedEvent.id)
      .then((loadedAreas) => {
        setAreas(loadedAreas);
        setAreaId((current) => current || loadedAreas.find((area) => area.status === "active")?.id || loadedAreas[0]?.id || "");
      })
      .catch((error) => {
        setToast({
          message: error instanceof Error ? error.message : "Unable to load areas.",
          tone: "bad",
        });
      });
  }, [api, selectedEvent]);

  const handleAreaScan = useCallback((payload: string) => {
    const area = areas.find((currentArea) => currentArea.id === areaId);

    if (!area) {
      setResult({
        detail: "Select an area before reading badges.",
        state: "invalid_participant",
        title: "No area selected",
      });
      return;
    }

    if (cancelledCredential(payload)) {
      const detail = "Credential is cancelled and access must be denied.";
      setResult({ detail, state: "invalid_badge", title: "Cancelled badge" });
      setRecords((current) => addScanRecord(current, {
        detail,
        status: "denied",
        target: area.name,
      }));
      return;
    }

    const registrationTypeId = extractRegistrationTypeId(payload);

    if (area.registrationTypeIds.length > 0 && !area.registrationTypeIds.includes(registrationTypeId)) {
      const detail = `Registration type ${registrationTypeId} is not allowed in ${area.name}.`;
      setResult({ detail, state: "denied", title: "Access denied" });
      setRecords((current) => addScanRecord(current, {
        detail,
        status: "denied",
        target: area.name,
      }));
      return;
    }

    const detail = `Access granted. Participant current area is now ${area.name}.`;
    setResult({ detail, state: "allowed", title: "Access granted" });
    setRecords((current) => addScanRecord(current, {
      detail,
      status: "allowed",
      target: area.name,
    }));
  }, [areaId, areas]);

  return (
    <ScannerWorkflowFrame
      eyebrow={selectedEvent?.name ?? "Area access"}
      onScan={handleAreaScan}
      scannerLabel="Area badge scanner"
      title="Area access"
    >
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <ScannerResult detail={result.detail} state={result.state} title={result.title} />
      <section className="panel form-grid">
        <FormField label="Controlled area">
          <select onChange={(event) => setAreaId(event.target.value)} value={areaId}>
            <option value="">Select area</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </FormField>
      </section>
      <RecentScans records={records} />
    </ScannerWorkflowFrame>
  );
};

export const UnifiedScanScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [targetMode, setTargetMode] = useState<"session" | "area">("session");
  const [areaId, setAreaId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [result, setResult] = useState<{ detail: string; state: ScannerResultState; title: string }>({
    detail: "Choose a session or area. The camera will validate badge QR codes automatically.",
    state: "scanning",
    title: "Scanning",
  });
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" | "warn" } | null>(null);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    void Promise.all([
      api.listSessions(selectedEvent.id),
      api.listAreas(selectedEvent.id),
    ])
      .then(([loadedSessions, loadedAreas]) => {
        setSessions(loadedSessions);
        setAreas(loadedAreas);
        setSessionId((current) => current || loadedSessions.find((session) => session.status === "active")?.id || loadedSessions[0]?.id || "");
        setAreaId((current) => current || loadedAreas.find((area) => area.status === "active")?.id || loadedAreas[0]?.id || "");

        if (loadedSessions.length === 0 && loadedAreas.length > 0) {
          setTargetMode("area");
        }
      })
      .catch((error) => {
        setToast({
          message: error instanceof Error ? error.message : "Unable to load scan targets.",
          tone: "bad",
        });
      });
  }, [api, selectedEvent]);

  const handleBadgeScan = useCallback((payload: string) => {
    if (targetMode === "session") {
      const session = sessions.find((currentSession) => currentSession.id === sessionId);

      if (!session) {
        setResult({
          detail: "Select a session before reading badges.",
          state: "invalid_participant",
          title: "No session selected",
        });
        return;
      }

      if (cancelledCredential(payload)) {
        const detail = "Credential is cancelled and session access must be denied.";
        setResult({ detail, state: "invalid_badge", title: "Cancelled badge" });
        setRecords((current) => addScanRecord(current, {
          detail,
          status: "denied",
          target: session.name,
        }));
        return;
      }

      const areaName = areas.find((area) => area.id === session.areaId)?.name;
      const detail = areaName
        ? `Credential accepted for ${session.name}. Presence moved to ${areaName}.`
        : `Credential accepted for ${session.name}.`;

      setResult({ detail, state: "allowed", title: "Session check-in saved" });
      setRecords((current) => addScanRecord(current, {
        detail,
        status: "checked in",
        target: session.name,
      }));
      return;
    }

    const area = areas.find((currentArea) => currentArea.id === areaId);

    if (!area) {
      setResult({
        detail: "Select an area before reading badges.",
        state: "invalid_participant",
        title: "No area selected",
      });
      return;
    }

    if (cancelledCredential(payload)) {
      const detail = "Credential is cancelled and access must be denied.";
      setResult({ detail, state: "invalid_badge", title: "Cancelled badge" });
      setRecords((current) => addScanRecord(current, {
        detail,
        status: "denied",
        target: area.name,
      }));
      return;
    }

    const registrationTypeId = extractRegistrationTypeId(payload);

    if (area.registrationTypeIds.length > 0 && !area.registrationTypeIds.includes(registrationTypeId)) {
      const detail = `Registration type ${registrationTypeId} is not allowed in ${area.name}.`;
      setResult({ detail, state: "denied", title: "Access denied" });
      setRecords((current) => addScanRecord(current, {
        detail,
        status: "denied",
        target: area.name,
      }));
      return;
    }

    const detail = `Access granted. Participant current area is now ${area.name}.`;
    setResult({ detail, state: "allowed", title: "Access granted" });
    setRecords((current) => addScanRecord(current, {
      detail,
      status: "allowed",
      target: area.name,
    }));
  }, [areaId, areas, sessionId, sessions, targetMode]);

  return (
    <ScannerWorkflowFrame
      eyebrow={selectedEvent?.name ?? "Badge scan"}
      onScan={handleBadgeScan}
      scannerLabel="Badge scanner"
      title="Scan"
    >
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <ScannerResult detail={result.detail} state={result.state} title={result.title} />
      <section className="panel form-grid">
        <div className="form-grid-full scope-selector">
          <div className="scope-selector-header">
            <strong>Scan target</strong>
            <div className="segmented-control" role="group" aria-label="Scan target">
              <button
                className={targetMode === "session" ? "active" : ""}
                disabled={sessions.length === 0}
                onClick={() => setTargetMode("session")}
                type="button"
              >
                Session
              </button>
              <button
                className={targetMode === "area" ? "active" : ""}
                disabled={areas.length === 0}
                onClick={() => setTargetMode("area")}
                type="button"
              >
                Area
              </button>
            </div>
          </div>
          {targetMode === "session" ? (
            <FormField label="Session">
              <select onChange={(event) => setSessionId(event.target.value)} value={sessionId}>
                <option value="">Select session</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Area">
              <select onChange={(event) => setAreaId(event.target.value)} value={areaId}>
                <option value="">Select area</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>
      </section>
      <RecentScans records={records} />
    </ScannerWorkflowFrame>
  );
};

export const DashboardScreen = () => {
  const api = useApi();
  const { selectedEvent } = useEventContext();
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const loadDashboard = useCallback(async () => {
    if (!selectedEvent) {
      return;
    }

    setStatus("loading");
    try {
      const [loadedQueues, loadedTerminals] = await Promise.all([
        api.listQueues(selectedEvent.id),
        api.listTerminals(selectedEvent.id),
      ]);
      setQueues(loadedQueues);
      setTerminals(loadedTerminals);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [api, selectedEvent]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const activeQueues = useMemo(() => queues.filter((queue) => queue.status === "active").length, [queues]);
  const onlineTerminals = useMemo(() => terminals.filter((terminal) => terminal.status === "online").length, [terminals]);

  return (
    <WorkflowFrame actions={<button className="button button-secondary" onClick={() => void loadDashboard()} type="button">Refresh</button>} eyebrow="Analytics" title="Dashboard">
      {status === "loading" ? <LoadingState label="Loading dashboard" /> : null}
      {status === "error" ? <Toast message="Unable to load dashboard data." tone="bad" /> : null}
      <section className="metric-grid">
        <div className="metric-card">
          <span>Event</span>
          <strong>{selectedEvent?.name ?? "No event"}</strong>
        </div>
        <div className="metric-card">
          <span>Active queues</span>
          <strong>{activeQueues}</strong>
        </div>
        <div className="metric-card">
          <span>Online terminals</span>
          <strong>{onlineTerminals}</strong>
        </div>
        <div className="metric-card">
          <span>Credentialing</span>
          <strong>{selectedEvent?.registration ? "Enabled" : "Disabled"}</strong>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Queue health</h2>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "name", label: "Queue" },
            { key: "status", label: "Status" },
            { key: "terminals", label: "Assigned terminals" },
          ]}
          rows={queues.map((queue) => ({
            name: queue.name,
            status: queue.status,
            terminals: String(queue.activeTerminalCount),
          }))}
        />
      </section>
    </WorkflowFrame>
  );
};

export const LayoutEditorScreen = () => {
  const labelTypes = [
    { id: "dymo-650-address", name: "Dymo 650 address label", widthMm: 89, heightMm: 36 },
    { id: "brother-ql-800-62x100", name: "Brother QL-800 62x100mm", widthMm: 62, heightMm: 100 },
    { id: "brother-ql-800-62x29", name: "Brother QL-800 62x29mm", widthMm: 62, heightMm: 29 },
  ];
  const [fields, setFields] = useState({
    company: true,
    jobTitle: true,
    name: true,
    qrCode: true,
  });
  const [positions, setPositions] = useState({
    company: { x: 50, y: 68 },
    jobTitle: { x: 50, y: 80 },
    name: { x: 50, y: 52 },
    qrCode: { x: 50, y: 22 },
  });
  const [nameMode, setNameMode] = useState<"full" | "first">("full");
  const [labelTypeId, setLabelTypeId] = useState(labelTypes[0].id);
  const [layoutName, setLayoutName] = useState("Default badge");
  const [saved, setSaved] = useState(false);
  const labelType = labelTypes.find((type) => type.id === labelTypeId) ?? labelTypes[0];

  const updateField = (field: keyof typeof fields, checked: boolean) => {
    setSaved(false);
    setFields((current) => ({ ...current, [field]: checked }));
  };

  const moveField = (event: DragEvent<HTMLDivElement>) => {
    const field = event.dataTransfer.getData("text/plain") as keyof typeof positions;

    if (!field) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(4, Math.min(96, ((event.clientY - rect.top) / rect.height) * 100));

    setSaved(false);
    setPositions((current) => ({
      ...current,
      [field]: { x, y },
    }));
  };

  const dragField = (event: DragEvent<HTMLElement>, field: keyof typeof positions) => {
    event.dataTransfer.setData("text/plain", field);
  };

  return (
    <WorkflowFrame title="Layout editor">
      {saved ? <Toast message="Layout draft saved in this browser session." tone="good" /> : null}
      <section className="layout-editor-grid">
        <form className="panel form-grid" onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}>
          <div className="panel-header form-grid-full">
            <div>
              <h2>Badge layout</h2>
              <p>Select which participant fields appear on the printed badge.</p>
            </div>
          </div>
          <FormField label="Layout name">
            <input onChange={(event) => {
              setSaved(false);
              setLayoutName(event.target.value);
            }} value={layoutName} />
          </FormField>
          <FormField label="Label type">
            <select onChange={(event) => {
              setSaved(false);
              setLabelTypeId(event.target.value);
            }} value={labelTypeId}>
              {labelTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} ({type.widthMm}x{type.heightMm}mm)
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Name field">
            <select onChange={(event) => {
              setSaved(false);
              setNameMode(event.target.value as "full" | "first");
            }} value={nameMode}>
              <option value="full">Full name</option>
              <option value="first">First name only</option>
            </select>
          </FormField>
          {Object.entries(fields).map(([key, enabled]) => (
            <label className="checkbox-field" key={key}>
              <input
                checked={enabled}
                onChange={(event) => updateField(key as keyof typeof fields, event.target.checked)}
                type="checkbox"
              />
              <span>{key.replace(/([A-Z])/g, " $1")}</span>
            </label>
          ))}
          <div className="form-actions form-grid-full">
            <button className="button button-primary" type="submit">
              Save draft
            </button>
          </div>
        </form>
        <section className="badge-preview" aria-label="Badge preview">
          <div
            className="badge-paper layout-canvas"
            onDragOver={(event) => event.preventDefault()}
            onDrop={moveField}
            style={{
              aspectRatio: `${labelType.widthMm} / ${labelType.heightMm}`,
            }}
          >
            {fields.qrCode ? (
              <div
                className="badge-element badge-qr"
                draggable
                onDragStart={(event) => dragField(event, "qrCode")}
                style={{ left: `${positions.qrCode.x}%`, top: `${positions.qrCode.y}%` }}
              >
                QR
              </div>
            ) : null}
            {fields.name ? (
              <strong
                className="badge-element"
                draggable
                onDragStart={(event) => dragField(event, "name")}
                style={{ left: `${positions.name.x}%`, top: `${positions.name.y}%` }}
              >
                {nameMode === "first" ? "Jane" : "Jane Participant"}
              </strong>
            ) : null}
            {fields.company ? (
              <span
                className="badge-element"
                draggable
                onDragStart={(event) => dragField(event, "company")}
                style={{ left: `${positions.company.x}%`, top: `${positions.company.y}%` }}
              >
                Acme Events
              </span>
            ) : null}
            {fields.jobTitle ? (
              <small
                className="badge-element"
                draggable
                onDragStart={(event) => dragField(event, "jobTitle")}
                style={{ left: `${positions.jobTitle.x}%`, top: `${positions.jobTitle.y}%` }}
              >
                Operations Director
              </small>
            ) : null}
          </div>
        </section>
      </section>
    </WorkflowFrame>
  );
};
