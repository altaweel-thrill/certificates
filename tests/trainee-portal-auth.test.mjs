import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/trainee-portal.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ rejectVerification = false, rejectSignIn = false, tokenUid = "uid-a" } = {}) {
  const calls = [];
  const exports = {};
  const challenge = { challengeId: "a".repeat(64), expiresAt: Date.now() + 300_000, resendAfterSeconds: 60 };
  const profile = { uid: "uid-a", traineeDocumentId: "trainee-a", nationalId: "ID-A", name: "متدرب", phoneNumber: "0501234567" };
  vm.runInNewContext(compiled, {
    exports, Date,
    require: (name) => {
      if (name === "./firebase") return { getFirebaseAuth: async () => ({}), getFirebaseFunctions: async () => ({}) };
      if (name === "firebase/functions") return {
        httpsCallable: (_functions, functionName) => async (input) => {
          calls.push({ name: functionName, input });
          if (functionName === "sendTraineeOtp") return { data: challenge };
          if (functionName === "verifyTraineeOtp") {
            if (rejectVerification) throw new Error("Incorrect code");
            return { data: { customToken: "server-custom-token", profile } };
          }
          throw new Error(`Unexpected callable: ${functionName}`);
        },
      };
      if (name === "firebase/auth") return {
        signInWithCustomToken: async (_auth, token) => {
          calls.push({ name: "signInWithCustomToken", token });
          if (rejectSignIn) throw new Error("Invalid token");
          return { user: { uid: tokenUid } };
        },
        signOut: async () => { calls.push({ name: "signOut" }); },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { ...exports, calls, challenge, profile };
}

test("client sends both normalized phone and identity to the server callable", async () => {
  const context = setup();
  const result = await context.sendTraineeVerificationCode("+966501234567", " ID-A ");
  assert.equal(context.calls[0].name, "sendTraineeOtp");
  assert.equal(context.calls[0].input.mobile, "0501234567");
  assert.equal(context.calls[0].input.nationalId, "ID-A");
  assert.equal(result.challengeId, context.challenge.challengeId);
  assert.ok(result.resendAvailableAt >= Date.now() + 59_000);
});

test("invalid client details are rejected before contacting the server", async () => {
  const context = setup();
  await assert.rejects(context.sendTraineeVerificationCode("123", "ID-A"));
  await assert.rejects(context.sendTraineeVerificationCode("0501234567", ""));
  assert.equal(context.calls.length, 0);
});

test("client validates the OTP on the server before signing into Firebase with the custom token", async () => {
  const context = setup();
  const result = await context.activateTraineeSession(context.challenge, "123456");
  assert.equal(result, context.profile);
  assert.deepEqual(context.calls.map((call) => call.name), ["verifyTraineeOtp", "signInWithCustomToken"]);
  assert.equal(context.calls[0].input.challengeId, context.challenge.challengeId);
  assert.equal(context.calls[0].input.code, "123456");
  assert.equal(context.calls[1].token, "server-custom-token");
});

test("failed code verification never signs into Firebase", async () => {
  const context = setup({ rejectVerification: true });
  await assert.rejects(context.activateTraineeSession(context.challenge, "123456"));
  assert.deepEqual(context.calls.map((call) => call.name), ["verifyTraineeOtp"]);
});

test("sign-in failures and UID mismatches clear the Firebase session", async () => {
  for (const options of [{ rejectSignIn: true }, { tokenUid: "wrong-uid" }]) {
    const context = setup(options);
    await assert.rejects(context.activateTraineeSession(context.challenge, "123456"));
    assert.equal(context.calls.at(-1).name, "signOut");
  }
});
