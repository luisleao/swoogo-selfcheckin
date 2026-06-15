import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as signOutFirebase,
  type User,
} from "firebase/auth";

import { appConfig, hasFirebaseClientConfig } from "../config/env";
import type { AuthUser, EventMembership, EventRole, RoleScope } from "../types";
import { getFirebaseAuth } from "./firebase";

const MOCK_AUTH_STORAGE_KEY = "swoogo.auth.mockUser";

const defaultScope = {
  allowedAreaIds: ["expo-floor", "vip-lounge"],
  allowedGateIds: ["north-gate"],
  allowedQueueIds: ["standard", "speaker"],
  allowedSessionIds: ["opening-keynote"],
};

export const MOCK_AUTH_USER: AuthUser = {
  displayName: "Local Admin",
  email: "admin@example.com",
  globalRoles: ["super_admin"],
  memberships: [
    {
      active: true,
      eventId: "demo-event",
      roles: [
        "event_admin",
        "pre_checkin_operator",
        "print_operator",
        "pickup_operator",
        "session_operator",
        "gate_operator",
        "dashboard_viewer",
        "layout_editor",
      ],
      scope: defaultScope,
    },
  ],
  uid: "local-admin",
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  authMode: typeof appConfig.authMode;
  error: string | null;
  getIdToken: () => Promise<string | null>;
  hasFirebaseConfig: boolean;
  signIn: (credentials?: { email: string; password: string }) => Promise<boolean>;
  signOut: () => Promise<void>;
  status: AuthStatus;
  user: AuthUser | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const readStoredMockUser = (): AuthUser | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(MOCK_AUTH_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
    return null;
  }
};

const writeStoredMockUser = (user: AuthUser | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (user) {
    window.localStorage.setItem(MOCK_AUTH_STORAGE_KEY, JSON.stringify(user));
    return;
  }

  window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
};

const emptyScope: RoleScope = {
  allowedAreaIds: [],
  allowedGateIds: [],
  allowedQueueIds: [],
  allowedSessionIds: [],
};

const normalizeRoleList = (value: unknown): EventRole[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((role): role is EventRole => typeof role === "string");
};

const normalizeStringList = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
};

const membershipsFromClaims = (claims: Record<string, unknown>): EventMembership[] => {
  const rawMemberships = claims.eventMemberships;

  if (!rawMemberships || typeof rawMemberships !== "object" || Array.isArray(rawMemberships)) {
    return [];
  }

  return Object.entries(rawMemberships)
    .map(([eventId, rawMembership]) => {
      if (Array.isArray(rawMembership)) {
        return {
          active: true,
          eventId,
          roles: normalizeRoleList(rawMembership),
          scope: emptyScope,
        };
      }

      if (!rawMembership || typeof rawMembership !== "object") {
        return null;
      }

      const membership = rawMembership as Record<string, unknown>;

      return {
        active: membership.active !== false,
        eventId,
        roles: normalizeRoleList(membership.roles),
        scope: {
          allowedAreaIds: normalizeStringList(membership.allowedAreaIds ?? membership.allowedAreas),
          allowedGateIds: normalizeStringList(membership.allowedGateIds ?? membership.allowedGates),
          allowedQueueIds: normalizeStringList(membership.allowedQueueIds ?? membership.allowedQueues),
          allowedSessionIds: normalizeStringList(membership.allowedSessionIds ?? membership.allowedSessions),
        },
      };
    })
    .filter((membership): membership is EventMembership => Boolean(membership && membership.roles.length));
};

const globalRolesFromClaims = (claims: Record<string, unknown>): EventRole[] => {
  const roles = normalizeRoleList(claims.globalRoles ?? claims.roles);

  if (claims.superAdmin === true && !roles.includes("super_admin")) {
    return [...roles, "super_admin"];
  }

  return roles;
};

const authUserFromFirebaseUser = async (firebaseUser: User): Promise<AuthUser> => {
  const tokenResult = await firebaseUser.getIdTokenResult();

  return {
    displayName: firebaseUser.displayName || firebaseUser.email || firebaseUser.uid,
    email: firebaseUser.email || "",
    globalRoles: globalRolesFromClaims(tokenResult.claims),
    memberships: membershipsFromClaims(tokenResult.claims),
    uid: firebaseUser.uid,
  };
};

const messageFromAuthError = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);

    if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
      return "Invalid email or password.";
    }

    if (code === "auth/user-not-found") {
      return "No user exists with this email.";
    }

  }

  return error instanceof Error ? error.message : "Authentication failed.";
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (appConfig.authMode === "mock") {
      const storedMockUser = readStoredMockUser();
      setUser(storedMockUser);
      setStatus(storedMockUser ? "authenticated" : "unauthenticated");
      return;
    }

    if (!hasFirebaseClientConfig) {
      setError("Firebase client configuration is missing.");
      setUser(null);
      setStatus("unauthenticated");
      return;
    }

    const auth = getFirebaseAuth();

    return onAuthStateChanged(auth, (firebaseUser) => {
      void (async () => {
        setError(null);

        if (!firebaseUser) {
          setUser(null);
          setStatus("unauthenticated");
          return;
        }

        try {
          setUser(await authUserFromFirebaseUser(firebaseUser));
          setStatus("authenticated");
        } catch (authError) {
          setError(messageFromAuthError(authError));
          setUser(null);
          setStatus("unauthenticated");
        }
      })();
    });
  }, []);

  const signIn = useCallback((credentials?: { email: string; password: string }) => {
    setError(null);

    if (appConfig.authMode === "mock") {
      const mockUser = MOCK_AUTH_USER;
      writeStoredMockUser(mockUser);
      setUser(mockUser);
      setStatus("authenticated");

      return Promise.resolve(true);
    }

    if (appConfig.authMode === "firebase" && !hasFirebaseClientConfig) {
      setError("Firebase client configuration is missing.");
      return Promise.resolve(false);
    }

    if (!credentials?.email || !credentials.password) {
      setError("Email and password are required.");
      return Promise.resolve(false);
    }

    setStatus("loading");

    return signInWithEmailAndPassword(getFirebaseAuth(), credentials.email, credentials.password)
      .then(() => true)
      .catch((authError: unknown) => {
        setError(messageFromAuthError(authError));
        setStatus("unauthenticated");
        return false;
      });
  }, []);

  const signOut = useCallback(() => {
    if (appConfig.authMode === "mock") {
      writeStoredMockUser(null);
      setUser(null);
      setStatus("unauthenticated");

      return Promise.resolve();
    }

    return signOutFirebase(getFirebaseAuth());
  }, []);

  const getIdToken = useCallback(() => {
    if (appConfig.authMode === "mock") {
      if (!user) {
        return Promise.resolve(null);
      }

      return Promise.resolve("mock-firebase-id-token");
    }

    const firebaseUser = getFirebaseAuth().currentUser;

    if (!firebaseUser) {
      return Promise.resolve(null);
    }

    return firebaseUser.getIdToken();
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authMode: appConfig.authMode,
      error,
      getIdToken,
      hasFirebaseConfig: hasFirebaseClientConfig,
      signIn,
      signOut,
      status,
      user,
    }),
    [error, getIdToken, signIn, signOut, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return value;
};
