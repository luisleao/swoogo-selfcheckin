import type { AppMode } from "../types";

type AuthMode = "firebase" | "mock";
type EnvKey =
  | "VITE_API_BASE_URL"
  | "VITE_AUTH_MODE"
  | "VITE_DEFAULT_APP_MODE"
  | "VITE_ENABLE_PWA"
  | "VITE_ENABLE_SERVICE_WORKER"
  | "VITE_FIREBASE_API_KEY"
  | "VITE_FIREBASE_AUTH_DOMAIN"
  | "VITE_FIREBASE_PROJECT_ID"
  | "VITE_FIREBASE_APP_ID"
  | "VITE_FIREBASE_MESSAGING_SENDER_ID"
  | "VITE_FIREBASE_STORAGE_BUCKET";

const appModes: AppMode[] = [
  "admin",
  "pre-check-in",
  "print-pickup",
  "sessions",
  "gates",
  "dashboard",
  "layout-editor",
];

const env = import.meta.env as unknown as Record<EnvKey, string | undefined>;

const readEnv = (key: EnvKey, fallback = ""): string => {
  return env[key] ?? fallback;
};

const readBoolean = (key: EnvKey, fallback = false) => {
  const value = readEnv(key);

  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const readAuthMode = (): AuthMode => {
  return readEnv("VITE_AUTH_MODE", "firebase") === "mock" ? "mock" : "firebase";
};

const readAppMode = (): AppMode => {
  const value = readEnv("VITE_DEFAULT_APP_MODE", "admin");

  return appModes.includes(value as AppMode) ? (value as AppMode) : "admin";
};

export const appConfig = {
  apiBaseUrl: normalizeBaseUrl(readEnv("VITE_API_BASE_URL", "http://localhost:3000")),
  authMode: readAuthMode(),
  defaultAppMode: readAppMode(),
  enablePwa: readBoolean("VITE_ENABLE_PWA"),
  enableServiceWorker: readBoolean("VITE_ENABLE_SERVICE_WORKER"),
  firebase: {
    apiKey: readEnv("VITE_FIREBASE_API_KEY"),
    appId: readEnv("VITE_FIREBASE_APP_ID"),
    authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    projectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  },
};

export const hasFirebaseClientConfig = Boolean(
  appConfig.firebase.apiKey &&
    appConfig.firebase.appId &&
    appConfig.firebase.authDomain &&
    appConfig.firebase.projectId
);
