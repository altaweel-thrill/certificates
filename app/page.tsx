"use client";

import { ChangeEvent, DragEvent, FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import {
  type AdminProfile,
  changeAdminPassword,
  getAdminAuthError,
  getAdminPasswordError,
  signInAdmin,
} from "../lib/admin-auth";
import {
  createPlatformUser,
  deletePlatformUser,
  getPlatformUsersError,
  listPlatformUsers,
  type PlatformUser,
  type PlatformUserRole,
  setPlatformUserDisabled,
  setPlatformUserRole,
} from "../lib/platform-users";
import {
  parseCertificateImport,
  type CertificateImportResult,
} from "../lib/certificate-import";
import {
  getFirestoreImportError,
  importCertificatesToFirestore,
} from "../lib/firestore-import";
import {
  deleteCertificateFile,
  buildCertificateDownloadFileName,
  getCertificateDownload,
  getCertificateDownloadError,
  getCertificateDeleteError,
  getCertificateUploadError,
  isCertificateAlreadyUploadedError,
  uploadCertificateByFileName,
} from "../lib/certificate-upload";
import {
  type AdminDatabaseData,
  type DatabaseCertificate,
  type DatabaseCertificateFile,
  type DatabaseCourse,
  type DatabaseImport,
  type DatabaseTrainee,
  getAdminDatabaseError,
  loadAdminDatabaseData,
  loadAdminOverviewData,
} from "../lib/admin-database";
import { getDashboardStatsError, refreshDashboardStats } from "../lib/dashboard-stats";
import {
  type PlatformSession,
  observePlatformSession,
  signOutPlatform,
} from "../lib/platform-session";
import {
  activateTraineeSession,
  destroyTraineeRecaptcha,
  getTraineeAuthError,
  loadTraineePortal,
  resetTraineeRecaptcha,
  sendTraineeVerificationCode,
  type TraineePortalData,
} from "../lib/trainee-portal";
import { getTraineeAdminError, updateTraineeDetails, type UpdateTraineeInput } from "../lib/trainee-admin";
import { signInCompany, getCompanyAuthError } from "../lib/company-auth";
import { CompaniesView } from "./companies-view";
import { CompanyDashboard } from "./company-dashboard";

type Role = "trainee" | "company" | "admin";
type AdminView = "overview" | "courses" | "trainees" | "companies" | "users" | "certificates" | "imports" | "activity" | "settings";

const navItems: { id: AdminView; label: string; mark: string }[] = [
  { id: "overview", label: "نظرة عامة", mark: "01" },
  { id: "courses", label: "الدورات", mark: "02" },
  { id: "trainees", label: "المتدربون", mark: "03" },
  { id: "companies", label: "الشركات", mark: "04" },
  { id: "users", label: "المستخدمون والصلاحيات", mark: "05" },
  { id: "certificates", label: "الشهادات", mark: "06" },
  { id: "imports", label: "استيراد البيانات", mark: "07" },
  { id: "activity", label: "سجل النشاط", mark: "08" },
  { id: "settings", label: "الإعدادات", mark: "09" },
];

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("مكتمل") || status.includes("معتمد") || status === "نشطة" ? "success" : status.includes("انتظار") || status.includes("مراجعة") ? "warning" : "neutral";
  return <span className={`status-badge ${tone}`}><i aria-hidden="true" />{status}</span>;
}

function LoginScreen({ onLogin }: { onLogin: (session: PlatformSession) => void }) {
  const [role, setRole] = useState<Role>("trainee");
  const [identity, setIdentity] = useState("");
  const [mobile, setMobile] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [email, setEmail] = useState("admin@itti.edu.sa");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => destroyTraineeRecaptcha(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (role === "admin") {
        const profile = await signInAdmin(email, password);
        onLogin({ role: "admin", profile });
      } else if (role === "company") {
        const profile = await signInCompany(email, password);
        onLogin({ role: "company", profile });
      } else if (confirmation) {
        const profile = await activateTraineeSession(confirmation, verificationCode, identity);
        onLogin({ role: "trainee", profile });
      } else {
        if (!identity.trim()) throw new Error("أدخل رقم الهوية أو المعرّف المسجل.");
        setConfirmation(await sendTraineeVerificationCode(mobile));
      }
    } catch (authError) {
      setError(role === "admin" ? getAdminAuthError(authError) : role === "company" ? getCompanyAuthError(authError) : getTraineeAuthError(authError));
      if (role === "trainee" && !confirmation) resetTraineeRecaptcha();
      const errorCode = typeof authError === "object" && authError && "code" in authError ? String(authError.code) : "";
      if (confirmation && (errorCode.includes("permission-denied") || errorCode.includes("not-found"))) {
        setConfirmation(null);
        setVerificationCode("");
        resetTraineeRecaptcha();
      }
    } finally {
      setLoading(false);
    }
  }

  function changeRole(nextRole: Role) {
    setRole(nextRole);
    setError("");
    setPassword("");
    setVerificationCode("");
    setConfirmation(null);
    setEmail(nextRole === "admin" ? "admin@itti.edu.sa" : "");
    resetTraineeRecaptcha();
  }

  function editTraineeDetails() {
    setConfirmation(null);
    setVerificationCode("");
    setError("");
    resetTraineeRecaptcha();
  }

  return (
    <main className="login-shell">
      <a className="skip-link" href="#login-form">تجاوز إلى نموذج الدخول</a>
      <section className="login-brand" aria-label="نبذة عن المنصة">
        <div className="industrial-grid" aria-hidden="true" />
        <div className="brand-content">
          <div className="official-logo-panel login-official-logo">
            <img className="official-logo" src="/institute-logo.png" alt="معهد التقنيات الصناعية العالي للتدريب" />
          </div>
          <div className="brand-message">
            <p className="eyebrow light-text">بوابة رقمية موحدة</p>
            <h1>شهاداتك التدريبية،<br /><em>محفوظة وآمنة.</em></h1>
            <p>إدارة بيانات الدورات والشهادات، ووصول مباشر لكل متدرب إلى ملفاته المعتمدة.</p>
          </div>
          <div className="trust-row" aria-label="خصائص المنصة">
            <span>حماية بيانات الهوية</span>
            <span>ملفات PDF خاصة</span>
            <span>سجل عمليات كامل</span>
          </div>
        </div>
      </section>

      <section className="login-panel" id="login-form">
        <div className="official-logo-panel mobile-brand">
          <img className="official-logo" src="/institute-logo.png" alt="معهد التقنيات الصناعية العالي للتدريب" />
        </div>
        <div className="login-card">
          <p className="eyebrow">تسجيل الدخول</p>
          <h2>{role === "trainee" ? "مرحبًا بك في بوابة المتدرب" : role === "company" ? "الدخول إلى بوابة الشركة" : "الدخول إلى لوحة الإدارة"}</h2>
          <p className="subcopy">{role === "trainee" ? "أدخل بياناتك المطابقة لسجل المعهد للوصول إلى دوراتك." : role === "company" ? "استخدم حساب ممثل الشركة المعتمد لمتابعة موظفيك." : "استخدم حسابك الإداري المعتمد لإدارة المنصة."}</p>

          <div className="role-switch" role="tablist" aria-label="نوع الحساب">
            <button type="button" role="tab" aria-selected={role === "trainee"} className={role === "trainee" ? "active" : ""} onClick={() => changeRole("trainee")}>متدرب</button>
            <button type="button" role="tab" aria-selected={role === "company"} className={role === "company" ? "active" : ""} onClick={() => changeRole("company")}>شركة</button>
            <button type="button" role="tab" aria-selected={role === "admin"} className={role === "admin" ? "active" : ""} onClick={() => changeRole("admin")}>مسؤول المنصة</button>
          </div>

          <form onSubmit={submit}>
            {role === "trainee" ? (
              confirmation ? <>
                <div className="verification-summary"><span>تم إرسال رمز التحقق إلى</span><strong dir="ltr">{mobile}</strong><button type="button" onClick={editTraineeDetails}>تعديل البيانات</button></div>
                <label htmlFor="verification-code">رمز التحقق</label>
                <input id="verification-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required autoFocus />
                <p className="field-note">أدخل الرمز المكوّن من 6 أرقام المرسل عبر SMS.</p>
              </> : <>
                  <label htmlFor="national-id">رقم الهوية أو المعرّف</label>
                  <input id="national-id" autoComplete="off" value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="أدخل القيمة المسجلة لدى المعهد" required />
                  <label htmlFor="mobile">رقم الجوال المسجل</label>
                  <input id="mobile" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="05xxxxxxxx" required />
                  <p className="field-note">سيصل رمز SMS إلى الجوال المسجل. باستخدام الخدمة توافق على إرسال رقم الجوال للتحقق.</p>
                </>
            ) : (
              <>
                <label htmlFor="email">البريد الإلكتروني</label>
                <input id="email" type="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <label htmlFor="password">كلمة المرور</label>
                <input id="password" type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="أدخل كلمة المرور" required />
              </>
            )}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="primary-button full" type="submit" disabled={loading}>{loading ? "جارٍ التحقق..." : role === "trainee" ? confirmation ? "تأكيد الرمز والدخول" : "إرسال رمز التحقق" : role === "company" ? "دخول بوابة الشركة" : "دخول لوحة الإدارة"}</button>
            <div id="trainee-recaptcha" />
          </form>
          <p className="demo-help">
            {role === "admin"
              ? "يتطلب حسابًا يحمل صلاحية الإدارة."
              : role === "company"
                ? "الحساب يُنشأ من إدارة المعهد ويرتبط بالسجل التجاري للشركة."
              : "يجب أن يطابق رقم الهوية والجوال البيانات المسجلة في قواعد بيانات المعهد."}
          </p>
        </div>
        <p className="login-footer">الدعم الفني · سياسة الخصوصية · الإصدار 0.1</p>
      </section>
    </main>
  );
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join(" ") || "م";
}

