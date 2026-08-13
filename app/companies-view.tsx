"use client";

import { FormEvent, useDeferredValue, useMemo, useState } from "react";
import type { DatabaseCompany, DatabaseCompanyAccount, DatabaseTrainee } from "../lib/admin-database";
import {
  createCompanyAccount,
  getCompanyAdminError,
  saveCompany,
  setCompanyDisabled,
  updateCompanyAccount,
  updateCompanyDetails,
} from "../lib/company-admin";
import { deletePlatformUser, getPlatformUsersError, setPlatformUserDisabled } from "../lib/platform-users";

type CompanyModal = "company" | "companyEdit" | "account" | "accountEdit" | null;

function Status({ disabled }: { disabled: boolean }) {
  return <span className={`status-badge ${disabled ? "neutral" : "success"}`}><i aria-hidden="true" />{disabled ? "معطّل" : "نشط"}</span>;
}

function companyPaginationItems(currentPage: number, totalPages: number): Array<number | string> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = [...new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((first, second) => first - second);
  const items: Array<number | string> = [];

  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) items.push(`ellipsis-${previous}-${page}`);
    items.push(page);
  });

  return items;
}

export function CompaniesView({ companies, trainees, loading, error, onRetry, onChanged, onMessage }: {
  companies: DatabaseCompany[];
  trainees: DatabaseTrainee[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onChanged: () => void | Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [detailCompanyId, setDetailCompanyId] = useState("");
  const [modal, setModal] = useState<CompanyModal>(null);
  const [selectedAccount, setSelectedAccount] = useState<DatabaseCompanyAccount | null>(null);
  const [workingId, setWorkingId] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const detailCompany = companies.find((company) => company.id === detailCompanyId) ?? null;
  const companyEmployees = useMemo(
    () => trainees.filter((trainee) => trainee.companyDocumentId === detailCompanyId),
    [detailCompanyId, trainees],
  );
  const deferredSearch = useDeferredValue(search);
  const filteredCompanies = useMemo(() => {
    const needle = deferredSearch.trim().toLocaleLowerCase();
    if (!needle) return companies;

    return companies.filter((company) => [company.name, company.crNumber, company.contactEmail, company.contactPhone]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle));
  }, [companies, deferredSearch]);
  const totalPages = Math.max(1, Math.ceil(filteredCompanies.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const firstVisibleIndex = filteredCompanies.length ? (activePage - 1) * pageSize : 0;
  const visibleCompanies = filteredCompanies.slice(firstVisibleIndex, firstVisibleIndex + pageSize);
  const visibleEnd = Math.min(firstVisibleIndex + pageSize, filteredCompanies.length);
  const pageItems = useMemo(
    () => companyPaginationItems(activePage, totalPages),
    [activePage, totalPages],
  );

  function resetModal() {
    setModal(null);
    setSelectedAccount(null);
    setFormError("");
    setAccountPassword("");
  }

  function openNewCompany() {
    setCompanyName(""); setCrNumber(""); setContactEmail(""); setContactPhone(""); setFormError("");
    setModal("company");
  }

  function openCompanyEdit(company: DatabaseCompany) {
    setCompanyName(company.name); setCrNumber(company.crNumber); setContactEmail(company.contactEmail); setContactPhone(company.contactPhone); setFormError("");
    setModal("companyEdit");
  }

  function openNewAccount() {
    if (!detailCompany) return;
    setSelectedAccount(null); setAccountName(""); setAccountEmail(detailCompany.contactEmail); setAccountPassword(""); setFormError("");
    setModal("account");
  }

  function openAccountEdit(account: DatabaseCompanyAccount) {
    setSelectedAccount(account); setAccountName(account.name); setAccountEmail(account.email); setAccountPassword(""); setFormError("");
    setModal("accountEdit");
  }

  async function submitCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setFormError("");
    try {
      if (modal === "companyEdit" && detailCompany) {
        await updateCompanyDetails(detailCompany.id, { name: companyName, contactEmail, contactPhone });
        onMessage("تم تحديث بيانات الشركة");
      } else {
        const result = await saveCompany({ name: companyName, crNumber, contactEmail, contactPhone });
        setDetailCompanyId(result.id);
        onMessage("تمت إضافة الشركة وربطها بالسجل التجاري");
      }
      resetModal();
      await onChanged();
    } catch (requestError) {
      setFormError(getCompanyAdminError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailCompany) return;
    setSaving(true); setFormError("");
    try {
      if (modal === "accountEdit" && selectedAccount) {
        await updateCompanyAccount({ companyDocumentId: detailCompany.id, uid: selectedAccount.uid, name: accountName, email: accountEmail, password: accountPassword || undefined });
        onMessage("تم تحديث بيانات حساب الشركة");
      } else {
        await createCompanyAccount({ companyDocumentId: detailCompany.id, name: accountName, email: accountEmail, password: accountPassword });
        onMessage("تم إنشاء حساب ممثل الشركة");
      }
      resetModal();
      await onChanged();
    } catch (requestError) {
      setFormError(getCompanyAdminError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompany(company: DatabaseCompany) {
    setWorkingId(company.id); setFormError("");
    try {
      await setCompanyDisabled(company, company.status !== "disabled");
      await onChanged();
      onMessage(company.status === "disabled" ? "تم تفعيل الشركة" : "تم تعطيل الشركة");
    } catch (requestError) {
      setFormError(getCompanyAdminError(requestError));
    } finally { setWorkingId(""); }
  }

  async function toggleAccount(account: DatabaseCompanyAccount) {
    setWorkingId(account.uid); setFormError("");
    try {
      await setPlatformUserDisabled(account.uid, !account.disabled);
      await onChanged();
      onMessage(account.disabled ? "تم تفعيل الحساب" : "تم تعطيل الحساب");
    } catch (requestError) {
      setFormError(getPlatformUsersError(requestError));
    } finally { setWorkingId(""); }
  }

  async function removeAccount(account: DatabaseCompanyAccount) {
    if (!window.confirm(`سيتم حذف حساب ${account.name} نهائيًا. هل تريد المتابعة؟`)) return;
    setWorkingId(account.uid); setFormError("");
    try {
      await deletePlatformUser(account.uid);
      await onChanged();
      onMessage("تم حذف حساب الشركة");
    } catch (requestError) {
      setFormError(getPlatformUsersError(requestError));
    } finally { setWorkingId(""); }
  }

  return <>
    {!detailCompany ? <section className="panel full-panel companies-panel">
      <div className="panel-head stacked-mobile"><div><h2>الشركات</h2><p>جميع الشركات المسجلة في المنصة</p></div><div className="company-directory-controls"><div className="directory-table-tools"><label className="page-size-field" htmlFor="company-page-size"><span>عرض</span><select id="company-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1); }}><option value={25}>25 سجلًا</option><option value={50}>50 سجلًا</option><option value={100}>100 سجل</option><option value={250}>250 سجلًا</option></select></label><label className="search-field" htmlFor="company-search"><span>بحث</span><input id="company-search" inputMode="search" value={search} onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="اسم الشركة أو السجل التجاري..." /></label></div><div className="heading-actions"><button type="button" className="secondary-button" onClick={onRetry} disabled={loading}>تحديث</button><button type="button" className="primary-button" onClick={openNewCompany}>إضافة شركة</button></div></div></div>
      {error || formError ? <p className="auth-error users-error" role="alert">{formError || error}</p> : null}
      {loading ? <div className="empty-state"><strong>جارٍ تحميل الشركات...</strong></div> : null}
      {!loading && !companies.length ? <div className="empty-state"><strong>لا توجد شركات مسجلة</strong><p>أضف الشركة أو استورد ملف Excel يحتوي على رقم السجل التجاري في عمود CrNumber.</p></div> : null}
      {!loading && companies.length > 0 && !filteredCompanies.length ? <div className="empty-state"><strong>لا توجد نتائج مطابقة</strong><p>جرّب البحث باسم الشركة أو السجل التجاري أو بيانات التواصل.</p></div> : null}
      {!loading && visibleCompanies.length ? <div className="table-scroll"><table><thead><tr><th>الشركة</th><th>السجل التجاري</th><th>الموظفون</th><th>الشهادات</th><th>الحسابات</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{visibleCompanies.map((company) => <tr key={company.id}><td><button type="button" className="company-name-button" onClick={() => setDetailCompanyId(company.id)}><strong>{company.name}</strong><small dir="ltr">{company.contactEmail || "عرض صفحة الشركة"}</small></button></td><td dir="ltr">{company.crNumber || "—"}</td><td>{company.employees}</td><td>{company.certificates}</td><td>{company.accounts}</td><td><Status disabled={company.status === "disabled"} /></td><td><div className="user-actions"><button type="button" className="secondary-button" onClick={() => setDetailCompanyId(company.id)}>فتح</button><button type="button" className={company.status === "disabled" ? "secondary-button" : "danger-button"} disabled={workingId === company.id} onClick={() => void toggleCompany(company)}>{workingId === company.id ? "جارٍ الحفظ..." : company.status === "disabled" ? "تفعيل" : "تعطيل"}</button></div></td></tr>)}</tbody></table></div> : null}
      {!loading && filteredCompanies.length > 0 ? <nav className="directory-pagination" aria-label="صفحات سجل الشركات"><p>عرض <strong>{firstVisibleIndex + 1}–{visibleEnd}</strong> من <strong>{filteredCompanies.length}</strong>{search.trim() ? ` نتيجة · من أصل ${companies.length} شركة` : " شركة"}</p><div className="pagination-controls"><button type="button" className="pagination-direction" onClick={() => setCurrentPage(Math.max(1, activePage - 1))} disabled={activePage === 1} aria-label="الصفحة السابقة">السابق</button><div className="pagination-pages">{pageItems.map((item) => typeof item === "number" ? <button type="button" key={item} className={item === activePage ? "active" : ""} aria-current={item === activePage ? "page" : undefined} aria-label={`الصفحة ${item}`} onClick={() => setCurrentPage(item)}>{item}</button> : <span key={item} aria-hidden="true">…</span>)}</div><button type="button" className="pagination-direction" onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))} disabled={activePage === totalPages} aria-label="الصفحة التالية">التالي</button></div></nav> : null}
    </section> : <section className="company-detail-page">
      <div className="company-detail-toolbar"><button type="button" className="text-button company-back-button" onClick={() => setDetailCompanyId("")}>العودة إلى الشركات</button><div className="heading-actions"><button type="button" className="secondary-button" onClick={() => openCompanyEdit(detailCompany)}>تعديل بيانات الشركة</button><button type="button" className="primary-button" onClick={openNewAccount}>إضافة حساب</button></div></div>
      <header className="company-detail-hero"><div><p className="eyebrow">صفحة الشركة</p><h1>{detailCompany.name}</h1><p>السجل التجاري: <span dir="ltr">{detailCompany.crNumber || "—"}</span></p></div><Status disabled={detailCompany.status === "disabled"} /></header>
      {error || formError ? <p className="auth-error" role="alert">{formError || error}</p> : null}
      <section className="metrics-grid company-detail-metrics"><article className="metric-card"><p>المتدربون</p><strong>{companyEmployees.length}</strong><small>مرتبطون بالسجل التجاري</small></article><article className="metric-card"><p>الشهادات</p><strong>{detailCompany.certificates}</strong><small>ضمن سجلات الشركة</small></article><article className="metric-card"><p>حسابات الشركة</p><strong>{detailCompany.accountList.length}</strong><small>حسابات ممثلي الشركة</small></article></section>
      <section className="panel company-detail-section"><div className="panel-head"><div><h2>المتدربون</h2><p>الموظفون المرتبطون بالشركة من ملفات Excel</p></div></div>{companyEmployees.length ? <div className="table-scroll"><table><thead><tr><th>المتدرب</th><th>رقم الهوية</th><th>الجوال</th><th>الدورات</th><th>الشهادات</th></tr></thead><tbody>{companyEmployees.map((trainee) => <tr key={trainee.id}><td><strong>{trainee.name}</strong><small dir="ltr">{trainee.nameEn}</small></td><td dir="ltr">{trainee.nationalId}</td><td dir="ltr">{trainee.mobile || "—"}</td><td>{trainee.courses.join("، ") || "—"}</td><td>{trainee.certificates}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>لا يوجد متدربون مرتبطون</strong><p>أضف رقم السجل التجاري في عمود CrNumber عند استيراد Excel.</p></div>}</section>
      <section className="panel company-detail-section"><div className="panel-head"><div><h2>الحسابات</h2><p>حسابات ممثلي الشركة المخولين بالدخول</p></div><button type="button" className="primary-button" onClick={openNewAccount}>إضافة حساب</button></div>{detailCompany.accountList.length ? <div className="table-scroll"><table><thead><tr><th>المستخدم</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{detailCompany.accountList.map((account) => <tr key={account.uid}><td><strong>{account.name}</strong><small dir="ltr">{account.email}</small></td><td><Status disabled={account.disabled} /></td><td><div className="user-actions"><button type="button" className="secondary-button" disabled={workingId === account.uid} onClick={() => openAccountEdit(account)}>تعديل</button><button type="button" className="secondary-button" disabled={workingId === account.uid} onClick={() => void toggleAccount(account)}>{account.disabled ? "تفعيل" : "تعطيل"}</button><button type="button" className="danger-button" disabled={workingId === account.uid} onClick={() => void removeAccount(account)}>حذف</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>لا توجد حسابات للشركة</strong><p>أضف حسابًا ليتمكن ممثل الشركة من تسجيل الدخول.</p></div>}</section>
    </section>}

    {(modal === "company" || modal === "companyEdit") ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) resetModal(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="company-modal-title"><div className="modal-head"><div><p className="eyebrow">الشركات</p><h2 id="company-modal-title">{modal === "companyEdit" ? "تعديل بيانات الشركة" : "إضافة شركة"}</h2></div><button type="button" className="close-button" onClick={resetModal} disabled={saving}>إغلاق</button></div><form onSubmit={submitCompany}><label htmlFor="company-name">اسم الشركة</label><input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required autoFocus /><label htmlFor="company-cr">رقم السجل التجاري</label><input id="company-cr" dir="ltr" inputMode="numeric" value={crNumber} onChange={(event) => setCrNumber(event.target.value.replace(/\D/g, ""))} required readOnly={modal === "companyEdit"} />{modal === "companyEdit" ? <p className="field-note">رقم السجل التجاري ثابت لأنه مفتاح ربط الموظفين والشهادات.</p> : null}<div className="field-grid"><div><label htmlFor="company-email">بريد التواصل</label><input id="company-email" type="email" dir="ltr" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></div><div><label htmlFor="company-phone">رقم التواصل</label><input id="company-phone" type="tel" dir="ltr" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></div></div>{formError ? <p className="auth-error" role="alert">{formError}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={resetModal} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جارٍ الحفظ..." : modal === "companyEdit" ? "حفظ التعديلات" : "إضافة الشركة"}</button></div></form></section></div> : null}

    {(modal === "account" || modal === "accountEdit") && detailCompany ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) resetModal(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title"><div className="modal-head"><div><p className="eyebrow">{detailCompany.name}</p><h2 id="account-modal-title">{modal === "accountEdit" ? "تعديل حساب الشركة" : "إضافة حساب ممثل الشركة"}</h2></div><button type="button" className="close-button" onClick={resetModal} disabled={saving}>إغلاق</button></div><form onSubmit={submitAccount}><label htmlFor="company-account-name">اسم ممثل الشركة</label><input id="company-account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} required autoFocus /><label htmlFor="company-account-email">البريد الإلكتروني للدخول</label><input id="company-account-email" type="email" dir="ltr" autoComplete="off" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} required /><label htmlFor="company-account-password">{modal === "accountEdit" ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور المؤقتة"}</label><input id="company-account-password" type="password" dir="ltr" minLength={8} autoComplete="new-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} required={modal === "account"} /><p className="field-note">{modal === "accountEdit" ? "اترك كلمة المرور فارغة للاحتفاظ بكلمة المرور الحالية." : "استخدم 8 أحرف على الأقل، ثم أرسلها لممثل الشركة بطريقة آمنة."}</p>{formError ? <p className="auth-error" role="alert">{formError}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" onClick={resetModal} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جارٍ الحفظ..." : modal === "accountEdit" ? "حفظ التعديلات" : "إنشاء الحساب"}</button></div></form></section></div> : null}
  </>;
}
