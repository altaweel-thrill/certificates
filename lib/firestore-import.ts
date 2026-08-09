import type {
  CertificateImportRecord,
  CertificateImportValue,
} from "./certificate-import";
import {
  getFirebaseAuth,
  getFirebaseFirestore,
} from "./firebase";

type PreparedRecord = {
  source: CertificateImportRecord;
  traineeDocumentId: string;
  courseDocumentId: string;
  certificateDocumentId: string;
  companyDocumentId: string;
  companyCRNumber: string;
};

function text(value: CertificateImportValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function number(value: CertificateImportValue) {
  if (typeof value === "number") return value;
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function digits(value: CertificateImportValue) {
  return text(value).replace(/\D/g, "");
}

function mobile(value: CertificateImportValue) {
  const valueDigits = digits(value);
  return valueDigits.length === 9 && valueDigits.startsWith("5")
    ? `0${valueDigits}`
    : valueDigits;
}

function date(value: CertificateImportValue) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const valueText = text(value);
  const gregorian = valueText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (gregorian) {
    return new Date(Date.UTC(Number(gregorian[3]), Number(gregorian[2]) - 1, Number(gregorian[1])));
  }
  const iso = valueText.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  return null;
}

function safeDocumentId(value: string) {
  return value.replace(/\//g, "-").replace(/\s+/g, "-").slice(0, 180);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function prepareRecord(source: CertificateImportRecord): Promise<PreparedRecord> {
  const nationalId = text(source.Nat_ID_no);
  const companyCRNumber = digits(source.CompanyCRNumber) || digits(source.CrNumber);
  return {
    source,
    traineeDocumentId: await sha256(nationalId),
    courseDocumentId: safeDocumentId(`${text(source.ShortCourseCode)}-${text(source.SubCCode)}`),
    certificateDocumentId: safeDocumentId(text(source.CertificateNo)),
    companyDocumentId: companyCRNumber ? `cr-${safeDocumentId(companyCRNumber)}` : "",
    companyCRNumber,
  };
}

export async function importCertificatesToFirestore(
  records: CertificateImportRecord[],
  sourceFileName: string,
  onProgress?: (completed: number, total: number) => void,
) {
  const { collection, doc, serverTimestamp, setDoc, writeBatch } = await import("firebase/firestore");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  const currentUser = auth.currentUser;

  if (!currentUser) throw new Error("يجب تسجيل الدخول كمسؤول قبل الاستيراد.");

  const importReference = doc(collection(database, "imports"));
  const preparedRecords = await Promise.all(records.map(prepareRecord));

  await setDoc(importReference, {
    sourceFileName,
    status: "processing",
    totalRows: records.length,
    completedRows: 0,
    importedBy: currentUser.uid,
    importedByEmail: currentUser.email ?? "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    const chunkSize = 120;
    for (let start = 0; start < preparedRecords.length; start += chunkSize) {
      const chunk = preparedRecords.slice(start, start + chunkSize);
      const batch = writeBatch(database);
      const writtenCourses = new Set<string>();
      const writtenCompanies = new Set<string>();

      chunk.forEach(({ source, traineeDocumentId, courseDocumentId, certificateDocumentId, companyDocumentId, companyCRNumber }) => {
        if (companyDocumentId && !writtenCompanies.has(companyDocumentId)) {
          writtenCompanies.add(companyDocumentId);
          batch.set(doc(database, "companies", companyDocumentId), {
            crNumber: companyCRNumber,
            status: "active",
            updatedAt: serverTimestamp(),
            lastImportId: importReference.id,
          }, { merge: true });
        }

        if (!writtenCourses.has(courseDocumentId)) {
          writtenCourses.add(courseDocumentId);
          batch.set(doc(database, "courses", courseDocumentId), {
            shortCourseCode: text(source.ShortCourseCode),
            subCourseCode: text(source.SubCCode),
            nameAr: text(source.CNameAr),
            nameEn: text(source.CNameEn),
            hours: number(source.No_Of_Hrs),
            days: number(source.No_of_Days),
            accreditationNumber: text(source.Accreditation_No),
            startingDate: date(source.StartingDate),
            endingDate: date(source.EndDate),
            startingDateHijri: text(source.StartingDate_Hijri),
            endingDateHijri: text(source.EndDate_Hijri),
            updatedAt: serverTimestamp(),
            lastImportId: importReference.id,
          }, { merge: true });
        }

        batch.set(doc(database, "trainees", traineeDocumentId), {
          traineeId: text(source.TraineeID),
          nationalId: text(source.Nat_ID_no),
          nameAr: text(source.TName_ar),
          nameEn: text(source.TName_en).replace(/^:\s*/, ""),
          mobile: mobile(source.mobile),
          nationality: text(source.Nationality),
          nationalityAr: text(source.NationalityAr),
          gender: text(source.Gender),
          dateOfBirth: date(source.DOB),
          updatedAt: serverTimestamp(),
          lastImportId: importReference.id,
          ...(companyDocumentId ? { companyDocumentId, companyCRNumber } : {}),
        }, { merge: true });

        batch.set(doc(database, "certificates", certificateDocumentId), {
          certificateNumber: text(source.CertificateNo),
          ctrId: text(source.CTRID),
          traineeDocumentId,
          courseDocumentId,
          issueDate: date(source.IssueDate),
          issueDateHijri: text(source.IssueDateHijri),
          credentialPassword: text(source.CrPassword),
          importId: importReference.id,
          sourceFileName,
          status: "imported",
          updatedAt: serverTimestamp(),
          ...(companyDocumentId ? { companyDocumentId, companyCRNumber } : {}),
        }, { merge: true });
      });

      await batch.commit();
      const completedRows = Math.min(start + chunk.length, preparedRecords.length);
      await setDoc(importReference, {
        completedRows,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onProgress?.(completedRows, preparedRecords.length);
    }

    await setDoc(importReference, {
      status: "completed",
      completedRows: preparedRecords.length,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return { importId: importReference.id, importedRows: preparedRecords.length };
  } catch (error) {
    await setDoc(importReference, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown import error",
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

export function getFirestoreImportError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code === "permission-denied") return "لا يملك الحساب صلاحية حفظ بيانات الاستيراد.";
  if (code === "unavailable") return "تعذر الاتصال بـ Firestore. تحقق من الإنترنت وحاول مجدداً.";
  return error instanceof Error ? error.message : "تعذر حفظ بيانات Excel في Firestore.";
}
