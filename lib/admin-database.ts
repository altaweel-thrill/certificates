import { getFirebaseAuth, getFirebaseFirestore } from "./firebase";

type RawDocument = Record<string, unknown> & { id: string };

export type DatabaseCourse = {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  date: string;
  hours: number;
  trainees: number;
  completion: number;
  status: "نشطة" | "مكتملة" | "مجدولة" | "غير محددة";
  updatedAt: number;
};

export type DatabaseTrainee = {
  id: string;
  name: string;
  nameEn: string;
  nationalId: string;
  mobile: string;
  courses: string[];
  certificates: number;
  state: "مكتمل" | "لا توجد شهادات";
  updatedAt: number;
  companyDocumentId: string;
};

export type DatabaseCertificateFile = {
  type: "local" | "international" | "card";
  label: string;
  storagePath: string;
  downloadUrl: string;
  originalFileName: string;
};

export type DatabaseCertificate = {
  id: string;
  number: string;
  owner: string;
  ownerEn: string;
  course: string;
  issueDate: string;
  status: string;
  files: DatabaseCertificateFile[];
  updatedAt: number;
};

export type DatabaseImport = {
  id: string;
  fileName: string;
  totalRows: number;
  completedRows: number;
  status: "processing" | "completed" | "failed";
  importedByEmail: string;
  createdAt: number;
};

export type DatabaseCompany = {
  id: string;
  name: string;
  crNumber: string;
  contactEmail: string;
  contactPhone: string;
  status: "active" | "disabled";
  employees: number;
  certificates: number;
  accounts: number;
  accountList: DatabaseCompanyAccount[];
  updatedAt: number;
};

export type DatabaseCompanyAccount = {
  uid: string;
  name: string;
  email: string;
  disabled: boolean;
  updatedAt: number;
};

export type AdminDatabaseData = {
  courses: DatabaseCourse[];
  trainees: DatabaseTrainee[];
  certificates: DatabaseCertificate[];
  imports: DatabaseImport[];
  companies: DatabaseCompany[];
  metrics: {
    activeCourses: number;
    totalTrainees: number;
    issuedCertificates: number;
    pendingCertificates: number;
  };
  loadedAt: Date;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function formatCourseDate(startValue: unknown, endValue: unknown) {
  const start = dateValue(startValue);
  const end = dateValue(endValue);
  if (!start && !end) return "التاريخ غير محدد";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end);
}

function courseStatus(startValue: unknown, endValue: unknown): DatabaseCourse["status"] {
  const now = Date.now();
  const start = timestamp(startValue);
  const end = timestamp(endValue);
  if (end && end < now) return "مكتملة";
  if (start && start > now) return "مجدولة";
  if (start || end) return "نشطة";
  return "غير محددة";
}

function normalizeImportStatus(value: unknown): DatabaseImport["status"] {
  const status = text(value);
  if (status === "completed" || status === "failed") return status;
  return "processing";
}