function AdminSidebar({ active, setActive, onLogout, profile }: { active: AdminView; setActive: (view: AdminView) => void; onLogout: () => void; profile: AdminProfile }) {
  return (
    <aside className="sidebar">
      <div className="official-logo-panel sidebar-official-logo">
        <img className="official-logo" src="/institute-logo.png" alt="معهد التقنيات الصناعية العالي للتدريب" />
      </div>
      <nav aria-label="التنقل الرئيسي">
        {navItems.map((item) => (
          <button type="button" key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}>
            <span aria-hidden="true">{item.mark}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-profile">
        <span className="avatar">{getInitials(profile.name)}</span>
        <span><strong>{profile.name}</strong><small>{profile.email || "مدير النظام"}</small></span>
        <button type="button" onClick={onLogout}>خروج</button>
      </div>
    </aside>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <article className="metric-card">
      <span className={`metric-mark ${tone}`} aria-hidden="true" />
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DataMessage({ loading, error, empty, onRetry }: { loading: boolean; error: string; empty?: string; onRetry: () => void }) {
  if (loading) return <div className="empty-state" role="status"><strong>جارٍ تحميل البيانات من Firestore...</strong></div>;
  if (error) return <div className="empty-state" role="alert"><strong>{error}</strong><p><button type="button" className="secondary-button" onClick={onRetry}>إعادة المحاولة</button></p></div>;
  if (empty) return <div className="empty-state"><strong>{empty}</strong><p>ستظهر البيانات هنا بعد إضافتها أو استيرادها.</p></div>;
  return null;
}

function paginationItems(currentPage: number, totalPages: number): Array<number | string> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = [...new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const items: Array<number | string> = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) items.push(`ellipsis-${previous}-${page}`);
    items.push(page);
  });
  return items;
}

function importStatusLabel(status: DatabaseImport["status"]) {
  if (status === "completed") return "مكتمل";
  if (status === "failed") return "فشل";
  return "قيد المعالجة";
}

function formatDatabaseDate(timestamp: number) {
  if (!timestamp) return "الوقت غير متاح";
  return new Intl.DateTimeFormat("ar-SA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function Overview({ onImport, adminName, data, loading, error, onRetry }: { onImport: () => void; adminName: string; data: AdminDatabaseData | null; loading: boolean; error: string; onRetry: () => void }) {
  const firstName = adminName.trim().split(/\s+/)[0] || "مسؤول المنصة";
  const recentCourses = data?.courses.slice(0, 4) ?? [];
  const recentImports = data?.imports.slice(0, 4) ?? [];
  const metrics = data?.metrics;

  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">لوحة التشغيل</p><h1>صباح الخير، {firstName}</h1><p>إليك ملخص حالة الدورات والشهادات اليوم.</p></div>
        <div className="heading-actions"><button className="primary-button" type="button" onClick={onImport}>استيراد ملف Excel</button></div>
      </section>
      <section className="metrics-grid" aria-label="مؤشرات المنصة">
        <MetricCard label="الدورات النشطة" value={loading ? "—" : String(metrics?.activeCourses ?? 0)} detail={`${metrics?.totalCourses ?? 0} دورة مسجلة`} tone="slate" />
        <MetricCard label="إجمالي المتدربين" value={loading ? "—" : String(metrics?.totalTrainees ?? 0)} detail="حسب سجلات المتدربين" tone="blue" />
        <MetricCard label="الشهادات الصادرة" value={loading ? "—" : String(metrics?.issuedCertificates ?? 0)} detail="حسب أرقام الشهادات المسجلة" tone="green" />
        <MetricCard label="بانتظار ملف PDF" value={loading ? "—" : String(metrics?.pendingCertificates ?? 0)} detail="تحتاج إلى رفع ملف الشهادة" tone="orange" />
      </section>
      {loading || error ? <section className="panel data-message-panel"><DataMessage loading={loading} error={error} onRetry={onRetry} /></section> : null}
      <section className="dashboard-grid">
        <article className="panel courses-panel">
          <div className="panel-head"><div><h2>الدورات الأخيرة</h2><p>متابعة جاهزية بيانات وشهادات كل دورة</p></div></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>الدورة</th><th>التاريخ</th><th>المتدربون</th><th>جاهزية الشهادات</th><th>الحالة</th></tr></thead>
              <tbody>{recentCourses.map((course) => <tr key={course.id}><td><strong>{course.name}</strong><small>{course.code}</small></td><td>{course.date}</td><td>{course.trainees}</td><td><div className="progress-cell"><span><i style={{ width: `${course.completion}%` }} /></span><b>{course.completion}%</b></div></td><td><StatusBadge status={course.status} /></td></tr>)}</tbody>
            </table>
          </div>
          {!loading && !error && !recentCourses.length ? <DataMessage loading={false} error="" empty="لا توجد دورات مسجلة" onRetry={onRetry} /> : null}
        </article>
        <aside className="panel activity-panel">
          <div className="panel-head"><div><h2>آخر عمليات الاستيراد</h2><p>مباشرة من سجل Firestore</p></div></div>
          <div className="activity-list">{recentImports.map((item, index) => <div className="activity-item" key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.fileName}</strong><p>{item.completedRows} من {item.totalRows} سجلًا · {importStatusLabel(item.status)}</p><small>{formatDatabaseDate(item.createdAt)}</small></div></div>)}</div>
          {!loading && !error && !recentImports.length ? <DataMessage loading={false} error="" empty="لا توجد عمليات استيراد" onRetry={onRetry} /> : null}
        </aside>
      </section>
    </>
  );
}

function CoursesView({ courses, loading, error, onRetry }: { courses: DatabaseCourse[]; loading: boolean; error: string; onRetry: () => void }) {
  return (
    <section className="panel full-panel">
      <div className="panel-head"><div><h2>إدارة الدورات</h2><p>تُضاف الدورات والمتدربون عن طريق استيراد ملف Excel المعتمد</p></div></div>
      <DataMessage loading={loading} error={error} empty={!courses.length ? "لا توجد دورات مسجلة" : undefined} onRetry={onRetry} />
      {!loading && !error ? <div className="course-grid">{courses.map((course) => <article className="course-admin-card" key={course.id}><div className="course-code">{course.code}</div><StatusBadge status={course.status} /><h3>{course.name}</h3><p>{course.date}</p><dl><div><dt>المتدربون</dt><dd>{course.trainees}</dd></div><div><dt>الساعات</dt><dd>{course.hours || "—"}</dd></div><div><dt>الجاهزية</dt><dd>{course.completion}%</dd></div></dl><div className="wide-progress"><i style={{ width: `${course.completion}%` }} /></div></article>)}</div> : null}
    </section>
  );
}

