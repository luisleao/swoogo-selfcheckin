const TERMINAL_IDENTITY_STORAGE_KEY = "swoogo.terminal.identity";

export interface LocalTerminalIdentity {
  terminalId: string;
  terminalName: string;
}

export const emptyTerminalIdentity: LocalTerminalIdentity = {
  terminalId: "",
  terminalName: "",
};

export const readLocalTerminalIdentity = (): LocalTerminalIdentity => {
  if (typeof window === "undefined") {
    return emptyTerminalIdentity;
  }

  const raw = window.localStorage.getItem(TERMINAL_IDENTITY_STORAGE_KEY);

  if (!raw) {
    return emptyTerminalIdentity;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalTerminalIdentity>;
    const terminalId = typeof parsed.terminalId === "string" ? parsed.terminalId.trim() : "";
    const terminalName = typeof parsed.terminalName === "string" ? parsed.terminalName.trim() : "";

    return {
      terminalId,
      terminalName: terminalName || terminalId,
    };
  } catch {
    window.localStorage.removeItem(TERMINAL_IDENTITY_STORAGE_KEY);
    return emptyTerminalIdentity;
  }
};

export const writeLocalTerminalIdentity = (identity: LocalTerminalIdentity) => {
  if (typeof window === "undefined") {
    return;
  }

  const terminalId = identity.terminalId.trim();
  const terminalName = identity.terminalName.trim() || terminalId;

  if (!terminalId) {
    window.localStorage.removeItem(TERMINAL_IDENTITY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    TERMINAL_IDENTITY_STORAGE_KEY,
    JSON.stringify({
      terminalId,
      terminalName,
    })
  );
};
