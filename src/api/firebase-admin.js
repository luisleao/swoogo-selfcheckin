const {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { apiError } = require("./errors");

let cachedApp = null;
let cachedAuth = null;
let cachedFirestore = null;

const FIRESTORE_DATABASE_ID = "attendee-registry";

function readPrivateKey(value) {
  if (!value) {
    return null;
  }

  return value.replace(/\\n/g, "\n");
}

function getFirebaseCredential(env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = readPrivateKey(env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return {
      credential: cert({
        clientEmail,
        privateKey,
        projectId,
      }),
      projectId,
    };
  }

  if (projectId || env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      credential: applicationDefault(),
      projectId,
    };
  }

  return null;
}

function hasFirebaseAdminConfig(env = process.env) {
  return Boolean(
    (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY)
      || env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

function getFirebaseApp(env = process.env) {
  if (cachedApp) {
    return cachedApp;
  }

  const firebaseConfig = getFirebaseCredential(env);

  if (!firebaseConfig) {
    throw apiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "Firebase Admin credentials are not configured",
    );
  }

  cachedApp = getApps().length
    ? getApp()
    : initializeApp(firebaseConfig);

  return cachedApp;
}

function getFirebaseAuth(env = process.env) {
  if (cachedAuth) {
    return cachedAuth;
  }

  cachedAuth = getAuth(getFirebaseApp(env));
  return cachedAuth;
}

function getFirestoreDb(env = process.env) {
  if (cachedFirestore) {
    return cachedFirestore;
  }

  cachedFirestore = getFirestore(getFirebaseApp(env), FIRESTORE_DATABASE_ID);
  return cachedFirestore;
}

function buildGlobalRoles(decodedToken) {
  const roles = Array.isArray(decodedToken.globalRoles)
    ? decodedToken.globalRoles
    : Array.isArray(decodedToken.roles)
      ? decodedToken.roles
      : [];

  if (decodedToken.superAdmin === true && !roles.includes("super_admin")) {
    return [...roles, "super_admin"];
  }

  return roles;
}

async function verifyFirebaseIdToken(token) {
  const decodedToken = await getFirebaseAuth().verifyIdToken(token, true);

  return {
    uid: decodedToken.uid,
    email: decodedToken.email,
    name: decodedToken.name,
    globalRoles: buildGlobalRoles(decodedToken),
    eventMemberships: decodedToken.eventMemberships,
  };
}

module.exports = {
  FIRESTORE_DATABASE_ID,
  admin: {
    applicationDefault,
    cert,
    getApp,
    getApps,
    initializeApp,
  },
  getFirebaseApp,
  getFirebaseAuth,
  getFirestoreDb,
  hasFirebaseAdminConfig,
  verifyFirebaseIdToken,
};
