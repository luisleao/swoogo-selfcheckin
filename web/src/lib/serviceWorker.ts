import { appConfig } from "../config/env";

export const SERVICE_WORKER_UPDATE_EVENT = "swoogo-service-worker-update";

const notifyUpdateAvailable = () => {
  window.dispatchEvent(new Event(SERVICE_WORKER_UPDATE_EVENT));
};

export const registerServiceWorker = () => {
  if (!appConfig.enableServiceWorker || typeof navigator === "undefined") {
    return;
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (registration.waiting) {
        notifyUpdateAvailable();
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;

        if (!worker) {
          return;
        }

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            notifyUpdateAvailable();
          }
        });
      });
    });
  });
};
