import type { DatabaseCertificateFile } from "./admin-database";
import { getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions } from "./firebase";
import type { TraineeProfile } from "./platform-session";

export type TraineePortalCertificate = {
  id: string;
  number: string;
  issueDate: string;
  files: DatabaseCertificateFile[];
};

export type TraineePortalCourse = {
  id: string;
  code: string;
  name: string;
  date: string;
  hours: number;
  certificates: TraineePortalCertificate[];
};

export type TraineePortalData = {
  traineeName: string;
  traineeNameEn: string;
  nationalId: string;
  courses: TraineePortalCourse[];
  totalHours: number;
  availableFiles: number;
};

export type TraineeVerificationChallenge = {
  challengeId: string;
  expiresAt: number;
  resendAfterSeconds: number;
  resendAvailableAt: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatDate(value: unknown) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" }).format(date) : "غير محدد";
}

function formatCourseDate(start: unknown, end: unknown) {
  const startDate = dateValue(start);
  const endDate = dateValue(end);
  if (startDate && endDate) return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  return formatDate(startDate ?? endDate);
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeSaudiMobile(value: string) {
  const valueDigits = digits(value);
  if (/^05\d{8}$/.test(valueDigits)) return valueDigits;
  if (/^5\d{8}$/.test(valueDigits)) return `0${valueDigits}`;
  if (/^9665\d{8}$/.test(valueDigits)) return `0${valueDigits.slice(3)}`;
  return "";
}

export async function sendTraineeVerificationCode(mobile: string, nationalId: string): Promise<TraineeVerificationChallenge> {
  const localMobile = normalizeSaudiMobile(mobile);
  if (!localMobile) throw new Error("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
  const identity = nationalId.trim();
  if (!identity) throw new Error("أدخل رقم الهوية أو المعرّف المسجل.");
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const send = httpsCallable<{ mobile: string; nationalId: string }, Omit<TraineeVerificationChallenge, "resendAvailableAt">>(functions, "sendTraineeOtp");
  const { data } = await send({ mobile: localMobile, nationalId: identity });
  return { ...data, resendAvailableAt: Date.now() + data.resendAfterSeconds * 1000 };
}

export async function activateTraineeSession(confirmation: TraineeVerificationChallenge, code: string): Promise<TraineeProfile> {
  if (!/^\d{6}$/.test(digits(code))) throw new Error("رمز التحقق يجب أن يتكون من 6 أرقام.");
  const { signInWithCustomToken, signOut } = await import("firebase/auth");
  const { httpsCallable } = await import("firebase/functions");
  const auth = await getFirebaseAuth();
  const functions = await getFirebaseFunctions();
  const verify = httpsCallable<{ challengeId: string; code: string }, { customToken: string; profile: TraineeProfile }>(functions, "verifyTraineeOtp");
  const { data } = await verify({ challengeId: confirmation.challengeId, code: digits(code) });
  try {
    const credential = await signInWithCustomToken(auth, data.customToken);
    if (credential.user.uid !== data.profile.uid) throw new Error("تعذر اعتماد جلسة المتدرب.");
    return data.profile;
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function loadTraineePortal(profile: TraineeProfile): Promise<TraineePortalData> {
  const { collection, doc, getDoc, getDocs, query, where } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  if (!auth.currentUser || auth.currentUser.uid !== profile.uid) throw new Error("انتهت جلسة المتدرب. سجّل الدخول مرة أخرى.");

  const [traineeSnapshot, certificateSnapshot] = await Promise.all([
    getDoc(doc(database, "trainees", profile.traineeDocumentId)),
    getDocs(query(collection(database, "certificates"), where("traineeDocumentId", "==", profile.traineeDocumentId))),
  ]);
  if (!traineeSnapshot.exists()) throw new Error("لم يعد سجل المتدرب موجودًا.");

  const traineeData = traineeSnapshot.data();
  const rawCertificates: Array<Record<string, unknown> & { id: string }> = certificateSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const courseIds = [...new Set(rawCertificates.map((item) => text(item.courseDocumentId)).filter(Boolean))];
  const courseSnapshots = await Promise.all(courseIds.map((courseId) => getDoc(doc(database, "courses", courseId))));
  const coursesById = new Map(courseSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data()]));
  const grouped = new Map<string, TraineePortalCourse>();

  rawCertificates.forEach((certificate) => {
    const courseId = text(certificate.courseDocumentId) || "unknown";
    const course = object(coursesById.get(courseId));
    if (!grouped.has(courseId)) {
      grouped.set(courseId, {
        id: courseId,
        code: [text(course.shortCourseCode), text(course.subCourseCode)].filter(Boolean).join("-") || courseId,
        name: text(course.nameAr) || text(course.nameEn) || "دورة تدريبية",
        date: formatCourseDate(course.startingDate, course.endingDate),
        hours: number(course.hours),
        certificates: [],
      });
    }

    const storedFiles = object(certificate.files);
    const definitions: Array<{ type: DatabaseCertificateFile["type"]; label: string }> = [
      { type: "local", label: "الشهادة المحلية" },
      { type: "international", label: "الشهادة الدولية" },
      { type: "card", label: "البطاقة الدولية" },
    ];
    const files = definitions.flatMap<DatabaseCertificateFile>(({ type, label }) => {
      const storedFile = object(storedFiles[type]);
      const legacyStoragePath = type === "local" ? text(certificate.storagePath) : "";
      const legacyDownloadUrl = type === "local" ? text(certificate.downloadUrl) || text(certificate.fileUrl) || text(certificate.pdfUrl) : "";
      const storagePath = text(storedFile.storagePath) || legacyStoragePath;
      const downloadUrl = text(storedFile.downloadUrl) || legacyDownloadUrl;
      if (!storagePath && !downloadUrl) return [];
      return [{ type, label, storagePath, downloadUrl, originalFileName: text(storedFile.originalFileName) }];
    });

    grouped.get(courseId)?.certificates.push({
      id: certificate.id,
      number: text(certificate.certificateNumber) || certificate.id,
      issueDate: formatDate(certificate.issueDate),
      files,
    });
  });

  const courses = [...grouped.values()];
  return {
    traineeName: text(traineeData.nameAr) || text(traineeData.nameEn) || profile.name,
    traineeNameEn: text(traineeData.nameEn).replace(/^:\s*/, ""),
    nationalId: text(traineeData.nationalId) || profile.nationalId,
    courses,
    totalHours: courses.reduce((total, course) => total + course.hours, 0),
    availableFiles: courses.reduce((total, course) => total + course.certificates.reduce((count, certificate) => count + certificate.files.length, 0), 0),
  };
}

export function getTraineeAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code.startsWith("functions/") && !code.includes("internal") && message) return message;
  if (code.includes("invalid-custom-token") || code.includes("custom-token-mismatch")) return "تعذر اعتماد جلسة الدخول. تواصل مع إدارة المعهد.";
  if (code.includes("user-disabled")) return "الحساب معطّل. تواصل مع إدارة المعهد.";
  if (code.includes("network-request-failed")) return "تعذر الاتصال. تحقق من اتصال الإنترنت وحاول مرة أخرى.";
  if (code.includes("functions/internal")) return "خدمة دخول المتدربين غير متاحة حاليًا. تواصل مع إدارة المعهد.";
  return message || "تعذر تسجيل دخول المتدرب.";
}
