import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

import { appConfig, hasFirebaseClientConfig } from "../config/env";

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

export const getFirebaseApp = () => {
  if (!hasFirebaseClientConfig) {
    throw new Error("Firebase client configuration is missing.");
  }

  if (firebaseApp) {
    return firebaseApp;
  }

  firebaseApp =
    getApps()[0] ??
    initializeApp({
      apiKey: appConfig.firebase.apiKey,
      appId: appConfig.firebase.appId,
      authDomain: appConfig.firebase.authDomain,
      messagingSenderId: appConfig.firebase.messagingSenderId,
      projectId: appConfig.firebase.projectId,
      storageBucket: appConfig.firebase.storageBucket || undefined,
    });

  return firebaseApp;
};

export const getFirebaseAuth = () => {
  if (firebaseAuth) {
    return firebaseAuth;
  }

  firebaseAuth = getAuth(getFirebaseApp());
  return firebaseAuth;
};
