import { useEffect, useState } from "react";

import { DataTable, FormField, ScannerResult, StatusBadge, Toast } from "../../components/primitives";
import {
  emptyTerminalIdentity,
  readLocalTerminalIdentity,
  writeLocalTerminalIdentity,
  type LocalTerminalIdentity,
} from "../../terminal/terminalIdentity";
import type { ScannerResultState } from "../../types";

export const PrintPickupScreen = () => {
  const [identity, setIdentity] = useState<LocalTerminalIdentity>(emptyTerminalIdentity);
  const [draftIdentity, setDraftIdentity] = useState<LocalTerminalIdentity>(emptyTerminalIdentity);
  const [badgeQr, setBadgeQr] = useState("");
  const [pickupRecords, setPickupRecords] = useState<{ badge: string; status: string; time: string }[]>([]);
  const [result, setResult] = useState<{ detail: string; state: ScannerResultState; title: string }>({
    detail: "Configure the terminal identity, then scan a printed badge when it is delivered.",
    state: "ready",
    title: "Ready",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const localIdentity = readLocalTerminalIdentity();
    setIdentity(localIdentity);
    setDraftIdentity(localIdentity);
  }, []);

  const terminalName = identity.terminalName || "No terminal configured";
  const hasTerminal = Boolean(identity.terminalId);

  const handleSave = () => {
    writeLocalTerminalIdentity(draftIdentity);

    const localIdentity = readLocalTerminalIdentity();
    setIdentity(localIdentity);
    setDraftIdentity(localIdentity);
    setSaved(true);
  };

  const handlePickup = () => {
    const badge = badgeQr.trim();

    if (!badge) {
      setResult({
        detail: "Scan or enter the badge QR payload before confirming pickup.",
        state: "invalid_badge",
        title: "Badge missing",
      });
      return;
    }

    if (!hasTerminal) {
      setResult({
        detail: "Save this terminal identity before confirming badge delivery.",
        state: "offline_pending",
        title: "Terminal identity required",
      });
      return;
    }

    setPickupRecords((current) => [
      {
        badge,
        status: "delivered",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      },
      ...current,
    ].slice(0, 8));
    setResult({
      detail: `Badge delivery recorded at ${terminalName}.`,
      state: "allowed",
      title: "Badge delivered",
    });
    setBadgeQr("");
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workflow</p>
          <h1>Print and pickup</h1>
        </div>
        <StatusBadge label={hasTerminal ? terminalName : "Terminal missing"} tone={hasTerminal ? "good" : "warn"} />
      </header>

      {saved ? <Toast message="Terminal identity saved locally." tone="good" /> : null}

      <section className="panel terminal-panel">
        <div className="panel-header">
          <div>
            <h2>Terminal identity</h2>
            <p>
              This browser shows the local terminal name so operators can confirm they are using the
              correct print station.
            </p>
          </div>
          <StatusBadge label={terminalName} tone={hasTerminal ? "neutral" : "warn"} />
        </div>

        <dl className="terminal-summary">
          <div>
            <dt>Terminal name</dt>
            <dd>{terminalName}</dd>
          </div>
          <div>
            <dt>Terminal ID</dt>
            <dd>{identity.terminalId || "Not saved"}</dd>
          </div>
        </dl>

        <div className="form-grid">
          <FormField hint="Use the same ID saved by the local print worker script." label="Terminal ID">
            <input
              onChange={(event) => {
                setSaved(false);
                setDraftIdentity((current) => ({ ...current, terminalId: event.target.value }));
              }}
              value={draftIdentity.terminalId}
            />
          </FormField>
          <FormField hint="Operator-facing name displayed on this terminal." label="Terminal name">
            <input
              onChange={(event) => {
                setSaved(false);
                setDraftIdentity((current) => ({ ...current, terminalName: event.target.value }));
              }}
              value={draftIdentity.terminalName}
            />
          </FormField>
        </div>

        <div className="state-actions">
          <button className="button button-primary" onClick={handleSave} type="button">
            Save locally
          </button>
        </div>
      </section>

      <section className="panel form-grid">
        <div className="panel-header form-grid-full">
          <div>
            <h2>Badge pickup</h2>
            <p>Scan the credential QR after document verification and badge handoff.</p>
          </div>
        </div>
        <FormField label="Credential QR payload">
          <input onChange={(event) => setBadgeQr(event.target.value)} value={badgeQr} />
        </FormField>
        <div className="form-actions">
          <button className="button button-primary" onClick={handlePickup} type="button">
            Confirm pickup
          </button>
        </div>
      </section>

      <ScannerResult detail={result.detail} state={result.state} title={result.title} />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Pickup history</h2>
          </div>
        </div>
        {pickupRecords.length === 0 ? (
          <p className="muted-copy">No badge deliveries in this browser session.</p>
        ) : (
          <DataTable
            columns={[
              { key: "time", label: "Time" },
              { key: "badge", label: "Badge" },
              { key: "status", label: "Status" },
            ]}
            rows={pickupRecords}
          />
        )}
      </section>
    </div>
  );
};
