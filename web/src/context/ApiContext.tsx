import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createAdminApi } from "../api/admin";
import { createApiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { appConfig } from "../config/env";

type ApiContextValue = ReturnType<typeof createAdminApi>;

const ApiContext = createContext<ApiContextValue | undefined>(undefined);

export const ApiProvider = ({ children }: { children: ReactNode }) => {
  const { getIdToken, signOut } = useAuth();

  const api = useMemo(() => {
    const client = createApiClient({
      baseUrl: appConfig.apiBaseUrl,
      onUnauthorized: () => void signOut(),
      tokenProvider: { getIdToken },
    });

    return createAdminApi(client);
  }, [getIdToken, signOut]);

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
};

export const useApi = () => {
  const value = useContext(ApiContext);

  if (!value) {
    throw new Error("useApi must be used within ApiProvider");
  }

  return value;
};
