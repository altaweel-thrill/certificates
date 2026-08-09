import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";
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

let recaptchaVerifier: RecaptchaVerifier | null = null;
let recaptchaContainer: HTMLElement | null = null;

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

function toInternationalMobile(value: string) {
  const local = normalizeSaudiMobile(value);
  return local ? `+966${local.slice(1)}` : "";
}

export async function sendTraineeVerificationCode(mobile: string): Promise<ConfirmationResult> {
  const internationalMobile = toInternationalMobile(mobile);
  if (!internationalMobile) throw new Error("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");

  const { RecaptchaVerifier, signInWithPhoneNumber } = await import("firebase/auth");
  const auth = await getFirebaseAuth();
  auth.languageCode = "ar";
  const isLocalDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  auth.settings.appVerificationDisabledForTesting = isLocalDevelopment;
  const container = document.getElementById("trainee-recaptcha");
  if (!container) throw new Error("تعذر تهيئة التحقق الأمني. حدّث الصفحة وحاول مرة أخرى.");

  if (recaptchaVerifier && recaptchaContainer !== container) destroyTraineeRecaptcha();
  if (!recaptchaVerifier) {
    recaptchaContainer = container;
    recaptchaVerifier = new RecaptchaVerifier(auth, container, { size: isLocalDevelopment ? "invisible" : "normal" });
    await recaptchaVerifier.render();
  }
  return signInWithPhoneNumber(auth, internationalMobile, recaptchaVerifier);
}

export function resetTraineeRecaptcha() {
  if (!recaptchaVerifier) return;
  void recaptchaVerifier.render()
    .then((widgetId) => {
      const captchaApi = (window as typeof window & { grecaptcha?: { reset: (id?: number) => void } }).grecaptcha;
      captchaApi?.reset(widgetId);
    })
    .catch(() => destroyTraineeRecaptcha());
}

export function destroyTraineeRecaptcha() {
  try {
    recaptchaVerifier?.clear();
  } catch {
    // Firebase may already have released a failed verifier.
  }
  recaptchaVerifier = null;
  recaptchaContainer?.replaceChildren();
  recaptchaContainer = null;
}

export async function activateTraineeSession(confirmation: ConfirmationResult, code: string, nationalId: string): Promise<TraineeProfile> {
  const identity = nationalId.trim();
  if (!identity) throw new Error("أدخل رقم الهوية أو المعرّف المسجل.");
  if (!/^\d{6}$/.test(digits(code))) throw new Error("رمز التحقق يجب أن يتكون من 6 أرقام.");

  await confirmation.confirm(digits(code));
  const { signOut } = await import("firebase/auth");
  const { httpsCallable } = await import("firebase/functions");
  const auth = await getFirebaseAuth();
  const functions = await getFirebaseFunctions();
  const activate = httpsCallable<{ nationalId: string }, { profile: TraineeProfile }>(functions, "activateTraineeSession");
  try {
    return (await activate({ nationalId: identity })).data.profile;
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
  const isLocalDevelopment = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (code.includes("invalid-verification-code")) return "رمز التحقق غير صحيح.";
  if (code.includes("code-expired")) return "انتهت صلاحية رمز التحقق. أرسل رمزًا جديدًا.";
  if (code.includes("invalid-phone-number")) return "رقم الجوال غير صحيح.";
  if (code.includes("too-many-requests")) return "تم تجاوز عدد المحاولات المسموح. حاول لاحقًا.";
  if (code.includes("unauthorized-domain") || code.includes("app-not-authorized")) return "نطاق الموقع غير مضاف ضمن Authorized domains في Firebase Authentication.";
  if (code.includes("operation-not-allowed")) return "تسجيل الدخول برقم الجوال غير مفعّل في Firebase Authentication.";
  if (code.includes("captcha-check-failed") || code.includes("invalid-app-credential")) {
    return isLocalDevelopment
      ? "وضع localhost يقبل فقط رقم اختبار مضافًا في Firebase Phone numbers for testing؛ لا تستخدم رقم جوال حقيقي هنا."
      : "تعذر اعتماد reCAPTCHA. تحقق من إضافة نطاق الموقع إلى Authorized domains ثم أعد المحاولة.";
  }
  if (code.includes("functions/internal") || code.includes("functions/unavailable") || code.includes("functions/unimplemented")) {
    return "خدمة دخول المتدربين غير متاحة حالياً. يجب على مسؤول النظام نشر تحديث Cloud Functions ثم المحاولة مرة أخرى.";
  }
  if (code.includes("permission-denied") || code.includes("not-found")) return "رقم الهوية لا يطابق رقم الجوال المسجل لدى المعهد.";
  return error instanceof Error ? error.message : "تعذر تسجيل دخول المتدرب.";
}
