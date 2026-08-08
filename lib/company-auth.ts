import type { CompanyProfile } from "./platform-session";
import { getFirebaseAuth, getFirebaseFirestore } from "./firebase";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function signInCompany(email: string, password: string): Promise<CompanyProfile> {
  const { signInWithEmailAndPassword, signOut } = await import("firebase/auth");
  const { doc, getDoc } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);

  try {
    const [token, userSnapshot] = await Promise.all([
      credential.user.getIdTokenResult(true),
      getDoc(doc(database, "users", credential.user.uid)),
    ]);
    const data = userSnapshot.data() ?? {};
    const role = text(data.role) || text(token.claims.role);
    const companyDocumentId = text(data.companyDocumentId) || text(token.claims.companyDocumentId);
    if (data.disabled === true || role !== "company_admin" || !companyDocumentId) {
      throw Object.assign(new Error("Company access is required"), { code: "company/access-required" });
    }
    const companySnapshot = await getDoc(doc(database, "companies", companyDocumentId));
    const company = companySnapshot.data() ?? {};
    if (!companySnapshot.exists() || text(company.status) === "disabled") {
      throw Object.assign(new Error("Company is disabled"), { code: "company/disabled" });
    }
    return {
      uid: credential.user.uid,
      name: text(data.name) || credential.user.displayName || "ممثل الشركة",
      email: credential.user.email || text(data.email),
      companyDocumentId,
      companyName: text(company.name) || "حساب الشركة",
      crNumber: text(company.crNumber),
    };
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export function getCompanyAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "company/access-required") return "الحساب صحيح، لكنه غير مرتبط بشركة في المنصة.";
  if (code === "company/disabled" || code === "auth/user-disabled") return "حساب الشركة معطّل. تواصل مع إدارة المعهد.";
  if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(code)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (code === "auth/invalid-email") return "صيغة البريد الإلكتروني غير صحيحة.";
  if (code === "auth/too-many-requests") return "تم تجاوز عدد المحاولات. حاول لاحقًا.";
  if (code === "auth/network-request-failed") return "تعذر الاتصال بالخدمة. تحقق من الإنترنت.";
  return "تعذر تسجيل دخول الشركة حالياً.";
}
