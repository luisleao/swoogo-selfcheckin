import type { ReactNode } from "react";

import type { ScannerResultState } from "../types";

export const LoadingState = ({ label = "Loading" }: { label?: string }) => (
  <div className="state state-loading" role="status">
    <span className="spinner" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export const EmptyState = ({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) => (
  <div className="state">
    <h2>{title}</h2>
    <p>{description}</p>
    {action ? <div className="state-actions">{action}</div> : null}
  </div>
);

export const ErrorState = ({
  action,
  message,
  title = "Something went wrong",
}: {
  action?: ReactNode;
  message: string;
  title?: string;
}) => (
  <div className="state state-error" role="alert">
    <h2>{title}</h2>
    <p>{message}</p>
    {action ? <div className="state-actions">{action}</div> : null}
  </div>
);

export const StatusBadge = ({ label, tone = "neutral" }: { label: string; tone?: "good" | "neutral" | "warn" | "bad" }) => (
  <span className={`status-badge status-badge-${tone}`}>{label}</span>
);

export const Toast = ({
  message,
  tone = "neutral",
}: {
  message: string;
  tone?: "good" | "neutral" | "warn" | "bad";
}) => (
  <div className={`toast toast-${tone}`} role="status">
    {message}
  </div>
);

export const FormField = ({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) => (
  <label className="form-field">
    <span>{label}</span>
    {children}
    {hint ? <small>{hint}</small> : null}
  </label>
);

export const ConfirmationModal = ({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) => (
  <div className="modal-backdrop" role="presentation">
    <section aria-labelledby="confirmation-title" aria-modal="true" className="modal" role="dialog">
      <h2 id="confirmation-title">{title}</h2>
      <p>{body}</p>
      <div className="modal-actions">
        <button className="button button-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button button-danger" onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
      </div>
    </section>
  </div>
);

export const Modal = ({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) => (
  <div className="modal-backdrop" role="presentation">
    <section aria-labelledby="modal-title" aria-modal="true" className="modal" role="dialog">
      <div className="modal-header">
        <h2 id="modal-title">{title}</h2>
        <button aria-label="Close" className="button button-secondary" onClick={onClose} type="button">
          Close
        </button>
      </div>
      {children}
    </section>
  </div>
);

export const DataTable = <TRow extends Record<string, ReactNode>>({
  columns,
  rows,
}: {
  columns: { key: keyof TRow; label: string }[];
  rows: TRow[];
}) => (
  <div className="table-wrap">
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={String(column.key)} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {columns.map((column) => (
              <td key={String(column.key)}>{row[column.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const scannerResultTone: Record<ScannerResultState, "good" | "neutral" | "warn" | "bad"> = {
  allowed: "good",
  blocked: "bad",
  denied: "bad",
  duplicate: "warn",
  invalid_badge: "bad",
  invalid_participant: "bad",
  offline_pending: "warn",
  ready: "neutral",
  scanning: "neutral",
  sync_failure: "bad",
};

export const ScannerResult = ({
  detail,
  state,
  title,
}: {
  detail?: string;
  state: ScannerResultState;
  title: string;
}) => (
  <section className={`scanner-result scanner-result-${scannerResultTone[state]}`} aria-live="polite">
    <h2>{title}</h2>
    {detail ? <p>{detail}</p> : null}
  </section>
);
