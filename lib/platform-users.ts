import { getFirebaseFunctions } from "./firebase";

export type PlatformUserRole = "trainee" | "company_admin" | "admin" | "super_admin";

export type PlatformUser = {
  uid: string;
  name: string;
  email: string;
  role: PlatformUserRole;
  disabled: boolean;
  createdAt: string;
  lastSignInAt: string;
  companyDocumentId?: string;
};

async function callFunction<RequestData, ResponseData>(
  name: string,
  data?: RequestData,
) {
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const callable = httpsCallable<RequestData, ResponseData>(functions, name);
  return (await callable(data as RequestData)).data;
}

export function listPlatformUsers() {
  return callFunction<Record<string, never>, { users: PlatformUser[] }>(
    "listPlatformUsers",
    {},
  );
}

export function createPlatformUser(input: {
  name: string;
  email: string;
  password: string;
  role: PlatformUserRole;
}) {
  return callFunction<typeof input, { user: PlatformUser }>("createPlatformUser", input);
}

export function setPlatformUserDisabled(uid: string, disabled: boolean) {
  return callFunction<{ uid: string; disabled: boolean }, { success: true }>(
    "setPlatformUserDisabled",
    { uid, disabled },
  );
}

export function setPlatformUserRole(uid: string, role: PlatformUserRole) {
  return callFunction<{ uid: string; role: PlatformUserRole }, { success: true }>(
    "setPlatformUserRole",
    { uid, role },
  );
}

export function deletePlatformUser(uid: string) {
  return callFunction<{ uid: string }, { success: true }>("deletePlatformUser", { uid });
}

export function getPlatformUsersError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message).replace(/^Firebase:\s*/i, "")
      : "";

  switch (code) {
    case "functions/unauthenticated":
      return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";
    case "functions/permission-denied":
      return message || "ليست لديك الصلاحية لتنفيذ هذه العملية.";
    case "functions/already-exists":
      return "يوجد حساب مسجل بهذا البريد الإلكتروني مسبقاً.";
    case "functions/invalid-argument":
      return message || "تحقق من البيانات المدخلة.";
    case "functions/not-found":
      return "لم يعد المستخدم موجوداً.";
    case "functions/unavailable":
    case "functions/internal":
      return "خدمة إدارة المستخدمين غير متاحة حالياً. تحقق من نشر Cloud Functions.";
    default:
      return message || "تعذر تنفيذ العملية حالياً.";
  }
}
