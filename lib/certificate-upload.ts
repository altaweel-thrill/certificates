import { getFirebaseAuth, getFirebaseFirestore, getFirebaseStorage } from "./firebase";

export type CertificateFileType = "local" | "international" | "card";

const duplicateCertificateCode = "certificate/already-uploaded";

const certificateFileLabels: Record<CertificateFileType, string> = {
  local: "الشهادة المحلية",
  international: "الشهادة الدولية",
  card: "البطاقة الدولية",
};

export function buildCertificateDownloadFileName(traineeNameEn: string, certificateNumber: string) {
  const safeName = traineeNameEn
    .replace(/^:\s*/, "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeNumber = certificateNumber
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safeName || "Trainee"}_${safeNumber || "Certificate"}.pdf`;
}

function certificateDetailsFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, "").trim();
  const prefixedName = baseName.match(/^([ic])_(.+)$/i);
  const fileType: CertificateFileType = prefixedName?.[1].toLowerCase() === "i"
    ? "international"
    : prefixedName?.[1].toLowerCase() === "c"
      ? "card"
      : "local";
  return {
    certificateNumber: (prefixedName?.[2] ?? baseName).trim(),
    fileType,
    fileLabel: certificateFileLabels[fileType],
  };
}

function safeDocumentId(value: string) {
  return value.replace(/\//g, "-").replace(/\s+/g, "-").slice(0, 180);
}

function safeStorageName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-+/g, "-").slice(0, 180);
}

function certificateAlreadyUploadedError(certificateNumber: string, fileLabel: string) {
  return Object.assign(
    new Error(`${fileLabel} رقم ${certificateNumber} مرفوعة مسبقًا.`),
    { code: duplicateCertificateCode },
  );
}

export function isCertificateAlreadyUploadedError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === duplicateCertificateCode,
  );
}

export async function uploadCertificateByFileName(file: File, onProgress?: (percentage: number) => void) {
  const { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, updateDoc, where } = await import("firebase/firestore");
  const { ref, uploadBytesResumable } = await import("firebase/storage");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  const storage = await getFirebaseStorage();
  storage.maxUploadRetryTime = 12_000;

  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول لرفع الشهادة.");
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
    throw new Error("يجب اختيار ملف PDF صحيح.");
  }
  if (file.size <= 0) throw new Error("ملف PDF فارغ.");
  if (file.size > 20 * 1024 * 1024) throw new Error("حجم ملف PDF يجب ألا يتجاوز 20 ميجابايت.");

  const { certificateNumber, fileType, fileLabel } = certificateDetailsFromFileName(file.name);
  if (!certificateNumber) throw new Error("اسم الملف غير صحيح. استخدم 2345.pdf أو i_2345.pdf أو c_2345.pdf");

  let certificateReference = doc(database, "certificates", safeDocumentId(certificateNumber));
  let certificateSnapshot = await getDoc(certificateReference);

  if (!certificateSnapshot.exists()) {
    const matches = await getDocs(query(
      collection(database, "certificates"),
      where("certificateNumber", "==", certificateNumber),
      limit(1),
    ));
    if (!matches.empty) {
      certificateSnapshot = matches.docs[0];
      certificateReference = matches.docs[0].ref;
    }
  }

  if (!certificateSnapshot.exists()) {
    throw new Error(`لم يتم العثور على شهادة رقم ${certificateNumber}. تأكد أن اسم الملف يطابق رقم الشهادة في Excel.`);
  }

  const certificateData = certificateSnapshot.data();
  const storedFiles = certificateData.files && typeof certificateData.files === "object"
    ? certificateData.files as Record<string, unknown>
    : {};
  const storedFile = storedFiles[fileType] && typeof storedFiles[fileType] === "object"
    ? storedFiles[fileType] as Record<string, unknown>
    : {};
  const hasStoredFile = Boolean(storedFile.storagePath || storedFile.downloadUrl);
  const hasLegacyLocalFile = fileType === "local" && Boolean(
    certificateData.storagePath ||
    certificateData.downloadUrl ||
    certificateData.fileUrl ||
    certificateData.pdfUrl,
  );

  if (hasStoredFile || hasLegacyLocalFile) {
    throw certificateAlreadyUploadedError(certificateNumber, fileLabel);
  }

  const storagePath = `certificates/${certificateReference.id}/${fileType}/${safeStorageName(`${fileType}-${certificateNumber}.pdf`)}`;
  const storageReference = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageReference, file, {
    contentType: "application/pdf",
    contentDisposition: `attachment; filename="${safeStorageName(file.name)}"`,
    customMetadata: {
      certificateId: certificateReference.id,
      certificateNumber,
      fileType,
      uploadedBy: auth.currentUser.uid,
    },
  });
  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const percentage = snapshot.totalBytes
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;
        onProgress?.(percentage);
      },
      reject,
      resolve,
    );
  });

  const fileField = `files.${fileType}`;
  await updateDoc(certificateReference, {
    [`${fileField}.storagePath`]: storagePath,
    [`${fileField}.originalFileName`]: file.name,
    [`${fileField}.fileSize`]: file.size,
    [`${fileField}.contentType`]: "application/pdf",
    [`${fileField}.uploadedBy`]: auth.currentUser.uid,
    [`${fileField}.uploadedByEmail`]: auth.currentUser.email ?? "",
    [`${fileField}.uploadedAt`]: serverTimestamp(),
    status: "available",
    updatedAt: serverTimestamp(),
  });

  return { certificateId: certificateReference.id, certificateNumber, fileType, fileLabel };
}

export async function deleteCertificateFile(
  certificateId: string,
  file: { type: CertificateFileType; storagePath: string },
) {
  const { deleteField, doc, getDoc, serverTimestamp, updateDoc } = await import("firebase/firestore");
  const { deleteObject, ref } = await import("firebase/storage");
  const auth = await getFirebaseAuth();
  const database = await getFirebaseFirestore();
  const storage = await getFirebaseStorage();

  if (!auth.currentUser) throw new Error("يجب تسجيل الدخول كمسؤول لحذف ملف الشهادة.");
  if (!certificateId || !["local", "international", "card"].includes(file.type)) {
    throw new Error("بيانات ملف الشهادة غير صحيحة.");
  }

  const certificateReference = doc(database, "certificates", certificateId);
  const certificateSnapshot = await getDoc(certificateReference);
  if (!certificateSnapshot.exists()) throw new Error("لم يعد سجل الشهادة موجودًا.");

  if (file.storagePath) {
    await deleteObject(ref(storage, file.storagePath)).catch((error: unknown) => {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "storage/object-not-found") throw error;
    });
  }

  const certificateData = certificateSnapshot.data();
  const storedFiles = certificateData.files && typeof certificateData.files === "object"
    ? certificateData.files as Record<string, unknown>
    : {};
  const hasOtherNestedFile = Object.entries(storedFiles).some(([type, value]) => {
    if (type === file.type || !value || typeof value !== "object") return false;
    const storedFile = value as Record<string, unknown>;
    return Boolean(storedFile.storagePath || storedFile.downloadUrl);
  });
  const hasLegacyLocalFile = file.type !== "local" && Boolean(
    certificateData.storagePath ||
    certificateData.downloadUrl ||
    certificateData.fileUrl ||
    certificateData.pdfUrl,
  );

  const updates: Record<string, unknown> = {
    [`files.${file.type}`]: deleteField(),
    status: hasOtherNestedFile || hasLegacyLocalFile ? "available" : "imported",
    lastFileAction: "deleted",
    lastFileType: file.type,
    lastFileDeletedBy: auth.currentUser.uid,
    lastFileDeletedByEmail: auth.currentUser.email ?? "",
    lastFileDeletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (file.type === "local") {
    updates.storagePath = deleteField();
    updates.downloadUrl = deleteField();
    updates.fileUrl = deleteField();
    updates.pdfUrl = deleteField();
  }

  await updateDoc(certificateReference, updates);
  return { certificateId, fileType: file.type };
}

export function getCertificateUploadError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === duplicateCertificateCode) return error instanceof Error ? error.message : "هذه الشهادة مرفوعة مسبقًا.";
  if (code === "storage/unauthorized" || code === "permission-denied") return "لا يملك الحساب صلاحية رفع ملفات الشهادات.";
  if (code === "storage/bucket-not-found" || code === "storage/unknown") return "Firebase Storage غير مفعّل أو غير جاهز في المشروع. فعّله من لوحة Firebase ثم حاول مجددًا.";
  if (code === "storage/quota-exceeded") return "تم تجاوز سعة التخزين المتاحة في Firebase Storage.";
  if (code === "storage/retry-limit-exceeded" || code === "unavailable") return "تعذر الوصول إلى Firebase Storage. تأكد من تفعيل Storage ثم حاول مجددًا.";
  return error instanceof Error ? error.message : "تعذر رفع ملف الشهادة.";
}

export function getCertificateDeleteError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "storage/unauthorized" || code === "permission-denied") return "لا يملك الحساب صلاحية حذف ملف الشهادة.";
  if (code === "storage/retry-limit-exceeded" || code === "storage/unknown" || code === "unavailable") return "تعذر حذف ملف الشهادة حالياً. تحقق من الاتصال وحاول مرة أخرى.";
  return error instanceof Error ? error.message : "تعذر حذف ملف الشهادة.";
}

export type CertificateDownload = {
  url: string;
  revoke: () => void;
};

export async function getCertificateDownload(
  storagePath: string,
  legacyDownloadUrl = "",
  preferredFileName = "certificate.pdf",
): Promise<CertificateDownload> {
  if (storagePath) {
    const { getDownloadURL, getMetadata, ref, updateMetadata } = await import("firebase/storage");
    const storage = await getFirebaseStorage();
    const storageReference = ref(storage, storagePath);
    const safeFileName = safeStorageName(preferredFileName) || "certificate.pdf";
    const attachmentDisposition = `attachment; filename="${safeFileName}"`;
    const metadata = await getMetadata(storageReference);

    if (!metadata.contentDisposition?.toLowerCase().startsWith("attachment")) {
      await updateMetadata(storageReference, { contentDisposition: attachmentDisposition }).catch(() => undefined);
    }

    return {
      url: await getDownloadURL(storageReference),
      revoke: () => undefined,
    };
  }
  if (legacyDownloadUrl) {
    const response = await fetch(legacyDownloadUrl);
    if (!response.ok) throw new Error("تعذر تنزيل ملف الشهادة.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("ملف الشهادة فارغ أو غير متاح.");
    const objectUrl = URL.createObjectURL(blob);
    return {
      url: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  }
  throw new Error("لا يوجد ملف PDF مرتبط بهذه الشهادة.");
}

export function getCertificateDownloadError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "storage/object-not-found") return "ملف الشهادة غير موجود في Firebase Storage. أعد رفع الشهادة.";
  if (code === "storage/unauthorized" || code === "permission-denied") return "لا يملك الحساب صلاحية تنزيل هذه الشهادة. تحقق من نشر قواعد Storage.";
  if (code === "storage/retry-limit-exceeded" || code === "storage/unknown" || code === "unavailable") return "تعذر الوصول إلى ملف الشهادة. تحقق من تفعيل Firebase Storage والاتصال بالإنترنت.";
  return error instanceof Error ? error.message : "تعذر تنزيل ملف الشهادة.";
}
