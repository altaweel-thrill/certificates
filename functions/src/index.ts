import { initializeApp } from "firebase-admin/app";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";

initializeApp();

const REGION = "europe-west1";
const roles = ["trainee", "company_admin", "admin", "super_admin"] as const;
type UserRole = (typeof roles)[number];

type Caller = {
  uid: string;
  role: "admin" | "super_admin";
};

function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.includes(value as UserRole);
}

async function getStoredRole(uid: string) {
  const snapshot = await getFirestore().doc(`users/${uid}`).get();
  const role = snapshot.data()?.role;
  return isRole(role) ? role : null;
}

async function requireAdmin(request: CallableRequest<unknown>): Promise<Caller> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }

  const callerRecord = await getAuth().getUser(request.auth.uid);
  if (callerRecord.disabled) {
    throw new HttpsError("permission-denied", "الحساب معطّل.");
  }

  const tokenRole = request.auth.token.role;
  const storedRole = await getStoredRole(request.auth.uid);
  const role = storedRole
    ? storedRole === "super_admin"
      ? "super_admin"
      : storedRole === "admin"
        ? "admin"
        : null
    : tokenRole === "super_admin"
      ? "super_admin"
      : tokenRole === "admin" || request.auth.token.admin === true
        ? "admin"
        : null;

  if (!role) {
    throw new HttpsError("permission-denied", "لا يملك الحساب صلاحية إدارة المستخدمين.");
  }

  return { uid: request.auth.uid, role };
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${label} مطلوب.`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} غير صالح.`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} أطول من الحد المسموح.`);
  }
  return result;
}

async function requireManageableTarget(caller: Caller, uid: string) {
  if (caller.uid === uid) {
    throw new HttpsError("permission-denied", "لا يمكنك تعديل أو حذف حسابك الحالي.");
  }

  const record = await getAuth().getUser(uid);
  const storedRole = await getStoredRole(uid);
  const targetRole = record.customClaims?.role === "super_admin" || storedRole === "super_admin"
    ? "super_admin"
    : record.customClaims?.role === "admin" || storedRole === "admin"
      ? "admin"
      : record.customClaims?.role === "company_admin" || storedRole === "company_admin"
        ? "company_admin"
        : "trainee";

  if (targetRole === "super_admin" && caller.role !== "super_admin") {
    throw new HttpsError("permission-denied", "إدارة المسؤول الأعلى تتطلب صلاحية مسؤول أعلى.");
  }

  return record;
}

function serializeUser(record: UserRecord, data: Record<string, unknown> = {}) {
  const claimRole = record.customClaims?.role;
  const storedRole = data.role;
  const role: UserRole = isRole(claimRole)
    ? claimRole
    : isRole(storedRole)
      ? storedRole
      : "trainee";

  return {
    uid: record.uid,
    name:
      (typeof data.name === "string" && data.name.trim()) ||
      record.displayName ||
      record.email?.split("@")[0] ||
      "مستخدم",
    email: record.email || "",
    role,
    companyDocumentId: typeof data.companyDocumentId === "string" ? data.companyDocumentId : "",
    disabled: record.disabled,
    createdAt: record.metadata.creationTime || "",
    lastSignInAt: record.metadata.lastSignInTime || "",
  };
}

function throwAdminError(error: unknown): never {
  if (error instanceof HttpsError) throw error;

  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  if (code === "auth/email-already-exists") {
    throw new HttpsError("already-exists", "البريد الإلكتروني مستخدم مسبقاً.");
  }
  if (code === "auth/user-not-found") {
    throw new HttpsError("not-found", "المستخدم غير موجود.");
  }
  if (code === "auth/invalid-password" || code === "auth/invalid-email") {
    throw new HttpsError("invalid-argument", "البريد الإلكتروني أو كلمة المرور غير صالحة.");
  }

  console.error(error);
  throw new HttpsError("internal", "تعذر إكمال العملية حالياً.");
}

export const listPlatformUsers = onCall({ region: REGION }, async (request) => {
  await requireAdmin(request);

  try {
    const result = await getAuth().listUsers(1000);
    const database = getFirestore();
    const snapshots = await Promise.all(
      result.users.map((user) => database.doc(`users/${user.uid}`).get()),
    );

    return {
      users: result.users.map((user, index) =>
        serializeUser(user, snapshots[index].data() ?? {}),
      ),
    };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const createPlatformUser = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const name = requireText(data.name, "اسم المستخدم");
    const email = requireText(data.email, "البريد الإلكتروني").toLowerCase();
    const password = requireText(data.password, "كلمة المرور");
    const role = data.role;

    if (!isRole(role)) {
      throw new HttpsError("invalid-argument", "الصلاحية غير صحيحة.");
    }
    if (role === "company_admin") {
      throw new HttpsError("invalid-argument", "أضف حساب الشركة من قسم الشركات لربطه بالسجل التجاري.");
    }
    if (password.length < 6) {
      throw new HttpsError("invalid-argument", "كلمة المرور يجب ألا تقل عن 6 أحرف.");
    }
    if (role === "super_admin" && caller.role !== "super_admin") {
      throw new HttpsError("permission-denied", "إنشاء مسؤول أعلى يتطلب صلاحية مسؤول أعلى.");
    }

    const auth = getAuth();
    const record = await auth.createUser({ email, password, displayName: name });

    try {
      await auth.setCustomUserClaims(record.uid, {
        role,
        admin: role === "admin" || role === "super_admin",
      });
      await getFirestore().doc(`users/${record.uid}`).set({
        name,
        email,
        role,
        disabled: false,
        createdBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      await auth.deleteUser(record.uid).catch(() => undefined);
      throw error;
    }

    return { user: serializeUser(record, { name, email, role }) };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const setPlatformUserDisabled = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const uid = requireText(data.uid, "معرف المستخدم");
    if (typeof data.disabled !== "boolean") {
      throw new HttpsError("invalid-argument", "حالة الحساب غير صحيحة.");
    }

    await requireManageableTarget(caller, uid);
    const auth = getAuth();
    await auth.updateUser(uid, { disabled: data.disabled });
    if (data.disabled) await auth.revokeRefreshTokens(uid);
    await getFirestore().doc(`users/${uid}`).set({
      disabled: data.disabled,
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true as const };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const setPlatformUserRole = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const uid = requireText(data.uid, "معرف المستخدم");
    const role = data.role;
    if (!isRole(role)) {
      throw new HttpsError("invalid-argument", "الصلاحية غير صحيحة.");
    }
    if (role === "company_admin") {
      throw new HttpsError("invalid-argument", "تعيين صلاحية الشركة يتم من قسم الشركات.");
    }
    if (role === "super_admin" && caller.role !== "super_admin") {
      throw new HttpsError("permission-denied", "تعيين مسؤول أعلى يتطلب صلاحية مسؤول أعلى.");
    }

    const record = await requireManageableTarget(caller, uid);
    await getAuth().setCustomUserClaims(uid, {
      ...(record.customClaims ?? {}),
      role,
      admin: role === "admin" || role === "super_admin",
      companyDocumentId: null,
    });
    await getAuth().revokeRefreshTokens(uid);
    await getFirestore().doc(`users/${uid}`).set({
      role,
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true as const };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const createCompanyAccount = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const companyDocumentId = requireText(data.companyDocumentId, "معرف الشركة");
    const name = requireText(data.name, "اسم ممثل الشركة");
    const email = requireText(data.email, "البريد الإلكتروني").toLowerCase();
    const password = requireText(data.password, "كلمة المرور");
    if (password.length < 8) {
      throw new HttpsError("invalid-argument", "كلمة المرور يجب ألا تقل عن 8 أحرف.");
    }

    const database = getFirestore();
    const companySnapshot = await database.doc(`companies/${companyDocumentId}`).get();
    if (!companySnapshot.exists) throw new HttpsError("not-found", "الشركة غير موجودة.");
    const company = companySnapshot.data() ?? {};
    if (company.status === "disabled") throw new HttpsError("permission-denied", "لا يمكن إنشاء حساب لشركة معطّلة.");

    const auth = getAuth();
    const record = await auth.createUser({ email, password, displayName: name });
    try {
      await auth.setCustomUserClaims(record.uid, {
        role: "company_admin",
        admin: false,
        companyDocumentId,
      });
      await database.doc(`users/${record.uid}`).set({
        name,
        email,
        role: "company_admin",
        companyDocumentId,
        companyName: typeof company.name === "string" ? company.name : "",
        disabled: false,
        createdBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      await auth.deleteUser(record.uid).catch(() => undefined);
      throw error;
    }

    return { account: { uid: record.uid, email, name } };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const updateCompanyAccount = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const companyDocumentId = requireText(data.companyDocumentId, "معرف الشركة");
    const uid = requireText(data.uid, "معرف الحساب");
    const name = requireText(data.name, "اسم ممثل الشركة");
    const email = requireText(data.email, "البريد الإلكتروني").toLowerCase();
    const password = typeof data.password === "string" ? data.password.trim() : "";
    if (password && password.length < 8) {
      throw new HttpsError("invalid-argument", "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.");
    }

    const database = getFirestore();
    const [companySnapshot, userSnapshot] = await Promise.all([
      database.doc(`companies/${companyDocumentId}`).get(),
      database.doc(`users/${uid}`).get(),
    ]);
    if (!companySnapshot.exists) throw new HttpsError("not-found", "الشركة غير موجودة.");
    const userData = userSnapshot.data() ?? {};
    if (userData.role !== "company_admin" || userData.companyDocumentId !== companyDocumentId) {
      throw new HttpsError("permission-denied", "الحساب غير مرتبط بهذه الشركة.");
    }

    const updateInput: { displayName: string; email: string; password?: string } = { displayName: name, email };
    if (password) updateInput.password = password;
    await getAuth().updateUser(uid, updateInput);
    if (password) await getAuth().revokeRefreshTokens(uid);
    await database.doc(`users/${uid}`).set({
      name,
      email,
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { account: { uid, email, name } };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const deletePlatformUser = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const uid = requireText(data.uid, "معرف المستخدم");
    await requireManageableTarget(caller, uid);
    await getAuth().deleteUser(uid);
    await getFirestore().doc(`users/${uid}`).delete();
    return { success: true as const };
  } catch (error) {
    return throwAdminError(error);
  }
});

function digits(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function normalizeSaudiMobile(value: unknown) {
  const valueDigits = digits(value);
  if (/^05\d{8}$/.test(valueDigits)) return valueDigits;
  if (/^5\d{8}$/.test(valueDigits)) return `0${valueDigits}`;
  if (/^9665\d{8}$/.test(valueDigits)) return `0${valueDigits.slice(3)}`;
  return "";
}

function parseDateOfBirth(value: unknown) {
  const input = optionalText(value, "تاريخ الميلاد", 10);
  if (!input) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) throw new HttpsError("invalid-argument", "صيغة تاريخ الميلاد غير صحيحة.");
  const date = new Date(`${input}T12:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3]) ||
    date.getTime() > Date.now()
  ) {
    throw new HttpsError("invalid-argument", "تاريخ الميلاد غير صحيح.");
  }
  return Timestamp.fromDate(date);
}

function timestampMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function courseStatus(startValue: unknown, endValue: unknown) {
  const now = Date.now();
  const start = timestampMillis(startValue);
  const end = timestampMillis(endValue);
  if (end && end < now) return "مكتملة";
  if (start && start > now) return "مجدولة";
  if (start || end) return "نشطة";
  return "غير محددة";
}

async function rebuildDashboardStats(updatedBy: string) {
  const database = getFirestore();
  const certificates = database.collection("certificates");
  const courses = database.collection("courses");
  const trainees = database.collection("trainees");

  const [
    traineeCountSnapshot,
    certificateCountSnapshot,
    modernLocalFileCountSnapshot,
    legacyLocalFileCountSnapshot,
    courseSnapshot,
    recentCourseSnapshot,
    recentImportSnapshot,
  ] = await Promise.all([
    trainees.count().get(),
    certificates.count().get(),
    certificates.where("files.local.storagePath", ">", "").count().get(),
    certificates.where("storagePath", ">", "").count().get(),
    courses.select("startingDate", "endingDate").get(),
    courses.orderBy("updatedAt", "desc").limit(4).get(),
    database.collection("imports").orderBy("createdAt", "desc").limit(4).get(),
  ]);

  const totalCertificates = certificateCountSnapshot.data().count;
  const localFiles = Math.min(
    totalCertificates,
    modernLocalFileCountSnapshot.data().count + legacyLocalFileCountSnapshot.data().count,
  );

  const recentCourses = await Promise.all(recentCourseSnapshot.docs.map(async (document) => {
    const data = document.data();
    const courseCertificateCount = await certificates
      .where("courseDocumentId", "==", document.id)
      .count()
      .get();
    const total = courseCertificateCount.data().count;
    return {
      id: document.id,
      shortCourseCode: typeof data.shortCourseCode === "string" ? data.shortCourseCode : "",
      subCourseCode: typeof data.subCourseCode === "string" ? data.subCourseCode : "",
      nameAr: typeof data.nameAr === "string" ? data.nameAr : "",
      nameEn: typeof data.nameEn === "string" ? data.nameEn : "",
      hours: typeof data.hours === "number" ? data.hours : 0,
      startingDate: data.startingDate ?? null,
      endingDate: data.endingDate ?? null,
      trainees: total,
      completion: total ? 100 : 0,
      updatedAt: data.updatedAt ?? null,
    };
  }));

  const recentImports = recentImportSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      sourceFileName: typeof data.sourceFileName === "string" ? data.sourceFileName : "",
      totalRows: typeof data.totalRows === "number" ? data.totalRows : 0,
      completedRows: typeof data.completedRows === "number" ? data.completedRows : 0,
      status: typeof data.status === "string" ? data.status : "processing",
      importedByEmail: typeof data.importedByEmail === "string" ? data.importedByEmail : "",
      createdAt: data.createdAt ?? null,
    };
  });

  const stats = {
    totalCourses: courseSnapshot.size,
    activeCourses: courseSnapshot.docs.filter((document) => {
      const data = document.data();
      return courseStatus(data.startingDate, data.endingDate) === "نشطة";
    }).length,
    totalTrainees: traineeCountSnapshot.data().count,
    issuedCertificates: totalCertificates,
    pendingCertificates: Math.max(0, totalCertificates - localFiles),
    recentCourses,
    recentImports,
    updatedBy,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await database.doc("dashboard/stats").set(stats, { merge: true });
  return stats;
}

