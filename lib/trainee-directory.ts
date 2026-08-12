import type {
  DatabaseCertificate,
  DatabaseCertificateFile,
  DatabaseTrainee,
} from "./admin-database";
import { getFirebaseAuth, getFirebaseFirestore } from "./firebase";

const PAGE_SIZE = 50;
const IN_QUERY_LIMIT = 30;

type RawDocument = Record<string, unknown> & { id: string };

export type TraineeDirectoryPage = {
  trainees: DatabaseTrainee[];
  certificates: DatabaseCertificate[];
  nextCursor: string;
  hasNext: boolean;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const result = value.toDate();
    return result instanceof Date && !Number.isNaN(result.getTime()) ? result : null;
  }
  if (typeof value === "string" && value) {
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? null : result;
  }
  return null;
}

function timestamp(value: unknown) {
  return dateValue(value)?.getTime() ?? 0;
}

function formatDate(value: unknown) {
  const date = dateValue(value);
  if (!date) return "غير محدد";
  return new Intl.DateTimeFormat("ar-SA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateInput(value: unknown) {
  const date = dateValue(value);
  if (!date) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function certificateFiles(certificate: RawDocument): DatabaseCertificateFile[] {
  const storedFiles = object(certificate.files);
  const definitions: Array<{ type: DatabaseCertificateFile["type"]; label: string }> = [
    { type: "local", label: "الشهادة المحلية" },
    { type: "international", label: "الشهادة الدولية" },
    { type: "card", label: "البطاقة الدولية" },
  ];

  return definitions.flatMap<DatabaseCertificateFile>(({ type, label }) => {
    const storedFile = object(storedFiles[type]);
    const legacyStoragePath = type === "local" ? text(certificate.storagePath) : "";
    const legacyDownloadUrl = type === "local"
      ? text(certificate.downloadUrl) || text(certificate.fileUrl) || text(certificate.pdfUrl)
      : "";
    const storagePath = text(storedFile.storagePath) || legacyStoragePath;
    const downloadUrl = text(storedFile.downloadUrl) || legacyDownloadUrl;
    if (!storagePath && !downloadUrl) return [];
    return [{
      type,
      label,
      storagePath,
      downloadUrl,
      originalFileName: text(storedFile.originalFileName),
    }];
  });
}

export async function loadTraineeDirectoryPage({
  cursor = "",
  nationalId = "",
}: {
  cursor?: string;
  nationalId?: string;
} = {}): Promise<TraineeDirectoryPage> {
  const {
    collection,
    documentId,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
  } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();

  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول لقراءة بيانات المتدربين.");

  const traineeCollection = collection(database, "trainees");
  const normalizedNationalId = nationalId.trim();
  const traineeQuery = normalizedNationalId
    ? query(traineeCollection, where("nationalId", "==", normalizedNationalId), limit(2))
    : cursor
      ? query(traineeCollection, orderBy(documentId()), startAfter(cursor), limit(PAGE_SIZE + 1))
      : query(traineeCollection, orderBy(documentId()), limit(PAGE_SIZE + 1));
  const traineeSnapshot = await getDocs(traineeQuery);
  const hasNext = !normalizedNationalId && traineeSnapshot.docs.length > PAGE_SIZE;
  const traineeDocuments = traineeSnapshot.docs.slice(0, PAGE_SIZE);
  const traineeIds = traineeDocuments.map((document) => document.id);

  const certificateSnapshots = traineeIds.length
    ? await Promise.all(chunks(traineeIds, IN_QUERY_LIMIT).map((ids) => getDocs(query(
      collection(database, "certificates"),
      where("traineeDocumentId", "in", ids),
    ))))
    : [];
  const rawCertificates: RawDocument[] = certificateSnapshots.flatMap((snapshot) =>
    snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  );
  const courseIds = [...new Set(rawCertificates.map((certificate) => text(certificate.courseDocumentId)).filter(Boolean))];
  const courseSnapshots = courseIds.length
    ? await Promise.all(chunks(courseIds, IN_QUERY_LIMIT).map((ids) => getDocs(query(
      collection(database, "courses"),
      where(documentId(), "in", ids),
    ))))
    : [];
  const coursesById = new Map<string, RawDocument>(courseSnapshots.flatMap((snapshot) =>
    snapshot.docs.map((document) => [document.id, { id: document.id, ...document.data() }] as const),
  ));
  const traineesById = new Map<string, RawDocument>(traineeDocuments.map((document) => [
    document.id,
    { id: document.id, ...document.data() },
  ]));
  const certificatesByTrainee = new Map<string, RawDocument[]>();
  rawCertificates.forEach((certificate) => {
    const traineeId = text(certificate.traineeDocumentId);
    if (!traineeId) return;
    const current = certificatesByTrainee.get(traineeId) ?? [];
    current.push(certificate);
    certificatesByTrainee.set(traineeId, current);
  });

  const trainees = traineeDocuments.map<DatabaseTrainee>((document) => {
    const trainee = traineesById.get(document.id) ?? { id: document.id };
    const relatedCertificates = certificatesByTrainee.get(document.id) ?? [];
    const relatedCourses = [...new Set(relatedCertificates.map((certificate) => text(certificate.courseDocumentId)).filter(Boolean))]
      .map((courseId) => {
        const course = coursesById.get(courseId);
        return course ? text(course.nameAr) || text(course.nameEn) || courseId : courseId;
      });
    return {
      id: document.id,
      name: text(trainee.nameAr) || text(trainee.nameEn) || "متدرب دون اسم",
      nameAr: text(trainee.nameAr),
      nameEn: text(trainee.nameEn),
      nationalId: text(trainee.nationalId) || "غير متاح",
      mobile: text(trainee.mobile),
      traineeId: text(trainee.traineeId),
      nationality: text(trainee.nationalityAr) || text(trainee.nationality) || "غير محددة",
      gender: text(trainee.gender) || "غير محدد",
      dateOfBirth: formatDate(trainee.dateOfBirth),
      dateOfBirthValue: formatDateInput(trainee.dateOfBirth),
      courses: relatedCourses,
      certificates: relatedCertificates.length,
      state: relatedCertificates.length ? "مكتمل" : "لا توجد شهادات",
      updatedAt: timestamp(trainee.updatedAt),
      companyDocumentId: text(trainee.companyDocumentId),
    };
  });

  const certificates = rawCertificates.map<DatabaseCertificate>((certificate) => {
    const trainee = traineesById.get(text(certificate.traineeDocumentId));
    const course = coursesById.get(text(certificate.courseDocumentId));
    const files = certificateFiles(certificate);
    return {
      id: certificate.id,
      traineeDocumentId: text(certificate.traineeDocumentId),
      courseDocumentId: text(certificate.courseDocumentId),
      number: text(certificate.certificateNumber) || certificate.id,
      owner: trainee ? text(trainee.nameAr) || text(trainee.nameEn) : "متدرب غير معروف",
      ownerEn: trainee ? text(trainee.nameEn).replace(/^:\s*/, "") : "",
      course: course ? text(course.nameAr) || text(course.nameEn) : "دورة غير معروفة",
      issueDate: formatDate(certificate.issueDate),
      status: files.length ? "متاحة للتنزيل" : "بانتظار ملف PDF",
      files,
      updatedAt: timestamp(certificate.updatedAt),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.number.localeCompare(b.number));

  return {
    trainees,
    certificates,
    nextCursor: traineeDocuments.at(-1)?.id ?? "",
    hasNext,
  };
}

export function getTraineeDirectoryError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("permission-denied")) return "لا يملك الحساب صلاحية قراءة بيانات المتدربين.";
  if (code.includes("unavailable")) return "تعذر الاتصال بقاعدة البيانات. تحقق من الإنترنت وحاول مجددًا.";
  if (code.includes("failed-precondition")) return "يلزم إنشاء فهرس Firestore لهذا البحث.";
  return error instanceof Error ? error.message : "تعذر تحميل بيانات المتدربين.";
}
