import { getAuth, UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const authenticaApiKey = defineSecret("AUTHENTICA_API_KEY");
const OTP_LIFETIME_MS = 5 * 60_000;
const RESEND_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60_000;
const options = { region: "europe-west1", secrets: [authenticaApiKey], maxInstances: 10, timeoutSeconds: 30 };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMobile(value: unknown) {
  const digits = text(value).replace(/\D/g, "");
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function codeHash(key: string, challengeId: string, phone: string, nationalId: string, code: string) {
  return createHmac("sha256", key).update(JSON.stringify([challengeId, phone, nationalId, code])).digest("hex");
}

function millis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function requireApiKey() {
  const key = authenticaApiKey.value();
  if (!key) throw new HttpsError("failed-precondition", "خدمة إرسال رموز التحقق لم تُضبط بعد. تواصل مع إدارة المعهد.");
  return key;
}

function rejectMismatch(): never {
  throw new HttpsError("permission-denied", "رقم الهوية لا يطابق رقم الجوال المسجل لدى المعهد.");
}

function checkTraineeAccount(user: UserRecord, data: Record<string, unknown>, traineeDocumentId: string) {
  if (user.disabled || data.disabled === true) throw new HttpsError("permission-denied", "الحساب معطّل. تواصل مع إدارة المعهد.");
  const claimedRole = user.customClaims?.role;
  if (
    user.customClaims?.admin === true ||
    (claimedRole && claimedRole !== "trainee") ||
    (data.role && data.role !== "trainee") ||
    (data.traineeDocumentId && data.traineeDocumentId !== traineeDocumentId)
  ) {
    throw new HttpsError("permission-denied", "رقم الجوال مرتبط بحساب آخر. تواصل مع إدارة المعهد.");
  }
}

async function existingPhoneUser(phone: string): Promise<UserRecord | null> {
  try {
    return await getAuth().getUserByPhoneNumber(phone);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function sendAuthenticaCode(key: string, phone: string, code: string) {
  let response: Response;
  try {
    response = await fetch("https://api.authentica.sa/api/v2/send-otp", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "X-Authorization": key },
      body: JSON.stringify({ method: "sms", phone, otp: code }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new HttpsError("unavailable", "تعذر الاتصال بخدمة الرسائل. انتظر قليلًا ثم اطلب رمزًا جديدًا.");
  }
  // Never forward provider responses: they can contain the OTP or account details.
  if (response.status === 401 || response.status === 403) {
    throw new HttpsError("failed-precondition", "إعداد خدمة الرسائل غير صالح. تواصل مع إدارة المعهد.");
  }
  if (response.status === 402) {
    throw new HttpsError("failed-precondition", "رصيد خدمة الرسائل غير كافٍ. تواصل مع إدارة المعهد.");
  }
  if (response.status === 429) throw new HttpsError("resource-exhausted", "تم تجاوز محاولات إرسال الرمز. حاول لاحقًا.");
  if (!response.ok) throw new HttpsError("unavailable", "تعذر إرسال رمز التحقق حاليًا. حاول لاحقًا.");
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" ||
    ("success" in result && result.success === false) ||
    ("status" in result && (result.status === false || result.status === "error" || result.status === "failed"))) {
    throw new HttpsError("unavailable", "لم تقبل خدمة الرسائل طلب الإرسال. حاول لاحقًا.");
  }
}

async function reserveIpRequest(request: CallableRequest) {
  const database = getFirestore();
  const ip = request.rawRequest.ip || request.rawRequest.socket?.remoteAddress || "unknown";
  const reference = database.doc(`traineeOtpLimits/ip-${hash(ip)}`);
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() ?? {};
    const now = Date.now();
    const windowStart = millis(data.windowStart);
    const currentWindow = windowStart > now - HOUR_MS;
    const count = currentWindow ? Number(data.count) || 0 : 0;
    if (count >= 30) throw new HttpsError("resource-exhausted", "تم تجاوز عدد الطلبات من شبكتك. حاول لاحقًا.");
    transaction.set(reference, {
      windowStart: Timestamp.fromMillis(currentWindow ? windowStart : now),
      count: count + 1,
      expiresAt: Timestamp.fromMillis(now + 2 * HOUR_MS),
    });
  });
}

async function sendCode(request: CallableRequest) {
  const key = requireApiKey();
  const nationalId = text(request.data?.nationalId);
  const mobile = normalizeMobile(request.data?.mobile);
  if (!nationalId || nationalId.length > 200 || !mobile) {
    throw new HttpsError("invalid-argument", "أدخل المعرّف المسجل ورقم جوال سعودي صحيحًا.");
  }
  await reserveIpRequest(request);
  const database = getFirestore();
  const matches = await database.collection("trainees").where("nationalId", "==", nationalId).limit(2).get();
  if (matches.size !== 1) rejectMismatch();
  const trainee = matches.docs[0];
  const traineeData = trainee.data();
  if (normalizeMobile(traineeData.mobile) !== mobile) rejectMismatch();
  if (traineeData.disabled === true) throw new HttpsError("permission-denied", "الحساب معطّل. تواصل مع إدارة المعهد.");
  const phone = `+966${mobile.slice(1)}`;
  const existing = await existingPhoneUser(phone);
  if (existing) {
    const userSnapshot = await database.doc(`users/${existing.uid}`).get();
    checkTraineeAccount(existing, userSnapshot.data() ?? {}, trainee.id);
  }
  const challengeId = randomBytes(32).toString("hex");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challengeReference = database.doc(`traineeOtpChallenges/${challengeId}`);
  const phoneLimitReference = database.doc(`traineeOtpLimits/phone-${hash(phone)}`);
  const expiresAt = Date.now() + OTP_LIFETIME_MS;
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(phoneLimitReference);
    const data = snapshot.data() ?? {};
    const now = Date.now();
    const retryAfterSeconds = Math.ceil((millis(data.lastRequestAt) + RESEND_DELAY_MS - now) / 1000);
    if (retryAfterSeconds > 0) throw new HttpsError("resource-exhausted", `انتظر ${retryAfterSeconds} ثانية قبل طلب رمز جديد.`, { retryAfterSeconds });
    const windowStart = millis(data.windowStart);
    const currentWindow = windowStart > now - HOUR_MS;
    const count = currentWindow ? Number(data.count) || 0 : 0;
    if (count >= 6) throw new HttpsError("resource-exhausted", "تم تجاوز عدد الرسائل لهذا الجوال. حاول بعد ساعة.", { retryAfterSeconds: Math.ceil((windowStart + HOUR_MS - now) / 1000) });
    transaction.set(phoneLimitReference, {
      windowStart: Timestamp.fromMillis(currentWindow ? windowStart : now),
      lastRequestAt: Timestamp.fromMillis(now),
      count: count + 1,
      activeChallengeId: challengeId,
      expiresAt: Timestamp.fromMillis(now + 2 * HOUR_MS),
    });
    transaction.set(challengeReference, {
      nationalId, mobile, phone, traineeDocumentId: trainee.id,
      codeHash: codeHash(key, challengeId, phone, nationalId, code),
      attempts: 0, sentAt: null, usedAt: null,
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(expiresAt),
    });
  });
  try {
    await sendAuthenticaCode(key, phone, code);
  } catch (error) {
    if (error instanceof HttpsError) throw new HttpsError(error.code, error.message, { retryAfterSeconds: RESEND_DELAY_MS / 1000 });
    throw error;
  }
  await challengeReference.update({ sentAt: FieldValue.serverTimestamp() });
  return { challengeId, expiresAt, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
}

async function verifyCode(request: CallableRequest) {
  const key = requireApiKey();
  const challengeId = text(request.data?.challengeId);
  const code = text(request.data?.code);
  if (!/^[a-f0-9]{64}$/.test(challengeId) || !/^\d{6}$/.test(code)) {
    throw new HttpsError("invalid-argument", "رمز التحقق يجب أن يتكون من 6 أرقام.");
  }
  const database = getFirestore();
  const reference = database.doc(`traineeOtpChallenges/${challengeId}`);
  const result = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (!snapshot.exists || !data || data.usedAt || millis(data.expiresAt) <= Date.now()) return { failure: "expired" as const };
    if (!data.sentAt) return { failure: "unavailable" as const };
    const limitSnapshot = await transaction.get(database.doc(`traineeOtpLimits/phone-${hash(text(data.phone))}`));
    if (limitSnapshot.data()?.activeChallengeId !== challengeId) return { failure: "expired" as const };
    const attempts = Number(data.attempts) || 0;
    if (attempts >= MAX_ATTEMPTS) return { failure: "locked" as const };
    const expected = codeHash(key, challengeId, text(data.phone), text(data.nationalId), code);
    const stored = text(data.codeHash);
    if (!/^[a-f0-9]{64}$/.test(stored) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(stored, "hex"))) {
      transaction.update(reference, { attempts: attempts + 1 });
      return { failure: attempts + 1 >= MAX_ATTEMPTS ? "locked" as const : "invalid" as const };
    }
    transaction.update(reference, { usedAt: FieldValue.serverTimestamp(), attempts: attempts + 1 });
    return { nationalId: text(data.nationalId), mobile: text(data.mobile), phone: text(data.phone), traineeDocumentId: text(data.traineeDocumentId) };
  });
  if ("failure" in result) {
    if (result.failure === "expired") throw new HttpsError("deadline-exceeded", "انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا.");
    if (result.failure === "locked") throw new HttpsError("resource-exhausted", "تم تجاوز محاولات إدخال الرمز. اطلب رمزًا جديدًا.", { restartVerification: true });
    if (result.failure === "unavailable") throw new HttpsError("unavailable", "لم يكتمل إرسال الرمز. اطلب رمزًا جديدًا.");
    throw new HttpsError("invalid-argument", "رمز التحقق غير صحيح.");
  }
  const traineeSnapshot = await database.doc(`trainees/${result.traineeDocumentId}`).get();
  const trainee = traineeSnapshot.data() ?? {};
  if (!traineeSnapshot.exists || text(trainee.nationalId) !== result.nationalId || normalizeMobile(trainee.mobile) !== result.mobile) rejectMismatch();
  if (trainee.disabled === true) throw new HttpsError("permission-denied", "الحساب معطّل. تواصل مع إدارة المعهد.");
  const name = text(trainee.nameAr) || text(trainee.nameEn) || "متدرب";
  const auth = getAuth();
  let user = await existingPhoneUser(result.phone);
  if (!user) {
    try {
      user = await auth.createUser({ phoneNumber: result.phone, displayName: name });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "auth/phone-number-already-exists") throw error;
      user = await auth.getUserByPhoneNumber(result.phone);
    }
  }
  const userReference = database.doc(`users/${user.uid}`);
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userReference);
    checkTraineeAccount(user, snapshot.data() ?? {}, result.traineeDocumentId);
    transaction.set(userReference, {
      name, role: "trainee", disabled: false,
      phoneNumber: result.mobile, nationalId: result.nationalId,
      traineeDocumentId: result.traineeDocumentId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  const customToken = await auth.createCustomToken(user.uid);
  return { customToken, profile: { uid: user.uid, name, nationalId: result.nationalId, phoneNumber: result.mobile, traineeDocumentId: result.traineeDocumentId } };
}

function safeHandler(handler: (request: CallableRequest) => Promise<unknown>) {
  return async (request: CallableRequest) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      console.error("Trainee OTP service failed", { code });
      throw new HttpsError("internal", "تعذر إكمال تسجيل الدخول حاليًا. تواصل مع إدارة المعهد.");
    }
  };
}

export const sendTraineeOtp = onCall(options, safeHandler(sendCode));
export const verifyTraineeOtp = onCall(options, safeHandler(verifyCode));