export async function loadAdminDatabaseData(): Promise<AdminDatabaseData> {
  const { collection, getDocs } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();

  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول لقراءة بيانات المنصة.");

  const [courseSnapshot, traineeSnapshot, certificateSnapshot, importSnapshot, companySnapshot, userSnapshot] = await Promise.all([
    getDocs(collection(database, "courses")),
    getDocs(collection(database, "trainees")),
    getDocs(collection(database, "certificates")),
    getDocs(collection(database, "imports")),
    getDocs(collection(database, "companies")),
    getDocs(collection(database, "users")),
  ]);

  const rawCourses: RawDocument[] = courseSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const rawTrainees: RawDocument[] = traineeSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const rawCertificates: RawDocument[] = certificateSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const rawImports: RawDocument[] = importSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const rawCompanies: RawDocument[] = companySnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const rawUsers: RawDocument[] = userSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

  const courseById = new Map(rawCourses.map((course) => [course.id, course]));
  const traineeById = new Map(rawTrainees.map((trainee) => [trainee.id, trainee]));
  const courseTrainees = new Map<string, Set<string>>();
  const courseCertificates = new Map<string, number>();
  const courseIssuedCertificates = new Map<string, number>();
  const traineeCourses = new Map<string, Set<string>>();
  const traineeCertificates = new Map<string, number>();

  rawCertificates.forEach((certificate) => {
    const courseId = text(certificate.courseDocumentId);
    const traineeId = text(certificate.traineeDocumentId);
    if (courseId) {
      if (!courseTrainees.has(courseId)) courseTrainees.set(courseId, new Set());
      if (traineeId) courseTrainees.get(courseId)?.add(traineeId);
      courseCertificates.set(courseId, (courseCertificates.get(courseId) ?? 0) + 1);
      if (text(certificate.certificateNumber) || dateValue(certificate.issueDate)) {
        courseIssuedCertificates.set(courseId, (courseIssuedCertificates.get(courseId) ?? 0) + 1);
      }
    }
    if (traineeId) {
      if (!traineeCourses.has(traineeId)) traineeCourses.set(traineeId, new Set());
      if (courseId) traineeCourses.get(traineeId)?.add(courseId);
      traineeCertificates.set(traineeId, (traineeCertificates.get(traineeId) ?? 0) + 1);
    }
  });

  const courses = rawCourses.map<DatabaseCourse>((course) => {
    const totalCertificates = courseCertificates.get(course.id) ?? 0;
    const issuedCertificates = courseIssuedCertificates.get(course.id) ?? 0;
    const code = [text(course.shortCourseCode), text(course.subCourseCode)].filter(Boolean).join("-") || course.id;
    return {
      id: course.id,
      code,
      name: text(course.nameAr) || text(course.nameEn) || "دورة دون اسم",
      nameEn: text(course.nameEn),
      date: formatCourseDate(course.startingDate, course.endingDate),
      hours: number(course.hours),
      trainees: courseTrainees.get(course.id)?.size ?? 0,
      completion: totalCertificates ? Math.round((issuedCertificates / totalCertificates) * 100) : 0,
      status: courseStatus(course.startingDate, course.endingDate),
      updatedAt: timestamp(course.updatedAt),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "ar"));

  const trainees = rawTrainees.map<DatabaseTrainee>((trainee) => {
    const relatedCourseNames = [...(traineeCourses.get(trainee.id) ?? new Set<string>())]
      .map((courseId) => {
        const course = courseById.get(courseId);
        return course ? text(course.nameAr) || text(course.nameEn) || courseId : courseId;
      });
    const certificateCount = traineeCertificates.get(trainee.id) ?? 0;
    return {
      id: trainee.id,
      name: text(trainee.nameAr) || text(trainee.nameEn) || "متدرب دون اسم",
      nameEn: text(trainee.nameEn),
      nationalId: text(trainee.nationalId).replace(/\D/g, "") || "غير متاح",
      mobile: text(trainee.mobile),
      courses: relatedCourseNames,
      certificates: certificateCount,
      state: certificateCount ? "مكتمل" : "لا توجد شهادات",
      updatedAt: timestamp(trainee.updatedAt),
      companyDocumentId: text(trainee.companyDocumentId),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "ar"));

  const certificates = rawCertificates.map<DatabaseCertificate>((certificate) => {
    const trainee = traineeById.get(text(certificate.traineeDocumentId));
    const course = courseById.get(text(certificate.courseDocumentId));
    const storedFiles = object(certificate.files);
    const fileDefinitions: Array<{ type: DatabaseCertificateFile["type"]; label: string }> = [
      { type: "local", label: "الشهادة المحلية" },
      { type: "international", label: "الشهادة الدولية" },
      { type: "card", label: "البطاقة الدولية" },
    ];
    const files = fileDefinitions.flatMap<DatabaseCertificateFile>(({ type, label }) => {
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
    return {
      id: certificate.id,
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

  const imports = rawImports.map<DatabaseImport>((item) => ({
    id: item.id,
    fileName: text(item.sourceFileName) || "ملف Excel",
    totalRows: number(item.totalRows),
    completedRows: number(item.completedRows),
    status: normalizeImportStatus(item.status),
    importedByEmail: text(item.importedByEmail),
    createdAt: timestamp(item.createdAt),
  })).sort((a, b) => b.createdAt - a.createdAt);

  const companyEmployeeCounts = new Map<string, number>();
  const companyCertificateCounts = new Map<string, number>();
  const companyAccountCounts = new Map<string, number>();
  rawTrainees.forEach((trainee) => {
    const companyId = text(trainee.companyDocumentId);
    if (companyId) companyEmployeeCounts.set(companyId, (companyEmployeeCounts.get(companyId) ?? 0) + 1);
  });
  rawCertificates.forEach((certificate) => {
    const companyId = text(certificate.companyDocumentId);
    if (companyId) companyCertificateCounts.set(companyId, (companyCertificateCounts.get(companyId) ?? 0) + 1);
  });
  rawUsers.forEach((user) => {
    const companyId = text(user.companyDocumentId);
    if (companyId && text(user.role) === "company_admin") {
      companyAccountCounts.set(companyId, (companyAccountCounts.get(companyId) ?? 0) + 1);
    }
  });
  const companies = rawCompanies.map<DatabaseCompany>((company) => ({
    id: company.id,
    name: text(company.name) || `شركة ${text(company.crNumber) || company.id}`,
    crNumber: text(company.crNumber),
    contactEmail: text(company.contactEmail),
    contactPhone: text(company.contactPhone),
    status: text(company.status) === "disabled" ? "disabled" : "active",
    employees: companyEmployeeCounts.get(company.id) ?? 0,
    certificates: companyCertificateCounts.get(company.id) ?? 0,
    accounts: companyAccountCounts.get(company.id) ?? 0,
    accountList: rawUsers
      .filter((user) => text(user.role) === "company_admin" && text(user.companyDocumentId) === company.id)
      .map((user) => ({
        uid: user.id,
        name: text(user.name) || "ممثل الشركة",
        email: text(user.email),
        disabled: user.disabled === true,
        updatedAt: timestamp(user.updatedAt),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar")),
    updatedAt: timestamp(company.updatedAt),
  })).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "ar"));

  return {
    courses,
    trainees,
    certificates,
    imports,
    companies,
    metrics: {
      activeCourses: courses.filter((course) => course.status === "نشطة").length,
      totalTrainees: trainees.length,
      issuedCertificates: certificates.length,
      pendingCertificates: certificates.filter((certificate) => !certificate.files.some((file) => file.type === "local")).length,
    },
    loadedAt: new Date(),
  };
}

export function getAdminDatabaseError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "permission-denied") return "لا يملك الحساب صلاحية قراءة بيانات المنصة.";
  if (code === "unavailable") return "تعذر الاتصال بقاعدة البيانات. تحقق من الإنترنت وحاول مجددًا.";
  return error instanceof Error ? error.message : "تعذر تحميل بيانات المنصة من Firestore.";
}
