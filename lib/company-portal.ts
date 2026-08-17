import type { DatabaseCertificateFile } from "./admin-database";
import { getFirebaseAuth, getFirebaseFirestore } from "./firebase";
import type { CompanyProfile } from "./platform-session";

type RawDocument = Record<string, unknown> & { id: string };

export type CompanyPortalCertificate = {
  id: string;
  number: string;
  course: string;
  issueDate: string;
  files: DatabaseCertificateFile[];
};

export type CompanyPortalEmployee = {
  id: string;
  name: string;
  nameEn: string;
  nationalId: string;
  mobile: string;
  courses: string[];
  certificates: CompanyPortalCertificate[];
};

export type CompanyPortalData = {
  companyName: string;
  crNumber: string;
  employees: CompanyPortalEmployee[];
  totalCourses: number;
  totalCertificates: number;
  availableFiles: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const result = value.toDate();
    return result instanceof Date ? result : null;
  }
  return null;
}

function formatDate(value: unknown) {
  const valueDate = dateValue(value);
  return valueDate
    ? new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" }).format(valueDate)
    : "غير محدد";
}

function certificateFiles(certificate: Record<string, unknown>): DatabaseCertificateFile[] {
  const storedFiles = object(certificate.files);
  const definitions: Array<{ type: DatabaseCertificateFile["type"]; label: string }> = [
    { type: "local", label: "الشهادة المحلية" },
    { type: "international", label: "الشهادة الدولية" },
    { type: "card", label: "البطاقة الدولية" },
  ];
  return definitions.flatMap<DatabaseCertificateFile>(({ type, label }) => {
    const storedFile = object(storedFiles[type]);
    const legacyStoragePath = type === "local" ? text(certificate.storagePath) : "";
    const legacyDownloadUrl = type === "local" ? text(certificate.downloadUrl) || text(certificate.fileUrl) || text(certificate.pdfUrl) : "";
    const storagePath = text(storedFile.storagePath) || legacyStoragePath;
    const downloadUrl = text(storedFile.downloadUrl) || legacyDownloadUrl;
    if (!storagePath && !downloadUrl) return [];
    return [{ type, label, storagePath, downloadUrl, originalFileName: text(storedFile.originalFileName) }];
  });
}

export async function loadCompanyPortal(profile: CompanyProfile): Promise<CompanyPortalData> {
  const { collection, doc, getDoc, getDocs, query, where } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  if (!auth.currentUser || auth.currentUser.uid !== profile.uid) throw new Error("انتهت جلسة الشركة. سجّل الدخول مرة أخرى.");
  // Refresh custom claims before Storage checks the company/certificate relationship.
  await auth.currentUser.getIdToken(true);

  const [companySnapshot, traineeSnapshot, certificateSnapshot] = await Promise.all([
    getDoc(doc(database, "companies", profile.companyDocumentId)),
    getDocs(query(collection(database, "trainees"), where("companyDocumentId", "==", profile.companyDocumentId))),
    getDocs(query(collection(database, "certificates"), where("companyDocumentId", "==", profile.companyDocumentId))),
  ]);
  if (!companySnapshot.exists()) throw new Error("لم يعد سجل الشركة موجودًا.");
  const company = companySnapshot.data();
  if (text(company.status) === "disabled") throw new Error("حساب الشركة معطّل.");

  const trainees: RawDocument[] = traineeSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const certificates: RawDocument[] = certificateSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const courseIds = [...new Set(certificates.map((item) => text(item.courseDocumentId)).filter(Boolean))];
  const courseSnapshots = await Promise.all(courseIds.map((id) => getDoc(doc(database, "courses", id))));
  const courses = new Map(courseSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data()]));
  const certificatesByTrainee = new Map<string, CompanyPortalCertificate[]>();

  certificates.forEach((certificate) => {
    const traineeId = text(certificate.traineeDocumentId);
    if (!traineeId) return;
    const course = object(courses.get(text(certificate.courseDocumentId)));
    const item: CompanyPortalCertificate = {
      id: certificate.id,
      number: text(certificate.certificateNumber) || certificate.id,
      course: text(course.nameAr) || text(course.nameEn) || "دورة تدريبية",
      issueDate: formatDate(certificate.issueDate),
      files: certificateFiles(certificate),
    };
    certificatesByTrainee.set(traineeId, [...(certificatesByTrainee.get(traineeId) ?? []), item]);
  });

  const employees = trainees.map<CompanyPortalEmployee>((trainee) => {
    const employeeCertificates = certificatesByTrainee.get(trainee.id) ?? [];
    return {
      id: trainee.id,
      name: text(trainee.nameAr) || text(trainee.nameEn) || "موظف دون اسم",
      nameEn: text(trainee.nameEn),
      nationalId: text(trainee.nationalId),
      mobile: text(trainee.mobile),
      courses: [...new Set(employeeCertificates.map((certificate) => certificate.course))],
      certificates: employeeCertificates,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return {
    companyName: text(company.name) || profile.companyName,
    crNumber: text(company.crNumber) || profile.crNumber,
    employees,
    totalCourses: courseIds.length,
    totalCertificates: certificates.length,
    availableFiles: certificates.reduce((total, certificate) => total + certificateFiles(certificate).length, 0),
  };
}

export function getCompanyPortalError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("permission-denied")) return "لا يملك حساب الشركة صلاحية قراءة هذه البيانات.";
  if (code.includes("unavailable")) return "تعذر الاتصال بقاعدة البيانات. حاول مجددًا.";
  return error instanceof Error ? error.message : "تعذر تحميل بيانات الشركة.";
}