function TraineesView({ trainees, certificates, loading, error, onRetry, onChanged, onMessage }: {
  trainees: DatabaseTrainee[];
  certificates: DatabaseCertificate[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onChanged: () => void | Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTraineeId, setSelectedTraineeId] = useState("");
  const [downloadingKey, setDownloadingKey] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [editForm, setEditForm] = useState<Omit<UpdateTraineeInput, "traineeDocumentId">>({
    nameAr: "",
    nameEn: "",
    nationalId: "",
    mobile: "",
    traineeId: "",
    nationality: "",
    gender: "",
    dateOfBirth: "",
  });
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => trainees.filter((trainee) => `${trainee.name} ${trainee.nameEn} ${trainee.nationalId} ${trainee.mobile} ${trainee.courses.join(" ")}`.toLocaleLowerCase().includes(deferredSearch.trim().toLocaleLowerCase())), [deferredSearch, trainees]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const firstVisibleIndex = filtered.length ? (activePage - 1) * pageSize : 0;
  const visibleTrainees = filtered.slice(firstVisibleIndex, firstVisibleIndex + pageSize);
  const visibleEnd = Math.min(firstVisibleIndex + pageSize, filtered.length);
  const pageItems = useMemo(() => paginationItems(activePage, totalPages), [activePage, totalPages]);
  const selectedTrainee = trainees.find((trainee) => trainee.id === selectedTraineeId) ?? null;
  const selectedCertificates = useMemo(
    () => certificates.filter((certificate) => certificate.traineeDocumentId === selectedTraineeId),
    [certificates, selectedTraineeId],
  );
  const availableFiles = selectedCertificates.reduce((total, certificate) => total + certificate.files.length, 0);

  function openEdit() {
    if (!selectedTrainee) return;
    setEditForm({
      nameAr: selectedTrainee.nameAr,
      nameEn: selectedTrainee.nameEn,
      nationalId: selectedTrainee.nationalId === "غير متاح" ? "" : selectedTrainee.nationalId,
      mobile: selectedTrainee.mobile,
      traineeId: selectedTrainee.traineeId,
      nationality: selectedTrainee.nationality === "غير محددة" ? "" : selectedTrainee.nationality,
      gender: selectedTrainee.gender === "غير محدد" ? "" : selectedTrainee.gender,
      dateOfBirth: selectedTrainee.dateOfBirthValue,
    });
    setFormError("");
    setShowEdit(true);
  }

  function changeEditField(field: keyof typeof editForm, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  function closeEdit() {
    if (saving) return;
    setShowEdit(false);
    setFormError("");
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTrainee) return;
    setSaving(true);
    setFormError("");
    try {
      const result = await updateTraineeDetails({ traineeDocumentId: selectedTrainee.id, ...editForm });
      setShowEdit(false);
      await onChanged();
      setSelectedTraineeId(result.traineeDocumentId);
      onMessage("تم تحديث بيانات المتدرب");
    } catch (requestError) {
      setFormError(getTraineeAdminError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function download(certificate: DatabaseCertificate, file: DatabaseCertificateFile) {
    if (!selectedTrainee) return;
    const key = `${certificate.id}-${file.type}`;
    setDownloadingKey(key);
    try {
      await downloadCertificateFile(certificate, file, selectedTrainee.nameEn);
      onMessage(`بدأ تنزيل ${file.label}`);
    } catch (downloadError) {
      onMessage(getCertificateDownloadError(downloadError));
    } finally {
      setDownloadingKey("");
    }
  }

  if (selectedTrainee) {
    return (
      <>
      <section className="company-detail-page trainee-detail-page">
        <div className="company-detail-toolbar">
          <button type="button" className="text-button company-back-button" onClick={() => setSelectedTraineeId("")}>العودة إلى المتدربين</button>
          <div className="heading-actions"><button type="button" className="secondary-button" onClick={onRetry} disabled={loading}>{loading ? "جارٍ التحديث..." : "تحديث البيانات"}</button><button type="button" className="primary-button" onClick={openEdit}>تعديل بيانات المتدرب</button></div>
        </div>

        <header className="company-detail-hero trainee-detail-hero">
          <div>
            <p className="eyebrow">صفحة المتدرب</p>
            <h1>{selectedTrainee.name}</h1>
            <p dir="ltr">{selectedTrainee.nameEn || "English name not available"}</p>
          </div>
          <StatusBadge status={selectedTrainee.state} />
        </header>

        {error ? <p className="auth-error" role="alert">{error}</p> : null}

        <section className="metrics-grid company-detail-metrics">
          <article className="metric-card"><p>الدورات</p><strong>{selectedTrainee.courses.length}</strong><small>الدورات المرتبطة بالمتدرب</small></article>
          <article className="metric-card"><p>سجلات الشهادات</p><strong>{selectedCertificates.length}</strong><small>وفق بيانات الدورات</small></article>
          <article className="metric-card"><p>ملفات PDF</p><strong>{availableFiles}</strong><small>ملفات متاحة للتنزيل</small></article>
        </section>

        <section className="panel company-detail-section trainee-profile-section">
          <div className="panel-head"><div><h2>بيانات المتدرب</h2><p>البيانات المسجلة في قواعد بيانات المعهد</p></div></div>
          <dl className="trainee-detail-info-grid">
            <div><dt>رقم الهوية أو المعرّف</dt><dd dir="ltr">{selectedTrainee.nationalId}</dd></div>
            <div><dt>رقم الجوال</dt><dd dir="ltr">{selectedTrainee.mobile || "—"}</dd></div>
            <div><dt>رقم المتدرب</dt><dd dir="ltr">{selectedTrainee.traineeId || "—"}</dd></div>
            <div><dt>الجنسية</dt><dd>{selectedTrainee.nationality}</dd></div>
            <div><dt>الجنس</dt><dd>{selectedTrainee.gender}</dd></div>
            <div><dt>تاريخ الميلاد</dt><dd>{selectedTrainee.dateOfBirth}</dd></div>
          </dl>
        </section>

        <section className="panel company-detail-section">
          <div className="panel-head"><div><h2>الدورات</h2><p>جميع الدورات المرتبطة بسجل المتدرب</p></div></div>
          {selectedTrainee.courses.length ? <div className="trainee-detail-courses">{selectedTrainee.courses.map((course, index) => <article key={`${course}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><strong>{course}</strong></article>)}</div> : <div className="empty-state"><strong>لا توجد دورات مرتبطة</strong><p>ستظهر الدورات هنا بعد استيراد بياناتها من ملف Excel.</p></div>}
        </section>

        <section className="panel company-detail-section">
          <div className="panel-head"><div><h2>الشهادات</h2><p>الشهادات المحلية والدولية والبطاقات المتاحة للمتدرب</p></div></div>
          {selectedCertificates.length ? <div className="trainee-certificates-list">{selectedCertificates.map((certificate) => <article className="trainee-certificate-record" key={certificate.id}>
            <div className="trainee-certificate-summary"><span className="pdf-mark">PDF</span><div><strong>شهادة رقم <span dir="ltr">{certificate.number}</span></strong><p>{certificate.course} · {certificate.issueDate}</p></div><StatusBadge status={certificate.status} /></div>
            {certificate.files.length ? <div className="trainee-certificate-files">{certificate.files.map((file) => {
              const key = `${certificate.id}-${file.type}`;
              return <button type="button" className="secondary-button" key={key} onClick={() => void download(certificate, file)} disabled={Boolean(downloadingKey)}>{downloadingKey === key ? "جارٍ التنزيل..." : `تنزيل ${file.label}`}</button>;
            })}</div> : <p className="trainee-file-empty">لم يُرفع ملف PDF لهذه الشهادة بعد.</p>}
          </article>)}</div> : <div className="empty-state"><strong>لا توجد شهادات مسجلة</strong><p>ستظهر الشهادات هنا عند ربطها برقم الشهادة ورفع ملفات PDF.</p></div>}
        </section>
      </section>
      {showEdit ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEdit(); }}><section className="modal trainee-edit-modal" role="dialog" aria-modal="true" aria-labelledby="trainee-edit-title"><div className="modal-head"><div><p className="eyebrow">صفحة المتدرب</p><h2 id="trainee-edit-title">تعديل بيانات المتدرب</h2></div><button type="button" className="close-button" onClick={closeEdit} disabled={saving}>إغلاق</button></div><form onSubmit={submitEdit}>
        <div className="field-grid"><div><label htmlFor="trainee-edit-name-ar">الاسم بالعربية</label><input id="trainee-edit-name-ar" value={editForm.nameAr} onChange={(event) => changeEditField("nameAr", event.target.value)} maxLength={250} autoFocus /></div><div><label htmlFor="trainee-edit-name-en">الاسم بالإنجليزية</label><input id="trainee-edit-name-en" dir="ltr" value={editForm.nameEn} onChange={(event) => changeEditField("nameEn", event.target.value)} maxLength={250} /></div></div>
        <div className="field-grid"><div><label htmlFor="trainee-edit-national-id">رقم الهوية أو المعرّف</label><input id="trainee-edit-national-id" dir="ltr" value={editForm.nationalId} onChange={(event) => changeEditField("nationalId", event.target.value)} maxLength={200} required /></div><div><label htmlFor="trainee-edit-mobile">رقم الجوال</label><input id="trainee-edit-mobile" type="tel" dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" value={editForm.mobile} onChange={(event) => changeEditField("mobile", event.target.value)} maxLength={30} /></div></div>
        <div className="field-grid"><div><label htmlFor="trainee-edit-id">رقم المتدرب</label><input id="trainee-edit-id" dir="ltr" value={editForm.traineeId} onChange={(event) => changeEditField("traineeId", event.target.value)} maxLength={100} /></div><div><label htmlFor="trainee-edit-nationality">الجنسية</label><input id="trainee-edit-nationality" value={editForm.nationality} onChange={(event) => changeEditField("nationality", event.target.value)} maxLength={100} /></div></div>
        <div className="field-grid"><div><label htmlFor="trainee-edit-gender">الجنس</label><input id="trainee-edit-gender" value={editForm.gender} onChange={(event) => changeEditField("gender", event.target.value)} maxLength={50} /></div><div><label htmlFor="trainee-edit-date">تاريخ الميلاد</label><input id="trainee-edit-date" type="date" dir="ltr" value={editForm.dateOfBirth} onChange={(event) => changeEditField("dateOfBirth", event.target.value)} max={new Date().toISOString().slice(0, 10)} /></div></div>
        <p className="field-note trainee-edit-note">عند تغيير رقم الهوية أو المعرّف، ستنتقل روابط الدورات والشهادات وحساب المتدرب تلقائيًا إلى السجل الجديد.</p>
        {formError ? <p className="auth-error" role="alert">{formError}</p> : null}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeEdit} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جارٍ حفظ التعديلات..." : "حفظ التعديلات"}</button></div>
      </form></section></div> : null}
      </>
    );
  }

  return (
    <section className="panel full-panel">
      <div className="panel-head stacked-mobile"><div><h2>سجل المتدربين</h2><p>جميع المتدربين المسجلين في المنصة</p></div><div className="trainee-table-tools"><label className="page-size-field" htmlFor="trainee-page-size"><span>عرض</span><select id="trainee-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1); }}><option value={25}>25 سجلًا</option><option value={50}>50 سجلًا</option><option value={100}>100 سجل</option><option value={250}>250 سجلًا</option></select></label><label className="search-field" htmlFor="trainee-search"><span>بحث</span><input id="trainee-search" inputMode="search" value={search} onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="اكتب الاسم أو رقم الهوية..." /></label></div></div>
      <DataMessage loading={loading} error={error} empty={!trainees.length ? "لا يوجد متدربون مسجلون" : undefined} onRetry={onRetry} />
      {!loading && !error && trainees.length ? <div className="table-scroll">
        <table><thead><tr><th>المتدرب</th><th>رقم الهوية</th><th>رقم الجوال</th><th>الدورات</th><th>الشهادات</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{visibleTrainees.map((trainee) => <tr key={trainee.id}><td><button type="button" className="company-name-button trainee-name-button" onClick={() => setSelectedTraineeId(trainee.id)}><strong>{trainee.name}</strong><small dir="ltr">{trainee.nameEn || "عرض صفحة المتدرب"}</small></button></td><td dir="ltr">{trainee.nationalId}</td><td dir="ltr">{trainee.mobile || "—"}</td><td>{trainee.courses.join("، ") || "—"}</td><td>{trainee.certificates}</td><td><StatusBadge status={trainee.state} /></td><td><button type="button" className="secondary-button table-open-button" onClick={() => setSelectedTraineeId(trainee.id)}>فتح</button></td></tr>)}</tbody></table>
      </div> : null}
      {!loading && !error && trainees.length > 0 && !filtered.length ? <div className="empty-state"><strong>لا توجد نتائج مطابقة</strong><p>جرّب البحث بجزء من الاسم أو رقم الهوية.</p></div> : null}
      {!loading && !error && filtered.length > 0 ? <nav className="trainee-pagination" aria-label="صفحات سجل المتدربين"><p>عرض <strong>{firstVisibleIndex + 1}–{visibleEnd}</strong> من <strong>{filtered.length}</strong>{search.trim() ? ` نتيجة · من أصل ${trainees.length} متدربًا` : " متدربًا"}</p><div className="pagination-controls"><button type="button" className="pagination-direction" onClick={() => setCurrentPage(Math.max(1, activePage - 1))} disabled={activePage === 1} aria-label="الصفحة السابقة">السابق</button><div className="pagination-pages">{pageItems.map((item) => typeof item === "number" ? <button type="button" key={item} className={item === activePage ? "active" : ""} aria-current={item === activePage ? "page" : undefined} aria-label={`الصفحة ${item}`} onClick={() => setCurrentPage(item)}>{item}</button> : <span key={item} aria-hidden="true">…</span>)}</div><button type="button" className="pagination-direction" onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))} disabled={activePage === totalPages} aria-label="الصفحة التالية">التالي</button></div></nav> : null}
    </section>
  );
}

const userRoleLabels: Record<PlatformUserRole, string> = {
  trainee: "متدرب",
  company_admin: "ممثل شركة",
  admin: "مسؤول",
  super_admin: "مسؤول أعلى",
};

function formatUserDate(value: string) {
  if (!value) return "لم يسجل الدخول";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير متاح";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function UsersView({ currentUser }: { currentUser: AdminProfile }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingUid, setWorkingUid] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<PlatformUserRole>("trainee");

  const refreshUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listPlatformUsers();
      setUsers(result.users);
    } catch (requestError) {
      setError(getPlatformUsersError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void listPlatformUsers()
      .then((result) => {
        if (active) setUsers(result.users);
      })
      .catch((requestError) => {
        if (active) setError(getPlatformUsersError(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function submitNewUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");

    try {
      const result = await createPlatformUser({ name, email, password, role });
      setUsers((current) => [result.user, ...current]);
      setName("");
      setEmail("");
      setPassword("");
      setRole("trainee");
      setShowCreate(false);
    } catch (requestError) {
      setError(getPlatformUsersError(requestError));
    } finally {
      setCreating(false);
    }
  }

  async function changeDisabled(user: PlatformUser) {
    setWorkingUid(user.uid);
    setError("");
    try {
      await setPlatformUserDisabled(user.uid, !user.disabled);
      setUsers((current) => current.map((item) =>
        item.uid === user.uid ? { ...item, disabled: !item.disabled } : item,
      ));
    } catch (requestError) {
      setError(getPlatformUsersError(requestError));
    } finally {
      setWorkingUid("");
    }
  }

  async function changeRole(user: PlatformUser, nextRole: PlatformUserRole) {
    setWorkingUid(user.uid);
    setError("");
    try {
      await setPlatformUserRole(user.uid, nextRole);
      setUsers((current) => current.map((item) =>
        item.uid === user.uid ? { ...item, role: nextRole } : item,
      ));
    } catch (requestError) {
      setError(getPlatformUsersError(requestError));
    } finally {
      setWorkingUid("");
    }
  }

  async function removeUser(user: PlatformUser) {
    const confirmed = window.confirm(`سيتم حذف حساب ${user.name} نهائياً. هل تريد المتابعة؟`);
    if (!confirmed) return;

    setWorkingUid(user.uid);
    setError("");
    try {
      await deletePlatformUser(user.uid);
      setUsers((current) => current.filter((item) => item.uid !== user.uid));
    } catch (requestError) {
      setError(getPlatformUsersError(requestError));
    } finally {
      setWorkingUid("");
    }
  }

  function isLocked(user: PlatformUser) {
    return user.uid === currentUser.uid ||
      (user.role === "super_admin" && currentUser.role !== "super_admin");
  }

  return (
    <>
      <section className="panel full-panel users-panel">
        <div className="panel-head">
          <div><h2>المستخدمون والصلاحيات</h2><p>إنشاء الحسابات والتحكم في صلاحيات الوصول وحالة كل حساب</p></div>
          <div className="heading-actions">
            <button type="button" className="secondary-button" onClick={() => void refreshUsers()} disabled={loading}>تحديث</button>
            <button type="button" className="primary-button" onClick={() => { setError(""); setShowCreate(true); }}>إضافة مستخدم</button>
          </div>
        </div>

        {error ? <p className="auth-error users-error" role="alert">{error}</p> : null}

        <div className="table-scroll">
          <table>
            <thead><tr><th>المستخدم</th><th>الصلاحية</th><th>الحالة</th><th>آخر دخول</th><th>الإجراءات</th></tr></thead>
            <tbody>
              {users.map((user) => {
                const locked = isLocked(user);
                const working = workingUid === user.uid;
                return (
                  <tr key={user.uid}>
                    <td><strong>{user.name}</strong><small dir="ltr">{user.email}</small></td>
                    <td>
                      <select
                        className="role-select"
                        aria-label={`صلاحية ${user.name}`}
                        value={user.role}
                        disabled={locked || working || user.role === "company_admin"}
                        onChange={(event) => void changeRole(user, event.target.value as PlatformUserRole)}
                      >
                        <option value="trainee">متدرب</option>
                        {user.role === "company_admin" ? <option value="company_admin">ممثل شركة</option> : null}
                        <option value="admin">مسؤول</option>
                        {currentUser.role === "super_admin" ? <option value="super_admin">مسؤول أعلى</option> : null}
                      </select>
                    </td>
                    <td><StatusBadge status={user.disabled ? "معطّل" : "نشط"} /></td>
                    <td>{formatUserDate(user.lastSignInAt)}</td>
                    <td>
                      {user.uid === currentUser.uid ? (
                        <span className="current-user-label">الحساب الحالي</span>
                      ) : (
                        <div className="user-actions">
                          <button type="button" className="secondary-button" disabled={locked || working} onClick={() => void changeDisabled(user)}>
                            {working ? "جارٍ الحفظ..." : user.disabled ? "تفعيل" : "تعطيل"}
                          </button>
                          <button type="button" className="danger-button" disabled={locked || working} onClick={() => void removeUser(user)}>حذف</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loading ? <div className="empty-state"><strong>جارٍ تحميل المستخدمين...</strong></div> : null}
        {!loading && !users.length ? <div className="empty-state"><strong>لا يوجد مستخدمون</strong><p>أضف أول مستخدم للمنصة.</p></div> : null}
      </section>

      {showCreate ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
            <div className="modal-head"><div><p className="eyebrow">إدارة الحسابات</p><h2 id="create-user-title">إضافة مستخدم جديد</h2></div><button type="button" className="close-button" onClick={() => setShowCreate(false)}>إغلاق</button></div>
            <form onSubmit={submitNewUser}>
              <label htmlFor="new-user-name">اسم المستخدم</label>
              <input id="new-user-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
              <label htmlFor="new-user-email">البريد الإلكتروني</label>
              <input id="new-user-email" type="email" dir="ltr" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <label htmlFor="new-user-password">كلمة المرور المؤقتة</label>
              <input id="new-user-password" type="password" dir="ltr" minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <p className="field-note">ستُنشأ بيانات الدخول مباشرة في نظام حسابات المنصة.</p>
              <label htmlFor="new-user-role">الصلاحية</label>
              <select id="new-user-role" value={role} onChange={(event) => setRole(event.target.value as PlatformUserRole)}>
                <option value="trainee">{userRoleLabels.trainee}</option>
                <option value="admin">{userRoleLabels.admin}</option>
                {currentUser.role === "super_admin" ? <option value="super_admin">{userRoleLabels.super_admin}</option> : null}
              </select>
              <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>إلغاء</button><button type="submit" className="primary-button" disabled={creating}>{creating ? "جارٍ الإنشاء..." : "إنشاء المستخدم"}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

async function downloadCertificateFile(certificate: Pick<DatabaseCertificate, "number">, file: DatabaseCertificateFile, traineeNameEn = "") {
  const fileName = buildCertificateDownloadFileName(traineeNameEn, certificate.number);
  const download = await getCertificateDownload(file.storagePath, file.downloadUrl, fileName);
  const anchor = document.createElement("a");
  anchor.href = download.url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(download.revoke, 60_000);
}

function CertificatesView({ certificates, loading, error, onRetry, onUpload, onMessage, onDataChanged }: { certificates: DatabaseCertificate[]; loading: boolean; error: string; onRetry: () => void; onUpload: () => void; onMessage: (message: string) => void; onDataChanged: () => void | Promise<void> }) {
  const [downloadingKey, setDownloadingKey] = useState("");
  const [deletingKey, setDeletingKey] = useState("");

  async function download(certificate: DatabaseCertificate, file: DatabaseCertificateFile) {
    const downloadKey = `${certificate.id}-${file.type}`;
    setDownloadingKey(downloadKey);
    try {
      await downloadCertificateFile(certificate, file, certificate.ownerEn);
      onMessage(`بدأ تنزيل ${file.label}`);
    } catch (downloadError) {
      onMessage(getCertificateDownloadError(downloadError));
    } finally {
      setDownloadingKey("");
    }
  }

  async function removeFile(certificate: DatabaseCertificate, file: DatabaseCertificateFile) {
    const key = `${certificate.id}-${file.type}`;
    const prefix = file.type === "international" ? "i_" : file.type === "card" ? "c_" : "";
    const replacementFileName = `${prefix}${certificate.number}.pdf`;
    const confirmed = window.confirm(`سيتم حذف ${file.label} رقم ${certificate.number}. سيبقى سجل الشهادة ويمكن رفع ملف بديل باسم ${replacementFileName}. هل تريد المتابعة؟`);
    if (!confirmed) return;

    setDeletingKey(key);
    try {
      await deleteCertificateFile(certificate.id, file);
      await onDataChanged();
      onMessage(`تم حذف ${file.label}. يمكنك رفع البديل باسم ${replacementFileName}`);
    } catch (deleteError) {
      onMessage(getCertificateDeleteError(deleteError));
    } finally {
      setDeletingKey("");
    }
  }

  return (
    <section className="panel full-panel">
      <div className="panel-head"><div><h2>مستودع الشهادات</h2><p>ملفات PDF الخاصة المرتبطة بسجلات المتدربين</p></div><button type="button" className="primary-button" onClick={onUpload}>رفع شهادة PDF</button></div>
      <DataMessage loading={loading} error={error} empty={!certificates.length ? "لا توجد شهادات مسجلة" : undefined} onRetry={onRetry} />
      {!loading && !error ? <div className="document-list">{certificates.flatMap((certificate) => certificate.files.length ? certificate.files.map((file) => {
        const downloadKey = `${certificate.id}-${file.type}`;
        const isDownloading = downloadingKey === downloadKey;
        const isDeleting = deletingKey === downloadKey;
        const working = Boolean(downloadingKey || deletingKey);
        return <article key={downloadKey}><span className="pdf-mark">PDF</span><div><strong>{file.label} · رقم {certificate.number}</strong><p>{certificate.owner} · {certificate.course} · {certificate.issueDate}</p></div><StatusBadge status="متاحة للتنزيل" /><div className="document-actions"><button type="button" className="secondary-button" onClick={() => void download(certificate, file)} disabled={working}>{isDownloading ? "جارٍ التنزيل..." : "تنزيل"}</button><button type="button" className="danger-button" onClick={() => void removeFile(certificate, file)} disabled={working}>{isDeleting ? "جارٍ الحذف..." : "حذف الملف"}</button></div></article>;
      }) : [<article key={`${certificate.id}-empty`}><span className="pdf-mark">PDF</span><div><strong>الشهادة المحلية · رقم {certificate.number}</strong><p>{certificate.owner} · {certificate.course} · {certificate.issueDate}</p></div><StatusBadge status="بانتظار ملف PDF" /><button type="button" className="secondary-button" disabled>لا يوجد ملف</button></article>])}</div> : null}
    </section>
  );
}

function ImportsView({ imports, loading, error, onRetry, onImport }: { imports: DatabaseImport[]; loading: boolean; error: string; onRetry: () => void; onImport: () => void }) {
  return (
    <section className="panel full-panel import-page">
      <div className="panel-head"><div><h2>استيراد بيانات الدورات والمتدربين</h2><p>يتم ربط الموظف بشركته باستخدام رقم السجل التجاري في عمود CrNumber</p></div></div>
      <button type="button" className="drop-zone" onClick={onImport}><span className="upload-symbol" aria-hidden="true">XLSX</span><strong>اختر ملف Excel لبدء الاستيراد</strong><small>تتم مراجعة البيانات وعرض الأخطاء قبل الحفظ النهائي</small></button>
      <DataMessage loading={loading} error={error} empty={!imports.length ? "لا توجد عمليات استيراد سابقة" : undefined} onRetry={onRetry} />
      {!loading && !error && imports.length ? <div className="import-history"><h3>آخر عمليات الاستيراد</h3>{imports.map((item) => <div key={item.id}><span className="file-chip">XLSX</span><p><strong>{item.fileName}</strong><small>{item.completedRows} من {item.totalRows} سجلًا · {item.importedByEmail || "مسؤول المنصة"} · {formatDatabaseDate(item.createdAt)}</small></p><StatusBadge status={importStatusLabel(item.status)} /></div>)}</div> : null}
    </section>
  );
}

function PasswordField({ id, label, value, autoComplete, autoFocus, onChange }: { id: string; label: string; value: string; autoComplete: "current-password" | "new-password"; autoFocus?: boolean; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return <><label htmlFor={id}>{label}</label><div className="password-field"><input id={id} type={visible ? "text" : "password"} dir="ltr" autoComplete={autoComplete} minLength={id === "current-admin-password" ? undefined : 8} value={value} onChange={(event) => onChange(event.target.value)} required autoFocus={autoFocus} /><button type="button" onClick={() => setVisible((current) => !current)} aria-label={`${visible ? "إخفاء" : "إظهار"} ${label}`} aria-pressed={visible}>{visible ? "إخفاء" : "إظهار"}</button></div></>;
}

function SettingsView({ profile, onSuccess }: { profile: AdminProfile; onSuccess: (message: string) => void }) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  function closePasswordModal() {
    if (savingPassword) return;
    setShowPasswordModal(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (newPassword.length < 8) {
      setPasswordError("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("تأكيد كلمة المرور الجديدة غير مطابق.");
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError("اختر كلمة مرور جديدة مختلفة عن الحالية.");
      return;
    }

    setSavingPassword(true);
    try {
      await changeAdminPassword(currentPassword, newPassword);
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess("تم تغيير كلمة المرور بنجاح.");
    } catch (changeError) {
      setPasswordError(getAdminPasswordError(changeError));
    } finally {
      setSavingPassword(false);
    }
  }

  return <>
    <section className="panel full-panel">
      <div className="panel-head"><div><h2>إعدادات المنصة</h2><p>بيانات المعهد وسياسات الحسابات والتنزيل</p></div></div>
      <div className="settings-grid">
        <article><h3>بيانات الجهة</h3><label htmlFor="institute-name">اسم المعهد</label><input id="institute-name" defaultValue="معهد التقنيات الصناعية العالي للتدريب" /><label htmlFor="support-email">بريد الدعم</label><input id="support-email" dir="ltr" defaultValue="support@itti.edu.sa" /></article>
        <article><h3>سياسة الشهادات</h3><label className="toggle-row"><span><strong>السماح بتنزيل المعتمد فقط</strong><small>لن يرى المتدرب الملفات قيد المراجعة</small></span><input type="checkbox" defaultChecked /></label><label className="toggle-row"><span><strong>تسجيل عمليات التنزيل</strong><small>حفظ المستخدم والوقت والملف</small></span><input type="checkbox" defaultChecked /></label></article>
        <article className="security-settings-card"><div><h3>أمان الحساب</h3><p>غيّر كلمة مرور الحساب الإداري <strong dir="ltr">{profile.email}</strong>.</p></div><button type="button" className="secondary-button" onClick={() => { setPasswordError(""); setShowPasswordModal(true); }}>تغيير كلمة المرور</button></article>
      </div>
      <button type="button" className="primary-button">حفظ التغييرات</button>
    </section>

    {showPasswordModal ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePasswordModal(); }}>
      <section className="modal password-modal" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <div className="modal-head"><div><p className="eyebrow">أمان الحساب</p><h2 id="change-password-title">تغيير كلمة المرور</h2></div><button type="button" className="close-button" onClick={closePasswordModal} disabled={savingPassword}>إغلاق</button></div>
        <form onSubmit={submitPassword}>
          <PasswordField id="current-admin-password" label="كلمة المرور الحالية" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} autoFocus />
          <PasswordField id="new-admin-password" label="كلمة المرور الجديدة" autoComplete="new-password" value={newPassword} onChange={setNewPassword} />
          <p className="field-note password-requirement">استخدم 8 أحرف على الأقل، ويفضّل الجمع بين الأحرف والأرقام والرموز.</p>
          <PasswordField id="confirm-admin-password" label="تأكيد كلمة المرور الجديدة" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} />
          {passwordError ? <p className="auth-error" role="alert">{passwordError}</p> : null}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={closePasswordModal} disabled={savingPassword}>إلغاء</button><button type="submit" className="primary-button" disabled={savingPassword}>{savingPassword ? "جارٍ التغيير..." : "تغيير كلمة المرور"}</button></div>
        </form>
      </section>
    </div> : null}
  </>;
}

function ActivityView({ imports, loading, error, onRetry }: { imports: DatabaseImport[]; loading: boolean; error: string; onRetry: () => void }) {
  return <section className="panel full-panel"><div className="panel-head"><div><h2>سجل النشاط</h2><p>عمليات الاستيراد المسجلة في قاعدة البيانات</p></div></div><DataMessage loading={loading} error={error} empty={!imports.length ? "لا توجد نشاطات مسجلة" : undefined} onRetry={onRetry} />{!loading && !error ? <div className="activity-list wide">{imports.map((item, index) => <div className="activity-item" key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.fileName}</strong><p>{item.completedRows} من {item.totalRows} سجلًا · {importStatusLabel(item.status)}</p><small>{formatDatabaseDate(item.createdAt)}</small></div></div>)}</div> : null}</section>;
}

function Modal({ type, onClose, onSuccess, onDataChanged }: { type: "import" | "upload"; onClose: () => void; onSuccess: (message: string) => void | Promise<void>; onDataChanged: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [certificateFiles, setCertificateFiles] = useState<File[]>([]);
  const [importResult, setImportResult] = useState<CertificateImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ completed: 0, total: 0 });
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, percentage: 0 });
  const titles = { import: "استيراد ملف Excel", upload: "رفع شهادة جديدة" };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (type === "import") {
      if (!file || !importResult || importResult.errors.length) {
        setImportError("يجب معالجة الأخطاء الحرجة قبل متابعة الاستيراد.");
        return;
      }

      setSaving(true);
      setImportError("");
      setSaveProgress({ completed: 0, total: importResult.records.length });
      try {
        const result = await importCertificatesToFirestore(
          importResult.records,
          file.name,
          (completed, total) => setSaveProgress({ completed, total }),
        );
        await onSuccess(`تم حفظ ${result.importedRows} سجلًا في Firestore بنجاح`);
      } catch (error) {
        setImportError(getFirestoreImportError(error));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!certificateFiles.length) {
      setImportError("اختر ملف PDF واحدًا على الأقل.");
      return;
    }
    setSaving(true);
    setImportError("");
    setUploadProgress({ current: 1, total: certificateFiles.length, percentage: 0 });
    const failures: Array<{ file: File; message: string }> = [];
    const duplicates: File[] = [];
    let successfulUploads = 0;

    for (let index = 0; index < certificateFiles.length; index += 1) {
      const certificateFile = certificateFiles[index];
      setUploadProgress({ current: index + 1, total: certificateFiles.length, percentage: 0 });
      try {
        await uploadCertificateByFileName(certificateFile, (percentage) => {
          setUploadProgress({ current: index + 1, total: certificateFiles.length, percentage });
        });
        successfulUploads += 1;
      } catch (error) {
        if (isCertificateAlreadyUploadedError(error)) {
          duplicates.push(certificateFile);
        } else {
          failures.push({ file: certificateFile, message: getCertificateUploadError(error) });
        }
      }
    }

    setSaving(false);
    if (failures.length) {
      if (successfulUploads) await onDataChanged();
      setCertificateFiles(failures.map((failure) => failure.file));
      const details = failures.slice(0, 3).map((failure) => `${failure.file.name}: ${failure.message}`).join(" | ");
      const duplicateDetails = duplicates.length ? ` وتم تخطي ${duplicates.length} ملف مكرر.` : "";
      setImportError(`تم رفع ${successfulUploads} ملف، وتعذر رفع ${failures.length}.${duplicateDetails} ${details}`);
      return;
    }
    if (duplicates.length) {
      setCertificateFiles([]);
      if (successfulUploads) {
        await onSuccess(`تم رفع ${successfulUploads} ملف جديد، وتخطي ${duplicates.length} ملف مرفوع مسبقًا`);
      } else {
        setImportError(`لم يتم رفع ملفات جديدة؛ تم تخطي ${duplicates.length} ملف لأنها مرفوعة مسبقًا.`);
      }
      return;
    }
    await onSuccess(`تم رفع وربط ${successfulUploads} ملف PDF بنجاح`);
  };

  async function applySelectedFiles(selectedFiles: File[]) {
    const selectedFile = selectedFiles[0] ?? null;
    setFile(selectedFile);
    setImportResult(null);
    setImportError("");
    setUploadProgress({ current: 0, total: 0, percentage: 0 });

    if (type === "upload") {
      const validFiles = selectedFiles.filter((item) => item.name.toLowerCase().endsWith(".pdf"));
      setCertificateFiles(validFiles);
      if (validFiles.length !== selectedFiles.length) {
        setImportError("تم تجاهل الملفات غير المطابقة لصيغة PDF.");
      }
      return;
    }

    if (!selectedFile) return;

    setParsing(true);
    try {
      setImportResult(await parseCertificateImport(selectedFile));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "تعذر قراءة ملف Excel.");
    } finally {
      setParsing(false);
    }
  }

  async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    await applySelectedFiles(Array.from(event.target.files ?? []));
  }

  function dragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!saving) setDragActive(true);
  }

  function dragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function dropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (saving) return;
    void applySelectedFiles(Array.from(event.dataTransfer.files));
  }

  const selectedCount = type === "upload" ? certificateFiles.length : file ? 1 : 0;
  const selectedSize = type === "upload"
    ? certificateFiles.reduce((total, item) => total + item.size, 0)
    : file?.size ?? 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head"><div><p className="eyebrow">إجراء جديد</p><h2 id="modal-title">{titles[type]}</h2></div><button type="button" className="close-button" onClick={onClose} disabled={saving}>إغلاق</button></div>
        <form onSubmit={submit}>
          <>
              <label className={`file-picker ${dragActive ? "drag-active" : ""}`} htmlFor="modal-file" onDragEnter={dragOver} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropFiles}>
                <input id="modal-file" type="file" accept={type === "import" ? ".xlsx" : "application/pdf,.pdf"} multiple={type === "upload"} onChange={(event) => void selectFiles(event)} />
                <span className="upload-symbol" aria-hidden="true">{type === "import" ? "XLSX" : "PDF"}</span>
                <strong>{selectedCount ? type === "upload" ? `تم اختيار ${selectedCount} ملف PDF` : file?.name : type === "import" ? "اختر ملف Excel المعتمد" : "اختر ملفات PDF"}</strong>
                <small>{selectedCount ? `${Math.max(1, Math.round(selectedSize / 1024))} KB إجمالي` : type === "upload" ? "اسحب عدة ملفات هنا أو اضغط للاختيار" : "اسحب الملف هنا أو اضغط للاختيار"}</small>
              </label>

              {type === "upload" && certificateFiles.length ? (
                <ul className="selected-upload-files" aria-label="ملفات PDF المحددة">
                  {certificateFiles.map((item, index) => <li key={`${item.name}-${item.size}-${item.lastModified}-${index}`}><span dir="ltr">{item.name}</span><small>{Math.max(1, Math.round(item.size / 1024))} KB</small><button type="button" onClick={() => setCertificateFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} disabled={saving} aria-label={`إزالة ${item.name}`}>إزالة</button></li>)}
                </ul>
              ) : null}

              {type === "upload" ? (
                <aside className="upload-naming-guide" aria-label="صيغ أسماء ملفات الشهادات">
                  <strong>صيغة اسم الملف</strong>
                  <div className="upload-name-examples">
                    <span><code>2345.pdf</code><small>الشهادة المحلية</small></span>
                    <span><code>i_2345.pdf</code><small>الشهادة الدولية</small></span>
                    <span><code>c_2345.pdf</code><small>البطاقة الدولية</small></span>
                  </div>
                  <p>سيتم ربط الدورة والمتدرب تلقائيًا حسب رقم الشهادة.</p>
                </aside>
              ) : null}

              {parsing ? <p className="import-reading" role="status">جارٍ قراءة الملف والتحقق من الأعمدة والبيانات...</p> : null}
              {saving && type === "import" ? <p className="import-reading" role="status">جارٍ الحفظ في Firestore: {saveProgress.completed} من {saveProgress.total}</p> : null}
              {saving && type === "upload" ? <div className="upload-batch-progress" role="status"><p><span>جارٍ رفع الملف {uploadProgress.current} من {uploadProgress.total}</span><strong>{uploadProgress.percentage}%</strong></p><i><b style={{ width: `${uploadProgress.percentage}%` }} /></i></div> : null}
              {importError ? <p className="auth-error import-error" role="alert">{importError}</p> : null}
              {importResult ? (
                <>
                  <div className={`file-preview ${importResult.errors.length ? "has-errors" : ""}`}>
                    <strong>{importResult.errors.length ? "يحتاج إلى تصحيح" : "الفحص ناجح"}</strong>
                    <span>{importResult.totalRows} سجلًا</span>
                    <span>{importResult.validRows} صالح</span>
                    <span>{importResult.errors.length} أخطاء</span>
                    <span>{importResult.warnings.length} تنبيهات</span>
                  </div>
                  <p className="import-courses">الدورات المكتشفة: {importResult.courses.join("، ") || "غير محددة"}</p>
                  {importResult.errors.length || importResult.warnings.length ? (
                    <ul className="import-issues">
                      {[...importResult.errors, ...importResult.warnings].slice(0, 5).map((issue, index) => (
                        <li key={`${issue.row}-${issue.field}-${index}`}><strong>صف {issue.row}</strong><span>{issue.field}: {issue.message}</span></li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
          </>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={parsing || saving || (type === "import" && (!importResult || importResult.errors.length > 0))}>{type === "import" ? saving ? "جارٍ الحفظ..." : "إضافة" : saving ? "جارٍ الرفع..." : "رفع وحفظ"}</button></div>
        </form>
      </section>
    </div>
  );
}

function AdminDashboard({ onLogout, profile }: { onLogout: () => void; profile: AdminProfile }) {
  const [view, setView] = useState<AdminView>("overview");
  const [modal, setModal] = useState<"import" | "upload" | null>(null);
  const [toast, setToast] = useState("");
  const [databaseData, setDatabaseData] = useState<AdminDatabaseData | null>(null);
  const [databaseLoading, setDatabaseLoading] = useState(true);
  const [databaseError, setDatabaseError] = useState("");
  const [dataScope, setDataScope] = useState<"overview" | "full" | null>(null);
  const databaseRequestActive = useRef(false);
  const title = navItems.find((item) => item.id === view)?.label ?? "نظرة عامة";

  const refreshDatabase = useCallback(async () => {
    if (databaseRequestActive.current) return;
    databaseRequestActive.current = true;
    setDatabaseLoading(true);
    setDatabaseError("");
    try {
      const overviewOnly = view === "overview";
      setDatabaseData(await (overviewOnly ? loadAdminOverviewData() : loadAdminDatabaseData()));
      setDataScope(overviewOnly ? "overview" : "full");
    } catch (error) {
      setDatabaseError(getAdminDatabaseError(error));
    } finally {
      databaseRequestActive.current = false;
      setDatabaseLoading(false);
    }
  }, [view]);

  useEffect(() => {
    const needsOverview = view === "overview" && dataScope === null;
    const needsFullData = view !== "overview" && dataScope !== "full";
    if (!needsOverview && !needsFullData) return;
    const requestTimer = window.setTimeout(() => void refreshDatabase(), 0);
    return () => window.clearTimeout(requestTimer);
  }, [dataScope, refreshDatabase, view]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function syncAfterMutation() {
    let statsError = "";
    try {
      await refreshDashboardStats();
    } catch (error) {
      statsError = getDashboardStatsError(error);
    }
    await refreshDatabase();
    if (statsError) showToast(statsError);
  }

  async function success(message: string) {
    setModal(null);
    showToast(message);
    await syncAfterMutation();
  }

  const courses = databaseData?.courses ?? [];
  const trainees = databaseData?.trainees ?? [];
  const certificates = databaseData?.certificates ?? [];
  const imports = databaseData?.imports ?? [];
  const companies = databaseData?.companies ?? [];
  const syncTime = databaseData?.loadedAt
    ? new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit" }).format(databaseData.loadedAt)
    : "—";
  const currentDate = new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>
      <AdminSidebar active={view} setActive={setView} onLogout={onLogout} profile={profile} />
      <div className="app-main">
        <header className="topbar"><div><span>مركز إدارة الشهادات</span><strong>{title}</strong></div><div><button type="button" className="sync-status sync-button" onClick={() => void refreshDatabase()} disabled={databaseLoading}><i /> {databaseLoading ? "جارٍ المزامنة..." : `آخر مزامنة: ${syncTime}`}</button><span className="date-label">{currentDate}</span></div></header>
        <main id="main-content" className="dashboard-content">
          {view === "overview" && <Overview onImport={() => setModal("import")} adminName={profile.name} data={databaseData} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} />}
          {view === "courses" && <CoursesView courses={courses} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} />}
          {view === "trainees" && <TraineesView trainees={trainees} certificates={certificates} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} onChanged={refreshDatabase} onMessage={showToast} />}
          {view === "companies" && <CompaniesView companies={companies} trainees={trainees} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} onChanged={refreshDatabase} onMessage={showToast} />}
          {view === "users" && <UsersView currentUser={profile} />}
          {view === "certificates" && <CertificatesView certificates={certificates} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} onUpload={() => setModal("upload")} onMessage={showToast} onDataChanged={syncAfterMutation} />}
          {view === "imports" && <ImportsView imports={imports} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} onImport={() => setModal("import")} />}
          {view === "activity" && <ActivityView imports={imports} loading={databaseLoading} error={databaseError} onRetry={() => void refreshDatabase()} />}
          {view === "settings" && <SettingsView profile={profile} onSuccess={showToast} />}
        </main>
      </div>
      {modal && <Modal type={modal} onClose={() => setModal(null)} onSuccess={success} onDataChanged={syncAfterMutation} />}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function CertificateRow({ type, number, available, downloading, onDownload }: { type: string; number: string; available: boolean; downloading?: boolean; onDownload: () => void }) {
  return <div className={`certificate-row ${!available ? "muted" : ""}`}><span className="pdf-mark">PDF</span><div><strong>{type}</strong><p>{available ? `رقم الشهادة: ${number}` : "لم تصدر بعد"}</p></div>{available ? <button type="button" className="download-button" onClick={onDownload} disabled={downloading}>{downloading ? "جارٍ التنزيل..." : "تنزيل PDF"}</button> : <StatusBadge status="قيد المراجعة" />}</div>;
}

function TraineeDashboard({ onLogout, profile }: { onLogout: () => void; profile: Extract<PlatformSession, { role: "trainee" }>["profile"] }) {
  const [portal, setPortal] = useState<TraineePortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [downloadingKey, setDownloadingKey] = useState("");

  const refreshPortal = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPortal(await loadTraineePortal(profile));
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : "تعذر تحميل بيانات المتدرب.");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    let active = true;
    void loadTraineePortal(profile)
      .then((data) => {
        if (active) setPortal(data);
      })
      .catch((portalError) => {
        if (active) setError(portalError instanceof Error ? portalError.message : "تعذر تحميل بيانات المتدرب.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profile]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function download(certificate: { id: string; number: string }, file: DatabaseCertificateFile) {
    const key = `${certificate.id}-${file.type}`;
    setDownloadingKey(key);
    try {
      await downloadCertificateFile(certificate, file, portal?.traineeNameEn || "");
      showToast(`بدأ تنزيل ${file.label}`);
    } catch (downloadError) {
      showToast(getCertificateDownloadError(downloadError));
    } finally {
      setDownloadingKey("");
    }
  }

  const traineeName = portal?.traineeName || profile.name;
  const nationalId = portal?.nationalId || profile.nationalId;
  const courses = portal?.courses ?? [];
  return (
    <div className="trainee-shell">
      <a className="skip-link" href="#trainee-content">تجاوز إلى المحتوى</a>
      <header className="trainee-header"><div className="official-logo-panel header-official-logo"><img className="official-logo" src="/institute-logo.png" alt="معهد التقنيات الصناعية العالي للتدريب" /></div><nav aria-label="حساب المتدرب"><span className="avatar">{getInitials(traineeName)}</span><button type="button" className="logout-button" onClick={onLogout}>تسجيل الخروج</button></nav></header>
      <main id="trainee-content" className="trainee-main">
        <section className="trainee-welcome"><div><p className="eyebrow light-text">بوابة المتدرب</p><h1>مرحبًا، {traineeName}</h1><p>جميع دوراتك وشهاداتك التدريبية المعتمدة في مكان واحد.</p></div><div className="identity-card"><span>حساب موثّق</span><strong dir="ltr">هوية تنتهي بـ {nationalId.slice(-4) || "—"}</strong><small>مرتبط بسجل المعهد</small></div></section>
        <section className="trainee-metrics"><article><p>الدورات المسجلة</p><strong>{loading ? "—" : courses.length}</strong><small>مرتبطة برقم الهوية</small></article><article><p>الشهادات المتاحة</p><strong>{loading ? "—" : portal?.availableFiles ?? 0}</strong><small>ملفات جاهزة للتنزيل</small></article><article><p>إجمالي الساعات</p><strong>{loading ? "—" : portal?.totalHours ?? 0}</strong><small>ساعة تدريبية</small></article></section>
        <section className="trainee-section-heading"><div><p className="eyebrow">سجلك التدريبي</p><h2>دوراتي وشهاداتي</h2></div><span className="privacy-note">ملفاتك خاصة ولا يمكن الوصول إليها دون تسجيل الدخول</span></section>
        {loading ? <div className="panel trainee-data-state"><strong>جارٍ تحميل دوراتك وشهاداتك...</strong></div> : null}
        {error ? <div className="panel trainee-data-state" role="alert"><strong>{error}</strong><button type="button" className="secondary-button" onClick={() => void refreshPortal()}>إعادة المحاولة</button></div> : null}
        {!loading && !error && !courses.length ? <div className="panel trainee-data-state"><strong>لا توجد دورات مرتبطة بحسابك</strong><p>تحقق من أن رقم الهوية موجود في ملف Excel المستورد.</p></div> : null}
        <section className="trainee-courses">
          {!loading && !error ? courses.map((course, courseIndex) => {
            const availableCount = course.certificates.reduce((count, certificate) => count + certificate.files.length, 0);
            return <article className={`trainee-course-card ${courseIndex === 0 ? "featured" : ""}`} key={course.id}><div className="course-card-head"><div><span className="course-code">{course.code}</span><h3>{course.name}</h3><p>{course.date} · {course.hours || "—"} ساعة</p></div><StatusBadge status={availableCount ? "مكتمل" : "بانتظار الشهادة"} /></div><div className="completion-strip"><span>جاهزية الشهادات</span><i><b style={{ width: availableCount ? "100%" : "0%" }} /></i><strong>{availableCount ? "100%" : "0%"}</strong></div><div className="certificate-list">{course.certificates.flatMap((certificate) => certificate.files.length ? certificate.files.map((file) => {
              const key = `${certificate.id}-${file.type}`;
              return <CertificateRow key={key} type={file.label} number={certificate.number} available downloading={downloadingKey === key} onDownload={() => void download(certificate, file)} />;
            }) : [<CertificateRow key={`${certificate.id}-pending`} type="الشهادة المحلية" number={certificate.number} available={false} onDownload={() => undefined} />])}</div></article>;
          }) : null}
        </section>
      </main>
      <footer className="trainee-footer"><span>معهد التقنيات الصناعية العالي للتدريب</span><span>الدعم الفني · سياسة الخصوصية</span></footer>
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function SessionLoader() {
  return (
    <main className="session-loader" aria-live="polite">
      <img src="/institute-logo.png" alt="شعار المعهد" />
      <span className="spinner dark" />
      <p>جارٍ التحقق من جلسة الدخول...</p>
    </main>
  );
}

export default function Home() {
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void observePlatformSession((platformSession) => {
      if (!active) return;
      setSession(platformSession);
      setCheckingSession(false);
    })
      .then((stopObserving) => {
        unsubscribe = stopObserving;
      })
      .catch(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  async function handleLogout() {
    try {
      await signOutPlatform();
    } finally {
      setSession(null);
    }
  }

  if (checkingSession) return <SessionLoader />;

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }
  if (session.role === "admin") {
    return <AdminDashboard onLogout={() => void handleLogout()} profile={session.profile} />;
  }
  if (session.role === "company") {
    return <CompanyDashboard onLogout={() => void handleLogout()} profile={session.profile} />;
  }
  return <TraineeDashboard onLogout={() => void handleLogout()} profile={session.profile} />;
}
