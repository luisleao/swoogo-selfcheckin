import type { ReactNode } from "react";

import { LoadingState } from "../components/primitives";
import { useAuth } from "./AuthContext";

export const FirebaseAuthBoundary = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();

  if (status === "loading") {
    return <LoadingState label="Checking session" />;
  }

  return <>{children}</>;
};
