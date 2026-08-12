import { getFirebaseFunctions } from "./firebase";

export async function refreshDashboardStats() {
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const callable = httpsCallable<Record<string, never>, { success: true }>(functions, "refreshDashboardStats");
  return (await callable({})).data;
}

export function getDashboardStatsError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("permission-denied")) return "لا تملك صلاحية تحديث إحصائيات المنصة.";
  if (code.includes("unavailable") || code.includes("internal") || code.includes("not-found")) {
    return "تعذر تحديث إحصائيات الصفحة الرئيسية حالياً.";
  }
  return error instanceof Error ? error.message.replace(/^Firebase:\s*/i, "") : "تعذر تحديث الإحصائيات.";
}
