import type { DatabaseCompany } from "./admin-database";
import { getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions } from "./firebase";

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function companyDocumentId(crNumber: string) {
  return `cr-${digits(crNumber)}`;
}

export async function saveCompany(input: {
  name: string;
  crNumber: string;
  contactEmail?: string;
  contactPhone?: string;
}) {
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  const name = input.name.trim();
  const crNumber = digits(input.crNumber);
  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول.");
  if (!name) throw new Error("اسم الشركة مطلوب.");
  if (!crNumber) throw new Error("رقم السجل التجاري مطلوب.");

  const id = companyDocumentId(crNumber);
  await setDoc(doc(database, "companies", id), {
    name,
    crNumber,
    contactEmail: input.contactEmail?.trim().toLowerCase() || "",
    contactPhone: digits(input.contactPhone || ""),
    status: "active",
    updatedBy: auth.currentUser.uid,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });

  return { id, name, crNumber };
}

export async function createCompanyAccount(input: {
  companyDocumentId: string;
  name: string;
  email: string;
  password: string;
}) {
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const callable = httpsCallable<typeof input, { account: { uid: string; email: string; name: string } }>(functions, "createCompanyAccount");
  return (await callable(input)).data;
}

export async function updateCompanyDetails(companyId: string, input: {
  name: string;
  contactEmail?: string;
  contactPhone?: string;
}) {
  const { doc, serverTimestamp, updateDoc } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  const name = input.name.trim();
  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول.");
  if (!companyId || !name) throw new Error("اسم الشركة مطلوب.");
  await updateDoc(doc(database, "companies", companyId), {
    name,
    contactEmail: input.contactEmail?.trim().toLowerCase() || "",
    contactPhone: digits(input.contactPhone || ""),
    updatedBy: auth.currentUser.uid,
    updatedAt: serverTimestamp(),
  });
}

export async function updateCompanyAccount(input: {
  companyDocumentId: string;
  uid: string;
  name: string;
  email: string;
  password?: string;
}) {
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const callable = httpsCallable<typeof input, { account: { uid: string; email: string; name: string } }>(functions, "updateCompanyAccount");
  return (await callable(input)).data;
}

export async function setCompanyDisabled(company: DatabaseCompany, disabled: boolean) {
  const { doc, serverTimestamp, updateDoc } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول.");
  await updateDoc(doc(database, "companies", company.id), {
    status: disabled ? "disabled" : "active",
    updatedBy: auth.currentUser.uid,
    updatedAt: serverTimestamp(),
  });
}

export function getCompanyAdminError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message.replace(/^Firebase:\s*/i, "") : "";
  if (code.includes("already-exists")) return "يوجد حساب بهذا البريد الإلكتروني مسبقًا.";
  if (code.includes("permission-denied")) return message || "لا تملك صلاحية إدارة الشركات.";
  if (code.includes("invalid-argument")) return message || "تحقق من البيانات المدخلة.";
  if (code.includes("not-found")) return "لم يعد سجل الشركة موجودًا.";
  if (code.includes("unavailable") || code.includes("internal")) return "خدمة حسابات الشركات غير متاحة. تحقق من نشر Cloud Functions.";
  return message || "تعذر إكمال العملية حالياً.";
}
