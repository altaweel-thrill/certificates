import { getFirebaseFunctions } from "./firebase";

export type PublicCertificateRecord = {
  number: string;
  traineeNameAr: string;
  traineeNameEn: string;
  courseNameAr: string;
  courseNameEn: string;
  courseCode: string;
  issueDate: number;
  issueDateHijri: string;
  status: "valid" | "revoked";
};

export type CertificateVerificationResult =
  | { verified: false; certificate?: never }
  | { verified: true; certificate: PublicCertificateRecord };

export async function verifyPublicCertificate(certificateNumber: string, nationalId: string) {
  const { httpsCallable } = await import("firebase/functions");
  const functions = await getFirebaseFunctions();
  const callable = httpsCallable<{ certificateNumber: string; nationalId: string }, CertificateVerificationResult>(functions, "verifyCertificate");
  return (await callable({ certificateNumber: certificateNumber.trim(), nationalId: nationalId.trim() })).data;
}

export function getCertificateVerificationError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("invalid-argument")) return "أدخل رقم الشهادة ورقم الهوية بشكل صحيح.";
  if (code.includes("resource-exhausted")) return "تم تجاوز عدد محاولات التحقق. حاول لاحقًا.";
  if (code.includes("unavailable")) return "تعذر الاتصال بخدمة التحقق. حاول مجددًا.";
  return "تعذر التحقق من الشهادة حالياً. حاول مرة أخرى.";
}
