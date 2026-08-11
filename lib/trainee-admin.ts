import { getFirebaseFunctions } from "./firebase";

export type UpdateTraineeInput = {
  traineeDocumentId: string;
  nameAr: string;
  nameEn: string;
  nationalId: string;
  mobile: string;
  traineeId: string;
  nationality: string;
  gender: string;
  dateOfBirth: string;
};

export async function updateTraineeDetails(input: UpdateTraineeInput) {
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const callable = httpsCallable<UpdateTraineeInput, { traineeDocumentId: string }>(functions, "updateTraineeDetails");
  return (await callable(input)).data;
}

export function getTraineeAdminError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message.replace(/^Firebase:\s*/i, "") : "";
  if (code.includes("already-exists")) return message || "رقم الهوية أو المعرّف مستخدم لمتدرب آخر.";
  if (code.includes("permission-denied")) return message || "لا تملك صلاحية تعديل بيانات المتدربين.";
  if (code.includes("invalid-argument")) return message || "تحقق من البيانات المدخلة.";
  if (code.includes("not-found")) return "لم يعد سجل المتدرب موجودًا.";
  if (code.includes("unavailable") || code.includes("internal")) return "خدمة تعديل بيانات المتدربين غير متاحة حالياً.";
  return message || "تعذر حفظ بيانات المتدرب حالياً.";
}