export const refreshDashboardStats = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);
  try {
    await rebuildDashboardStats(caller.uid);
    return { success: true as const };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const updateTraineeDetails = onCall({ region: REGION }, async (request) => {
  const caller = await requireAdmin(request);

  try {
    const data = request.data as Record<string, unknown>;
    const currentDocumentId = requireText(data.traineeDocumentId, "معرف المتدرب");
    const nameAr = optionalText(data.nameAr, "الاسم بالعربية", 250);
    const nameEn = optionalText(data.nameEn, "الاسم بالإنجليزية", 250).replace(/^:\s*/, "");
    const nationalId = optionalText(data.nationalId, "رقم الهوية أو المعرّف", 200);
    const mobileInput = optionalText(data.mobile, "رقم الجوال", 30);
    const mobile = mobileInput ? normalizeSaudiMobile(mobileInput) : "";
    const traineeId = optionalText(data.traineeId, "رقم المتدرب", 100);
    const nationality = optionalText(data.nationality, "الجنسية", 100);
    const gender = optionalText(data.gender, "الجنس", 50);
    const dateOfBirth = parseDateOfBirth(data.dateOfBirth);

    if (!nameAr && !nameEn) {
      throw new HttpsError("invalid-argument", "اسم المتدرب بالعربية أو الإنجليزية مطلوب.");
    }
    if (!nationalId) {
      throw new HttpsError("invalid-argument", "رقم الهوية أو المعرّف مطلوب.");
    }
    if (mobileInput && !mobile) {
      throw new HttpsError("invalid-argument", "رقم الجوال السعودي غير صحيح.");
    }

    const database = getFirestore();
    const sourceReference = database.doc(`trainees/${currentDocumentId}`);
    const sourceSnapshot = await sourceReference.get();
    if (!sourceSnapshot.exists) {
      throw new HttpsError("not-found", "سجل المتدرب غير موجود.");
    }

    const duplicateSnapshot = await database.collection("trainees")
      .where("nationalId", "==", nationalId)
      .limit(3)
      .get();
    if (duplicateSnapshot.docs.some((document) => document.id !== currentDocumentId)) {
      throw new HttpsError("already-exists", "رقم الهوية أو المعرّف مستخدم لمتدرب آخر.");
    }

    const nextDocumentId = createHash("sha256").update(nationalId).digest("hex");
    const update = {
      nameAr,
      nameEn,
      nationalId,
      mobile,
      traineeId,
      nationality,
      nationalityAr: nationality,
      gender,
      dateOfBirth,
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const [linkedCertificates, linkedUsers] = await Promise.all([
      database.collection("certificates").where("traineeDocumentId", "==", currentDocumentId).get(),
      database.collection("users").where("traineeDocumentId", "==", currentDocumentId).get(),
    ]);

    if (nextDocumentId === currentDocumentId) {
      const writer = database.bulkWriter();
      writer.update(sourceReference, update);
      linkedUsers.docs.forEach((document) => writer.set(document.ref, {
        name: nameAr || nameEn,
        nationalId,
        phoneNumber: mobile,
        updatedBy: caller.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
      await writer.close();
      return { traineeDocumentId: currentDocumentId };
    }

    const targetReference = database.doc(`trainees/${nextDocumentId}`);
    const targetSnapshot = await targetReference.get();
    if (targetSnapshot.exists) {
      throw new HttpsError("already-exists", "يوجد سجل آخر مرتبط برقم الهوية أو المعرّف الجديد.");
    }

    const writer = database.bulkWriter();
    writer.set(targetReference, {
      ...(sourceSnapshot.data() ?? {}),
      ...update,
      migratedFromDocumentId: currentDocumentId,
    });
    linkedCertificates.docs.forEach((document) => writer.update(document.ref, {
      traineeDocumentId: nextDocumentId,
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }));
    linkedUsers.docs.forEach((document) => writer.set(document.ref, {
      name: nameAr || nameEn,
      nationalId,
      phoneNumber: mobile,
      traineeDocumentId: nextDocumentId,
      updatedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    writer.delete(sourceReference);
    await writer.close();

    return { traineeDocumentId: nextDocumentId };
  } catch (error) {
    return throwAdminError(error);
  }
});

export const activateTraineeSession = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب التحقق من رقم الجوال أولاً.");

  const nationalIdValue = (request.data as Record<string, unknown>)?.nationalId;
  const nationalId = typeof nationalIdValue === "string" ? nationalIdValue.trim() : "";
  const verifiedMobile = normalizeSaudiMobile(request.auth.token.phone_number);
  if (!nationalId || nationalId.length > 200 || !verifiedMobile) {
    throw new HttpsError("invalid-argument", "بيانات التحقق غير صحيحة.");
  }

  const database = getFirestore();
  const matches = await database.collection("trainees").where("nationalId", "==", nationalId).limit(2).get();
  if (matches.size !== 1) {
    throw new HttpsError("not-found", "تعذر مطابقة بيانات المتدرب.");
  }

  const trainee = matches.docs[0];
  const traineeData = trainee.data();
  if (normalizeSaudiMobile(traineeData.mobile) !== verifiedMobile) {
    throw new HttpsError("permission-denied", "تعذر مطابقة بيانات المتدرب.");
  }

  const name =
    (typeof traineeData.nameAr === "string" && traineeData.nameAr.trim()) ||
    (typeof traineeData.nameEn === "string" && traineeData.nameEn.trim()) ||
    "متدرب";
  const user = await getAuth().getUser(request.auth.uid);
  if (user.disabled) throw new HttpsError("permission-denied", "الحساب معطّل.");

  await database.doc(`users/${request.auth.uid}`).set({
    name,
    role: "trainee",
    disabled: false,
    phoneNumber: verifiedMobile,
    nationalId,
    traineeDocumentId: trainee.id,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    profile: {
      uid: request.auth.uid,
      name,
      nationalId,
      phoneNumber: verifiedMobile,
      traineeDocumentId: trainee.id,
    },
  };
});
