"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { DatabaseCertificateFile } from "../lib/admin-database";
import { buildCertificateDownloadFileName, getCertificateDownload, getCertificateDownloadError } from "../lib/certificate-upload";
import { getCompanyPortalError, loadCompanyPortal, type CompanyPortalCertificate, type CompanyPortalData } from "../lib/company-portal";
import type { CompanyProfile } from "../lib/platform-session";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join(" ") || "ش";
}

async function downloadCertificate(certificate: CompanyPortalCertificate, file: DatabaseCertificateFile, traineeNameEn: string) {
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

export function CompanyDashboard({ onLogout, profile }: { onLogout: () => void; profile: CompanyProfile }) {
  const [portal, setPortal] = useState<CompanyPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState("");
  const [toast, setToast] = useState("");
  const deferredSearch = useDeferredValue(search);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPortal(await loadCompanyPortal(profile));
    } catch (requestError) {
      setError(getCompanyPortalError(requestError));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    let active = true;
    void loadCompanyPortal(profile)
      .then((data) => { if (active) setPortal(data); })
      .catch((requestError) => { if (active) setError(getCompanyPortalError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile]);

  const employees = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    if (!query) return portal?.employees ?? [];
    return (portal?.employees ?? []).filter((employee) =>
      `${employee.name} ${employee.nameEn} ${employee.nationalId} ${employee.mobile} ${employee.courses.join(" ")}`.toLocaleLowerCase().includes(query),
    );
  }, [deferredSearch, portal]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function download(certificate: CompanyPortalCertificate, file: DatabaseCertificateFile, traineeNameEn: string) {
    const key = `${certificate.id}-${file.type}`;
    setDownloading(key);
    try {
      await downloadCertificate(certificate, file, traineeNameEn);
      showToast(`بدأ تنزيل ${file.label}`);
    } catch (requestError) {
      showToast(getCertificateDownloadError(requestError));
    } finally {
      setDownloading("");
    }
  }

  const companyName = portal?.companyName || profile.companyName;
  return <div className="trainee-shell company-shell">
    <a className="skip-link" href="#company-content">تجاوز إلى المحتوى</a>
    <header className="trainee-header company-header"><div className="official-logo-panel header-official-logo"><img className="official-logo" src="/institute-logo.png" alt="معهد التقنيات الصناعية العالي للتدريب" /></div><nav aria-label="حساب الشركة"><span className="company-account-name"><b>{profile.name}</b><small>{companyName}</small></span><span className="avatar">{initials(companyName)}</span><button type="button" className="logout-button" onClick={onLogout}>تسجيل الخروج</button></nav></header>
    <main id="company-content" className="trainee-main company-main">
      <section className="trainee-welcome company-welcome"><div><p className="eyebrow light-text">بوابة الشركات</p><h1>{companyName}</h1><p>متابعة السجل التدريبي لموظفي الشركة وتنزيل شهاداتهم المعتمدة.</p></div><div className="identity-card"><span>حساب شركة موثّق</span><strong dir="ltr">السجل التجاري: {portal?.crNumber || profile.crNumber || "—"}</strong><small>صلاحية قراءة وتنزيل فقط</small></div></section>
      <section className="trainee-metrics company-metrics"><article><p>الموظفون المسجلون</p><strong>{loading ? "—" : portal?.employees.length ?? 0}</strong><small>مرتبطون بالسجل التجاري</small></article><article><p>الدورات</p><strong>{loading ? "—" : portal?.totalCourses ?? 0}</strong><small>دورات موظفي الشركة</small></article><article><p>الشهادات</p><strong>{loading ? "—" : portal?.totalCertificates ?? 0}</strong><small>{portal?.availableFiles ?? 0} ملف متاح للتنزيل</small></article></section>
      <section className="panel company-employees-panel">
        <div className="panel-head stacked-mobile"><div><p className="eyebrow">السجل التدريبي</p><h2>موظفو الشركة</h2><p>البحث بالاسم أو رقم الهوية أو الدورة</p></div><label className="search-field" htmlFor="company-employee-search"><span>بحث</span><input id="company-employee-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم الموظف أو رقم الهوية..." /></label></div>
        {loading ? <div className="empty-state"><strong>جارٍ تحميل بيانات الموظفين...</strong></div> : null}
        {error ? <div className="empty-state" role="alert"><strong>{error}</strong><p><button type="button" className="secondary-button" onClick={() => void refresh()}>إعادة المحاولة</button></p></div> : null}
        {!loading && !error && !portal?.employees.length ? <div className="empty-state"><strong>لا يوجد موظفون مرتبطون بالشركة</strong><p>يجب أن يحتوي سجل الموظف المستورد على رقم السجل التجاري للشركة.</p></div> : null}
        {!loading && !error && portal?.employees.length && !employees.length ? <div className="empty-state"><strong>لا توجد نتائج مطابقة</strong></div> : null}
        {!loading && !error && employees.length ? <div className="company-employee-list">{employees.map((employee) => <details key={employee.id} className="company-employee-card"><summary><span className="avatar">{initials(employee.name)}</span><span><strong>{employee.name}</strong><small dir="ltr">{employee.nationalId} · {employee.mobile || "بدون جوال"}</small></span><span><b>{employee.courses.length}</b><small>دورات</small></span><span><b>{employee.certificates.length}</b><small>شهادات</small></span><i aria-hidden="true">+</i></summary><div className="company-employee-details">{employee.certificates.length ? employee.certificates.map((certificate) => <article key={certificate.id}><div><strong>{certificate.course}</strong><p>رقم الشهادة: <span dir="ltr">{certificate.number}</span> · {certificate.issueDate}</p></div><div className="company-file-actions">{certificate.files.length ? certificate.files.map((file) => { const key = `${certificate.id}-${file.type}`; return <button type="button" className="download-button" key={key} disabled={downloading === key} onClick={() => void download(certificate, file, employee.nameEn)}>{downloading === key ? "جارٍ التنزيل..." : file.label}</button>; }) : <span className="status-badge warning"><i />بانتظار ملف PDF</span>}</div></article>) : <p className="company-no-certificate">لا توجد شهادات مسجلة لهذا الموظف.</p>}</div></details>)}</div> : null}
      </section>
    </main>
    <footer className="trainee-footer"><span>معهد التقنيات الصناعية العالي للتدريب</span><span>بيانات الشركة للعرض والتنزيل فقط</span></footer>
    <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
