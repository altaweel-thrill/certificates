import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../functions/src/trainee-otp.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const credentials = { nationalId: "TRAINEE-A", mobile: "0501234567" };

function setup({ providerStatus = 200, providerSuccess = true, providerThrows = false, user = null } = {}) {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  class Timestamp {
    constructor(value) { this.value = value; }
    static fromMillis(value) { return new Timestamp(value); }
    toMillis() { return this.value; }
  }
  class HttpsError extends Error {
    constructor(code, message, details) { super(message); this.code = code; this.details = details; }
  }
  const records = new Map([["trainees/trainee-a", { ...credentials, nameAr: "متدرب تجريبي" }]]);
  const deliveries = [];
  const tokens = [];
  const users = new Map(user ? [[user.uid, { ...user, phoneNumber: "+966501234567" }]] : []);
  function snapshot(path) {
    const data = records.get(path);
    return { id: path.split("/").at(-1), exists: Boolean(data), data: () => data ? { ...data } : undefined };
  }
  function set(path, data, options) {
    records.set(path, options?.merge ? { ...records.get(path), ...data } : { ...data });
  }
  let transactionQueue = Promise.resolve();
  const database = {
    doc: (path) => ({ path, get: async () => snapshot(path), update: async (data) => set(path, data, { merge: true }) }),
    collection: (name) => ({ where: (field, _op, value) => ({ limit: (count) => ({ get: async () => {
      const docs = [...records.keys()].filter((path) => path.startsWith(`${name}/`) && records.get(path)[field] === value).slice(0, count).map(snapshot);
      return { docs, size: docs.length };
    } }) }) }),
    runTransaction: (callback) => {
      const next = transactionQueue.then(async () => {
        const writes = [];
        const result = await callback({
          get: async ({ path }) => snapshot(path),
          set: ({ path }, data, options) => writes.push(() => set(path, data, options)),
          update: ({ path }, data) => writes.push(() => set(path, data, { merge: true })),
        });
        writes.forEach((write) => write());
        return result;
      });
      transactionQueue = next.catch(() => undefined);
      return next;
    },
  };
  const auth = {
    getUserByPhoneNumber: async (phone) => {
      const record = [...users.values()].find((item) => item.phoneNumber === phone);
      if (!record) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      return record;
    },
    createUser: async (input) => {
      const record = { uid: "trainee-uid", disabled: false, ...input };
      users.set(record.uid, record);
      return record;
    },
    createCustomToken: async (uid) => { tokens.push(uid); return `custom-token:${uid}`; },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date: Clock, Buffer, AbortSignal, console,
    fetch: async (url, request) => {
      deliveries.push({ url, request, body: JSON.parse(request.body) });
      if (providerThrows) throw new Error("Connection timeout");
      return new Response(JSON.stringify({ success: providerSuccess, otp: deliveries.at(-1).body.otp, private: "provider-private-response" }), { status: providerStatus });
    },
    require: (name) => {
      if (name === "node:crypto") return crypto;
      if (name === "firebase-admin/firestore") return { getFirestore: () => database, Timestamp, FieldValue: { serverTimestamp: () => Timestamp.fromMillis(now) } };
      if (name === "firebase-admin/auth") return { getAuth: () => auth };
      if (name === "firebase-functions/params") return { defineSecret: () => ({ value: () => "test-server-secret" }) };
      if (name === "firebase-functions/v2/https") return { HttpsError, onCall: (_options, handler) => handler };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const request = (data) => ({ data, rawRequest: { ip: "127.0.0.1" } });
  return {
    records, users, deliveries, tokens, Timestamp,
    advance: (milliseconds) => { now += milliseconds; },
    send: (data = credentials) => exports.sendTraineeOtp(request(data)),
    verify: (challengeId, code) => exports.verifyTraineeOtp(request({ challengeId, code })),
  };
}

test("SMS uses Authentica with a server-generated six-digit code, without leaking it to clients or Firestore", async () => {
  const context = setup();
  const challenge = await context.send();
  const delivery = context.deliveries[0];
  assert.equal(delivery.url, "https://api.authentica.sa/api/v2/send-otp");
  assert.equal(delivery.request.headers["X-Authorization"], "test-server-secret");
  assert.equal(delivery.body.phone, "+966501234567");
  assert.equal(delivery.body.method, "sms");
  assert.match(delivery.body.otp, /^\d{6}$/);
  assert.match(challenge.challengeId, /^[a-f0-9]{64}$/);
  assert.equal(challenge.resendAfterSeconds, 60);
  assert.deepEqual(Object.keys(challenge).sort(), ["challengeId", "expiresAt", "resendAfterSeconds"]);
  const stored = context.records.get(`traineeOtpChallenges/${challenge.challengeId}`);
  assert.equal(stored.otp, undefined);
  assert.match(stored.codeHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(stored).includes("test-server-secret"), false);
});

test("a verified code creates the linked trainee profile and returns a Firebase custom token", async () => {
  const context = setup();
  const challenge = await context.send();
  const result = await context.verify(challenge.challengeId, context.deliveries[0].body.otp);
  assert.equal(result.profile.traineeDocumentId, "trainee-a");
  assert.equal(result.profile.nationalId, "TRAINEE-A");
  assert.equal(result.customToken, "custom-token:trainee-uid");
  assert.equal(context.records.get("users/trainee-uid").role, "trainee");
  assert.equal(context.tokens.length, 1);
});

test("identity/mobile mismatch never sends SMS", async () => {
  const context = setup();
  await assert.rejects(context.send({ ...credentials, mobile: "0507654321" }), { code: "permission-denied" });
  await assert.rejects(context.send({ ...credentials, nationalId: "UNKNOWN" }), { code: "permission-denied" });
  assert.equal(context.deliveries.length, 0);
});

test("duplicate identity records are rejected before sending", async () => {
  const context = setup();
  context.records.set("trainees/duplicate", { ...credentials });
  await assert.rejects(context.send(), { code: "permission-denied" });
  assert.equal(context.deliveries.length, 0);
});

test("server resend cooldown applies even when a fresh client submits the same phone", async () => {
  const context = setup();
  await context.send();
  await assert.rejects(context.send(), (error) => error.code === "resource-exhausted" && error.details.retryAfterSeconds === 60);
  assert.equal(context.deliveries.length, 1);
});

test("six hourly sends are allowed, the seventh is rejected", async () => {
  const context = setup();
  for (let count = 0; count < 6; count += 1) {
    await context.send();
    context.advance(61_000);
  }
  await assert.rejects(context.send(), { code: "resource-exhausted" });
  assert.equal(context.deliveries.length, 6);
});

test("IP throttling also limits requests with nonexistent trainee identifiers", async () => {
  const context = setup();
  for (let count = 0; count < 30; count += 1) {
    await assert.rejects(context.send({ ...credentials, nationalId: "UNKNOWN" }), { code: "permission-denied" });
  }
  await assert.rejects(context.send(), { code: "resource-exhausted" });
  assert.equal(context.deliveries.length, 0);
});

test("five wrong codes lock the challenge, including a later correct code", async () => {
  const context = setup();
  const challenge = await context.send();
  const actualCode = context.deliveries[0].body.otp;
  const wrongCode = actualCode === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(context.verify(challenge.challengeId, wrongCode), { code: "invalid-argument" });
  }
  await assert.rejects(context.verify(challenge.challengeId, wrongCode), (error) => error.code === "resource-exhausted" && error.details.restartVerification);
  await assert.rejects(context.verify(challenge.challengeId, actualCode), { code: "resource-exhausted" });
  assert.equal(context.records.get(`traineeOtpChallenges/${challenge.challengeId}`).attempts, 5);
  assert.equal(context.tokens.length, 0);
});

test("expired codes cannot sign in", async () => {
  const context = setup();
  const challenge = await context.send();
  context.advance(5 * 60_000);
  await assert.rejects(context.verify(challenge.challengeId, context.deliveries[0].body.otp), { code: "deadline-exceeded" });
  assert.equal(context.tokens.length, 0);
});

test("a replacement code invalidates the previous challenge", async () => {
  const context = setup();
  const first = await context.send();
  context.advance(61_000);
  const second = await context.send();
  await assert.rejects(context.verify(first.challengeId, context.deliveries[0].body.otp), { code: "deadline-exceeded" });
  await context.verify(second.challengeId, context.deliveries[1].body.otp);
  assert.equal(context.tokens.length, 1);
});

test("concurrent verification and later replay issue only one token", async () => {
  const context = setup();
  const challenge = await context.send();
  const code = context.deliveries[0].body.otp;
  const outcomes = await Promise.allSettled([context.verify(challenge.challengeId, code), context.verify(challenge.challengeId, code)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  await assert.rejects(context.verify(challenge.challengeId, code), { code: "deadline-exceeded" });
  assert.equal(context.tokens.length, 1);
});

test("SMS provider failure leaves the challenge unusable and never leaks its response", async () => {
  for (const options of [{ providerStatus: 401 }, { providerStatus: 500 }, { providerSuccess: false }, { providerThrows: true }]) {
    const context = setup(options);
    await assert.rejects(context.send(), (error) => !error.message.includes("provider-private-response") && error.details.retryAfterSeconds === 60);
    const path = [...context.records.keys()].find((item) => item.startsWith("traineeOtpChallenges/"));
    await assert.rejects(context.verify(path.split("/")[1], context.deliveries[0].body.otp), { code: "unavailable" });
    assert.equal(context.tokens.length, 0);
  }
});

test("privileged and disabled phone accounts cannot be reassigned as trainees", async () => {
  for (const user of [{ uid: "admin", customClaims: { role: "admin" } }, { uid: "disabled", disabled: true }, { uid: "company", customClaims: { role: "company_admin" } }]) {
    const context = setup({ user });
    await assert.rejects(context.send(), { code: "permission-denied" });
    assert.equal(context.deliveries.length, 0);
    assert.equal(context.tokens.length, 0);
  }
});

test("existing trainee UID is reused and an account disabled after sending cannot log in", async () => {
  const context = setup({ user: { uid: "existing" } });
  const challenge = await context.send();
  context.users.get("existing").disabled = true;
  await assert.rejects(context.verify(challenge.challengeId, context.deliveries[0].body.otp), { code: "permission-denied" });
  assert.equal(context.tokens.length, 0);
  context.users.get("existing").disabled = false;
  context.advance(61_000);
  const second = await context.send();
  const result = await context.verify(second.challengeId, context.deliveries[1].body.otp);
  assert.equal(result.profile.uid, "existing");
  assert.equal(context.users.size, 1);
});

test("trainee data is checked again after sending the SMS", async () => {
  const context = setup();
  const challenge = await context.send();
  context.records.get("trainees/trainee-a").mobile = "0507654321";
  await assert.rejects(context.verify(challenge.challengeId, context.deliveries[0].body.otp), { code: "permission-denied" });
  assert.equal(context.tokens.length, 0);
});
