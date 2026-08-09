import type { CellValue } from "read-excel-file/browser";

export const certificateImportHeaders = [
  "CertificateNo",
  "CTRID",
  "ShortCourseCode",
  "SubCCode",
  "TraineeID",
  "TName_en",
  "TName_ar",
  "Nat_ID_no",
  "mobile",
  "Nationality",
  "NationalityAr",
  "Gender",
  "DOB",
  "CNameEn",
  "CNameAr",
  "No_Of_Hrs",
  "No_of_Days",
  "Accreditation_No",
  "StartingDate",
  "EndDate",
  "StartingDate_Hijri",
  "EndDate_Hijri",
  "IssueDate",
  "IssueDateHijri",
  "CrNumber",
  "CrPassword",
] as const;

export type CertificateImportHeader = (typeof certificateImportHeaders)[number];

export const companyCrHeader = "CompanyCRNumber" as const;
const companyCrHeaderAliases = [companyCrHeader, "CompanyCR", "Company_CR_Number", "CRNumberCompany"] as const;

export type CertificateImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type CertificateImportValue = ImportCell;
export type CertificateImportRecord = Record<CertificateImportHeader, CertificateImportValue> & {
  CompanyCRNumber?: CertificateImportValue;
};

export type CertificateImportResult = {
  totalRows: number;
  validRows: number;
  courses: string[];
  errors: CertificateImportIssue[];
  warnings: CertificateImportIssue[];
  records: CertificateImportRecord[];
};

type ImportCell = CellValue | null;

function cellText(value: ImportCell) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function cellNumber(value: ImportCell) {
  if (typeof value === "number") return value;
  const parsed = Number(cellText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function digits(value: ImportCell) {
  return cellText(value).replace(/\D/g, "");
}

function hasDate(value: ImportCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
  const valueText = cellText(value);
  return /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(valueText) ||
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(valueText);
}

export function validateCertificateRows(rows: ImportCell[][]): CertificateImportResult {
  if (!rows.length) throw new Error("ملف Excel فارغ.");

  const headers = rows[0].map(cellText);
  const missingHeaders = certificateImportHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`الأعمدة التالية مفقودة: ${missingHeaders.join("، ")}`);
  }

  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const companyCrIndex = companyCrHeaderAliases
    .map((header) => headerIndexes.get(header))
    .find((index) => index !== undefined);
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cellText(cell) !== ""));
  const errors: CertificateImportIssue[] = [];
  const warnings: CertificateImportIssue[] = [];
  const courses = new Set<string>();
  const certificateNumbers = new Set<string>();
  const records: CertificateImportRecord[] = [];
  let validRows = 0;

  const get = (row: ImportCell[], header: CertificateImportHeader) =>
    row[headerIndexes.get(header) ?? -1] ?? null;

  dataRows.forEach((row, index) => {
    const excelRow = index + 2;
    const rowErrors: CertificateImportIssue[] = [];
    records.push({
      ...Object.fromEntries(certificateImportHeaders.map((header) => [header, get(row, header)])),
      CompanyCRNumber: companyCrIndex === undefined ? null : row[companyCrIndex] ?? null,
    } as CertificateImportRecord);
    const requiredTextFields: CertificateImportHeader[] = [
      "CertificateNo",
      "CTRID",
      "ShortCourseCode",
      "SubCCode",
      "TraineeID",
      "TName_en",
      "TName_ar",
      "Nat_ID_no",
      "mobile",
      "CNameEn",
      "CNameAr",
      "Accreditation_No",
    ];

    requiredTextFields.forEach((field) => {
      if (!cellText(get(row, field))) {
        rowErrors.push({ row: excelRow, field, message: "القيمة مطلوبة" });
      }
    });

    const mobile = digits(get(row, "mobile"));
    const normalizedMobile = mobile.length === 9 && mobile.startsWith("5") ? `0${mobile}` : mobile;
    if (mobile && !/^05\d{8}$/.test(normalizedMobile) && !/^9665\d{8}$/.test(mobile)) {
      warnings.push({ row: excelRow, field: "mobile", message: "صيغة رقم الجوال تحتاج مراجعة" });
    }

    const certificateNumber = cellText(get(row, "CertificateNo"));
    if (certificateNumber) {
      if (certificateNumbers.has(certificateNumber)) {
        rowErrors.push({ row: excelRow, field: "CertificateNo", message: "رقم الشهادة مكرر داخل الملف" });
      }
      certificateNumbers.add(certificateNumber);
    }

    const hours = cellNumber(get(row, "No_Of_Hrs"));
    const days = cellNumber(get(row, "No_of_Days"));
    if (hours === null || hours <= 0) {
      warnings.push({ row: excelRow, field: "No_Of_Hrs", message: "عدد الساعات غير محدد وسيتم حفظه بقيمة صفر" });
    }
    if (days === null || days <= 0) {
      warnings.push({ row: excelRow, field: "No_of_Days", message: "عدد الأيام غير محدد وسيتم حفظه بقيمة صفر" });
    }

    (["DOB", "StartingDate", "EndDate", "IssueDate"] as CertificateImportHeader[]).forEach((field) => {
      const value = get(row, field);
      if (cellText(value) && !hasDate(value)) {
        warnings.push({ row: excelRow, field, message: "تعذر قراءة التاريخ وسيتم حفظه دون تاريخ" });
      }
    });

    const course = cellText(get(row, "CNameAr")) || cellText(get(row, "CNameEn"));
    if (course) courses.add(course);

    errors.push(...rowErrors);
    if (!rowErrors.length) validRows += 1;
  });

  return {
    totalRows: dataRows.length,
    validRows,
    courses: [...courses],
    errors,
    warnings,
    records,
  };
}

export async function parseCertificateImport(file: File): Promise<CertificateImportResult> {
  const { readSheet } = await import("read-excel-file/browser");
  return validateCertificateRows(await readSheet(file));
}
