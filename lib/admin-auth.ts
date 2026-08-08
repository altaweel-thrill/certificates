import type { Unsubscribe, User } from "firebase/auth";
import { getFirebaseAuth, getFirebaseFirestore } from "./firebase";

const ADMIN_ACCESS_REQUIRED = "admin/access-required";

export type AdminProfile = {
  uid: string;
  name: string;
  email: string;
  role: "admin" | "super_admin";
};

function getName(data: Record<string, unknown>, user: User) {
  const candidates = [
    data.name,
    data.fullName,
    data.displayName,
    data.username,
    user.displayName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return user.email?.split("@")[0] || "مسؤول المنصة";
}

async function getAdminProfile(user: User): Promise<AdminProfile | null> {
  const token = await user.getIdTokenResult(true);
  const tokenRole = token.claims.role;
  let data: Record<string, unknown> = {};

  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const db = await getFirebaseFirestore();
    const userDocument = await getDoc(doc(db, "users", user.uid));
    data = userDocument.data() ?? {};
  } catch {
    data = {};
  }

  const documentRole = data.role;
  if (data.disabled === true) return null;

  const hasStoredRole =
    documentRole === "trainee" ||
    documentRole === "admin" ||
    documentRole === "super_admin";
  const isAdmin = hasStoredRole
    ? documentRole === "admin" || documentRole === "super_admin"
    : token.claims.admin === true || tokenRole === "admin" || tokenRole === "super_admin";

  if (!isAdmin) return null;

  return {
    uid: user.uid,
    name: getName(data, user),
    email: user.email || (typeof data.email === "string" ? data.email : ""),
    role:
      tokenRole === "super_admin" || documentRole === "super_admin"
        ? "super_admin"
        : "admin",
  };
}

export async function signInAdmin(email: string, password: string) {
  const { signInWithEmailAndPassword, signOut } = await import("firebase/auth");
  const auth = await getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);

  const profile = await getAdminProfile(credential.user);

  if (!profile) {
    await signOut(auth);
    const error = new Error("Admin access is required") as Error & { code: string };
    error.code = ADMIN_ACCESS_REQUIRED;
    throw error;
  }

  return profile;
}

export async function signOutAdmin() {
  const { signOut } = await import("firebase/auth");
  const auth = await getFirebaseAuth();
  await signOut(auth);
}

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import("firebase/auth");
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;

  if (!user?.email) {
    const error = new Error("Admin session is required") as Error & { code: string };
    error.code = "auth/user-not-found";
    throw error;
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export async function observeAdminSession(
  onChange: (profile: AdminProfile | null) => void,
): Promise<Unsubscribe> {
  const { onAuthStateChanged, signOut } = await import("firebase/auth");
  const auth = await getFirebaseAuth();

  return onAuthStateChanged(auth, (user) => {
    void (async () => {
      if (!user) {
        onChange(null);
        return;
      }

      const profile = await getAdminProfile(user);
      if (!profile) await signOut(auth);
      onChange(profile);
    })().catch(() => onChange(null));
  });
}

export function getAdminAuthError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case ADMIN_ACCESS_REQUIRED:
      return "الحساب صحيح، لكنه لا يملك صلاحية الدخول إلى الإدارة.";
    case "auth/invalid-email":
      return "صيغة البريد الإلكتروني غير صحيحة.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    case "auth/user-disabled":
      return "تم إيقاف هذا الحساب. تواصل مع مدير النظام.";
    case "auth/too-many-requests":
      return "تم إيقاف محاولات الدخول مؤقتاً. حاول مرة أخرى لاحقاً.";
    case "auth/network-request-failed":
      return "تعذر الاتصال بخدمة Firebase. تحقق من اتصال الإنترنت.";
    default:
      return "تعذر تسجيل الدخول حالياً. حاول مرة أخرى.";
  }
}

export function getAdminPasswordError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "كلمة المرور الحالية غير صحيحة.";
    case "auth/weak-password":
      return "كلمة المرور الجديدة ضعيفة. استخدم 8 أحرف على الأقل.";
    case "auth/requires-recent-login":
      return "انتهت صلاحية التحقق الأمني. سجّل الخروج ثم ادخل من جديد.";
    case "auth/too-many-requests":
      return "تم تجاوز عدد المحاولات المسموح. حاول مرة أخرى لاحقاً.";
    case "auth/network-request-failed":
      return "تعذر الاتصال بالخدمة. تحقق من الإنترنت وحاول مرة أخرى.";
    case "auth/user-not-found":
      return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";
    default:
      return "تعذر تغيير كلمة المرور حالياً. حاول مرة أخرى.";
  }
}
