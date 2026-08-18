"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  getCertificateVerificationError,
  type PublicCertificateRecord,
  verifyPublicCertificate,
} from "../../lib/certificate-verification";

function formatIssueDate(timestamp: number) {
  if (!timestamp) return "غير محدد";
  return new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(timestamp));
}

export default function CertificateVerificationPage() {
  const [certificateNumber, setCertificateNumber] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [certificate, setCertificate] = useState<PublicCertificateRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = certificateNumber.trim();
    const identity = nationalId.trim();
    if (!value || !identity) {
      setError("أدخل رقم الشهادة ورقم الهوية أولاً.");
      return;
    }

    setLoading(true);
    setError("");
    setNotFound(false);
    setCertificate(null);
    try {
      const result = await verifyPublicCertificate(value, identity);
      if (result.verified) setCertificate(result.certificate);
      else setNotFound(true);
    } catch (requestError) {
      setError(getCertificateVerificationError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="verification-page">
      <a className="skip-link" href="#verification-form">تجاوز إلى نموذج التحقق</a>
      <header className="verification-header">
        <div className="verification-nav">
          <Link href="/" className="verification-logo" aria-label="العودة إلى منصة المعهد">
            {/* vinext image optimization is unavailable in the current hosting adapter. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/institute-logo.png" alt="معهد التقنيات الصناعية العالي للتدريب" />
          </Link>
          <div className="verification-nav-actions">
            <span className="verification-secure-label">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 5.7v5.8c0 4.2 2.7 7.9 6.5 9.5 3.8-1.6 6.5-5.3 6.5-9.5V5.7L12 3Z" /><path d="m9.2 12 1.8 1.8 3.9-4" /></svg>
              اتصال آمن
            </span>
            <Link href="/" className="verification-login-link">دخول المنصة</Link>
          </div>
        </div>
      </header>

      <section className="verification-main" aria-labelledby="verification-title">
        <div className="verification-shell">
          <aside className="verification-showcase">
            <div className="verification-showcase-content">
              <span className="verification-kicker">
                <i aria-hidden="true" />
                البوابة الرسمية للشهادات
              </span>
              <h1 id="verification-title">تحقّق من شهادتك<br /><em>بثقة ووضوح.</em></h1>
              <p>خدمة إلكترونية مباشرة للتأكد من صحة الشهادات الصادرة عن معهد التقنيات الصناعية العالي للتدريب.</p>

              <ol className="verification-steps" aria-label="خطوات التحقق">
                <li><span>01</span><div><strong>أدخل رقم الشهادة</strong><small>الرقم المدوّن على الشهادة الصادرة</small></div></li>
                <li><span>02</span><div><strong>أضف هوية المتدرب</strong><small>للتأكد من ارتباط الشهادة بصاحبها</small></div></li>
                <li><span>03</span><div><strong>استلم نتيجة موثوقة</strong><small>تظهر بيانات الشهادة المسجلة فورًا</small></div></li>
              </ol>
            </div>

            <div className="verification-trust-note">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 5.7v5.8c0 4.2 2.7 7.9 6.5 9.5 3.8-1.6 6.5-5.3 6.5-9.5V5.7L12 3Z" /><path d="m9.2 12 1.8 1.8 3.9-4" /></svg>
              <div><strong>خصوصيتك محفوظة</strong><small>لا يتم عرض رقم الهوية أو مشاركة بياناتك.</small></div>
            </div>
          </aside>

          <section className="verification-card" id="verification-form">
            <div className="verification-card-head">
              <span className="verification-seal" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m7.5 12 3 3 6-7M12 2.8l2.1 1.3 2.5-.1 1.1 2.2 2.2 1.1-.1 2.5 1.3 2.1-1.3 2.1.1 2.5-2.2 1.1-1.1 2.2-2.5-.1L12 21.2l-2.1-1.3-2.5.1-1.1-2.2-2.2-1.1.1-2.5L2.9 12l1.3-2.1-.1-2.5 2.2-1.1 1.1-2.2 2.5.1L12 2.8Z" /></svg>
              </span>
              <div>
                <p className="eyebrow">خدمة التحقق</p>
                <h2 id="verification-form-title">بيانات الشهادة</h2>
                <p>أدخل البيانات كما تظهر في سجلات المعهد.</p>
              </div>
            </div>

            <form onSubmit={submit} noValidate aria-labelledby="verification-form-title">
            <div className="verification-fields">
              <div className="verification-field">
                <label htmlFor="public-certificate-number">رقم الشهادة</label>
                <div className="verification-input-wrap">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6V3Z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></svg>
                  <input
                    id="public-certificate-number"
                    dir="ltr"
                    autoComplete="off"
                    maxLength={180}
                    value={certificateNumber}
                    onChange={(event) => setCertificateNumber(event.target.value)}
                    placeholder="مثال: 2345"
                    aria-describedby="certificate-number-help"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className="verification-field">
                <label htmlFor="public-national-id">رقم الهوية أو المعرّف</label>
                <div className="verification-input-wrap">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16v12H4v-12ZM8 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12.5 11h4M12.5 14h3" /></svg>
                  <input
                    id="public-national-id"
                    dir="ltr"
                    autoComplete="off"
                    maxLength={200}
                    value={nationalId}
                    onChange={(event) => setNationalId(event.target.value)}
                    placeholder="أدخل القيمة المسجلة لدى المعهد"
                    aria-describedby="certificate-number-help"
                    required
                  />
                </div>
              </div>
            </div>
            <button type="submit" className="primary-button verification-submit" disabled={loading}>
              <span>{loading ? "جارٍ التحقق..." : "التحقق من الشهادة"}</span>
              {!loading ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg> : <i className="verification-spinner" aria-hidden="true" />}
            </button>
            <p id="certificate-number-help" className="verification-help">يجب أن يتطابق الرقمان مع البيانات المسجلة في قواعد بيانات المعهد.</p>
          </form>

          {error ? <div className="verification-message error" role="alert"><strong>تعذر إكمال التحقق</strong><p>{error}</p></div> : null}
          {notFound ? <div className="verification-message not-found" role="status"><span aria-hidden="true">!</span><div><strong>لم يتم العثور على شهادة مطابقة</strong><p>تأكد من رقم الشهادة ورقم الهوية ثم حاول مرة أخرى.</p></div></div> : null}
          {certificate ? (
            <article className={`verification-result ${certificate.status === "revoked" ? "revoked" : ""}`} aria-live="polite">
              <div className="verification-result-head">
                <span aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                </span>
                <div><p>نتيجة التحقق</p><h2>{certificate.status === "revoked" ? "الشهادة ملغاة" : "شهادة صحيحة ومسجلة"}</h2></div>
                <b>{certificate.status === "revoked" ? "ملغاة" : "معتمدة"}</b>
              </div>
              <dl className="verification-details">
                <div><dt>اسم المتدرب</dt><dd>{certificate.traineeNameAr || certificate.traineeNameEn || "غير محدد"}</dd>{certificate.traineeNameEn && certificate.traineeNameAr ? <small dir="ltr">{certificate.traineeNameEn}</small> : null}</div>
                <div><dt>رقم الشهادة</dt><dd dir="ltr">{certificate.number}</dd></div>
                <div><dt>الدورة التدريبية</dt><dd>{certificate.courseNameAr || certificate.courseNameEn || "غير محددة"}</dd>{certificate.courseNameEn && certificate.courseNameAr ? <small dir="ltr">{certificate.courseNameEn}</small> : null}</div>
                <div><dt>تاريخ الإصدار</dt><dd>{formatIssueDate(certificate.issueDate)}</dd>{certificate.issueDateHijri ? <small>{certificate.issueDateHijri}</small> : null}</div>
                {certificate.courseCode ? <div><dt>رمز الدورة</dt><dd dir="ltr">{certificate.courseCode}</dd></div> : null}
                <div><dt>الجهة المصدرة</dt><dd>معهد التقنيات الصناعية العالي للتدريب</dd></div>
              </dl>
            </article>
          ) : null}
            <p className="verification-privacy"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M5 10h14v11H5V10Z" /></svg> يُستخدم رقم الهوية للمطابقة فقط، ولا يظهر ضمن نتيجة التحقق.</p>
          </section>
        </div>
      </section>

      <footer className="verification-footer">
        <div className="verification-footer-inner">
          <div><span>© {new Date().getFullYear()} معهد التقنيات الصناعية العالي للتدريب</span><span>منصة الشهادات الرقمية</span></div>
          <a href="https://itti.edu.sa">itti.edu.sa</a>
        </div>
      </footer>
    </main>
  );
}
