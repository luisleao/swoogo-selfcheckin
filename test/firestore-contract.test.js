const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { FIRESTORE_DATABASE_ID } = require("../src/api/firebase-admin");

function readIndexes() {
  return JSON.parse(fs.readFileSync("firestore.indexes.json", "utf8")).indexes;
}

function hasIndex(indexes, collectionGroup, fields) {
  return indexes.some((index) => {
    return index.collectionGroup === collectionGroup
      && fields.every((field, position) => {
        const actual = index.fields[position];
        return actual
          && actual.fieldPath === field.fieldPath
          && actual.order === field.order;
      });
  });
}

test("firestore index manifest covers MVP collection groups", () => {
  const indexes = readIndexes();
  const groups = new Set(indexes.map((index) => index.collectionGroup));

  for (const group of [
    "participants",
    "credentials",
    "printJobs",
    "queueEntries",
    "sessions",
    "sessionCheckins",
    "participantOverrides",
    "gates",
    "areaPassages",
    "accessPassages",
    "messageJobs",
    "auditLogs",
  ]) {
    assert.ok(groups.has(group), `missing index group ${group}`);
  }
});

test("firestore index manifest includes critical queue and lookup composites", () => {
  const indexes = readIndexes();

  assert.ok(hasIndex(indexes, "participants", [
    { fieldPath: "normalizedEmail", order: "ASCENDING" },
    { fieldPath: "credentialing.status", order: "ASCENDING" },
  ]));
  assert.ok(hasIndex(indexes, "credentials", [
    { fieldPath: "participantId", order: "ASCENDING" },
    { fieldPath: "status", order: "ASCENDING" },
  ]));
  assert.ok(hasIndex(indexes, "printJobs", [
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "queueId", order: "ASCENDING" },
    { fieldPath: "priority", order: "DESCENDING" },
    { fieldPath: "createdAt", order: "ASCENDING" },
  ]));
  assert.ok(hasIndex(indexes, "messageJobs", [
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "createdAt", order: "ASCENDING" },
  ]));
});

test("firestore rules keep default-deny and secret-deny posture", () => {
  const rules = fs.readFileSync("firestore.rules", "utf8");

  assert.match(rules, /function hasNoSensitiveEventFields/);
  assert.match(rules, /match \/integrationSecrets\/\{secretId\}/);
  assert.match(rules, /allow read, write: if false;/);
  assert.match(rules, /match \/\{document=\*\*\}/);
});

test("backend uses the attendee-registry Firestore database", () => {
  const firebaseAdminSource = fs.readFileSync("src/api/firebase-admin.js", "utf8");

  assert.equal(FIRESTORE_DATABASE_ID, "attendee-registry");
  assert.match(firebaseAdminSource, /getFirestore\(getFirebaseApp\(env\), FIRESTORE_DATABASE_ID\)/);
});
