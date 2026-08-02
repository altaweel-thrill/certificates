"use client";

import { ChangeEvent, FormEvent, useDeferredValue, useMemo, useState } from "react";

type Role = "trainee" | "admin";
type AdminView = "overview" | "courses" | "trainees" | "certificates" | "imports" | "activity" | "settings";

type Course = {
  code: string;
  name: string;
  date: string;
  trainees: number;
  completion: number;
  status: "نشطة" | "مكتملة" | "قيد المراجعة";
};

const courses: Course[] = [
  { code: "CNC-2407", name: "تشغيل وبرمجة ماكينات CNC", date: "15 يوليو – 8 أغسطس 2026", trainees: 24, completion: 88, status: "نشطة" },
  { code: "SAFE-114", name: "السلامة والصحة المهنية", date: "2 – 6 أغسطس 2026", trainees: 32, completion: 61, status: "نشطة" },
  { code: "WLD-331", name: "تقنيات اللحام الصناعي المتقدم", date: "1 – 24 يوليو 2026", trainees: 18, completion: 100, status: "مكتملة" },
  { code: "PLC-208", name: "أساسيات التحكم المنطقي PLC", date: "10 – 28 يوليو 2026", trainees: 21, completion: 94, status: "قيد المراجعة" },
];

const trainees = [
  { name: "خالد أحمد العتيبي", id: "••••••4821", course: "تشغيل وبرمجة ماكينات CNC", certificates: 2, state: "مكتمل" },
  { name: "عبدالله سعد القحطاني", id: "••••••1940", course: "السلامة والصحة المهنية", certificates: 1, state: "قيد التدريب" },
  { name: "محمد عادل الغامدي", id: "••••••6357", course: "تقنيات اللحام الصناعي المتقدم", certificates: 2, state: "مكتمل" },
  { name: "سلمان فهد الشهري", id: "••••••9024", course: "أساسيات التحكم المنطقي PLC", certificates: 1, state: "بانتظار الاعتماد" },
  { name: "يزن سامي الحربي", id: "••••••1788", course: "السلامة والصحة المهنية", certificates: 0, state: "قيد التدريب" },
];

const activity = [
  { title: "تم اعتماد 18 شهادة محلية", detail: "دورة تقنيات اللحام الصناعي المتقدم", time: "منذ 12 دقيقة" },
  { title: "اكتمل استيراد ملف المتدربين", detail: "32 سجلًا، دون أخطاء", time: "منذ 46 دقيقة" },
  { title: "تم رفع شهادة دولية", detail: "للمتدرب خالد أحمد العتيبي", time: "منذ ساعتين" },
  { title: "تم إنشاء دورة جديدة", detail: "أساسيات التحكم المنطقي PLC", time: "أمس، 3:20 م" },
];

const navItems: { id: AdminView; label: string; mark: string }[] = [
  { id: "overview", label: "نظرة عامة", mark: "01" },
  { id: "courses", label: "الدورات", mark: "02" },
  { id: "trainees", label: "المتدربون", mark: "03" },
  { id: "certificates", label: "الشهادات", mark: "04" },
  { id: "imports", label: "استيراد البيانات", mark: "05" },
  { id: "activity", label: "سجل النشاط", mark: "06" },
  { id: "settings", label: "الإعدادات", mark: "07" },
];

function makeDemoPdf(title: string) {
  const safeTitle = title.replace(/[()\\]/g, "");
  const stream = `BT\n/F1 22 Tf\n72 700 Td\n(Training Certificate) Tj\n0 -38 Td\n/F1 13 Tf\n(${safeTitle}) Tj\n0 -28 Td\n(Demo download - Industrial Technology Training Institute) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}

function downloadDemoCertificate(title: string) {
  const blob = new Blob([makeDemoPdf(title)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "certificate-demo.pdf";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("مكتمل") || status.includes("معتمد") || status === "نشطة" ? "success" : status.includes("انتظار") || status.includes("مراجعة") ? "warning" : "neutral";
  return <span className={`status-badge ${tone}`}><i aria-hidden="true" />{status}</span>;
}

function LoginScreen({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>("trainee");
  const [identity, setIdentity] = useState("1098764821");
  const [mobile, setMobile] = useState("05 1234 5678");
  const [email, setEmail] = useState("admin@hiti.edu.sa");
  const [password, setPassword] = useState("••••••••••");
  const [loading, setLoading] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    window.setTimeout(() => onLogin(role), 450);
  }

  return (
    <main className="login-shell">
      <a className="skip-link" href="#login-form">تجاوز إلى نموذج الدخول</a>
      <section className="login-brand" aria-label="نبذة عن المنصة">
        <div className="industrial-grid" aria-hidden="true" />
        <div className="brand-content">
          <div className="brand-lockup light">
            <span className="brand-symbol" aria-hidden="true"><b /><b /><b /></span>
            <span><strong>معهد التقنيات الصناعية العالي للتدريب</strong><small>منصة إدارة الشهادات</small></span>
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
        <div className="mobile-brand brand-lockup">
          <span className="brand-symbol" aria-hidden="true"><b /><b /><b /></span>
          <span><strong>معهد التقنيات الصناعية</strong><small>منصة إدارة الشهادات</small></span>
        </div>
        <div className="login-card">
          <span className="demo-label">نسخة تجريبية</span>
          <p className="eyebrow">تسجيل الدخول</p>
          <h2>{role === "trainee" ? "مرحبًا بك في بوابة المتدرب" : "الدخول إلى لوحة الإدارة"}</h2>
          <p className="subcopy">{role === "trainee" ? "أدخل بياناتك المطابقة لسجل المعهد للوصول إلى دوراتك." : "استخدم حسابك الإداري المعتمد لإدارة المنصة."}</p>

          <div className="role-switch" role="tablist" aria-label="نوع الحساب">
            <button type="button" role="tab" aria-selected={role === "trainee"} className={role === "trainee" ? "active" : ""} onClick={() => setRole("trainee")}>متدرب</button>
            <button type="button" role="tab" aria-selected={role === "admin"} className={role === "admin" ? "active" : ""} onClick={() => setRole("admin")}>مسؤول المنصة</button>
          </div>

          <form onSubmit={submit}>
            {role === "trainee" ? (
              <>
                <label htmlFor="national-id">رقم الهوية</label>
                <input id="national-id" inputMode="numeric" autoComplete="off" value={identity} onChange={(e) => setIdentity(e.target.value)} required />
                <label htmlFor="mobile">رقم الجوال المسجل</label>
                <input id="mobile" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
                <p className="field-note">سيُستخدم رقم الهوية لمطابقة حسابك بالدورات المسجلة فقط.</p>
              </>
            ) : (
              <>
                <label htmlFor="email">البريد الإلكتروني</label>
                <input id="email" type="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <label htmlFor="password">كلمة المرور</label>
                <input id="password" type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </>
            )}
            <button className="primary-button full" type="submit" disabled={loading}>{loading ? "جارٍ التحقق..." : role === "trainee" ? "متابعة والتحقق" : "دخول لوحة الإدارة"}</button>
          </form>
          <p className="demo-help">هذه نسخة عرض؛ يمكنك المتابعة باستخدام البيانات الظاهرة.</p>
        </div>
        <p className="login-footer">الدعم الفني · سياسة الخصوصية · الإصدار 0.1</p>
      </section>
    </main>
  );
}

function AdminSidebar({ active, setActive, onLogout }: { active: AdminView; setActive: (view: AdminView) => void; onLogout: () => void }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup light compact">
        <span className="brand-symbol" aria-hidden="true"><b /><b /><b /></span>
        <span><strong>معهد التقنيات الصناعية</strong><small>مركز الشهادات</small></span>
      </div>
      <nav aria-label="التنقل الرئيسي">
        {navItems.map((item) => (
          <button type="button" key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}>
            <span aria-hidden="true">{item.mark}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-profile">
        <span className="avatar">ن ع</span>
        <span><strong>نورة العبدالله</strong><small>مدير النظام</small></span>
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

function Overview({ onImport, onAddCourse }: { onImport: () => void; onAddCourse: () => void }) {
  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">لوحة التشغيل</p><h1>صباح الخير، نورة</h1><p>إليك ملخص حالة الدورات والشهادات اليوم.</p></div>
        <div className="heading-actions"><button className="secondary-button" type="button" onClick={onAddCourse}>إضافة دورة</button><button className="primary-button" type="button" onClick={onImport}>استيراد ملف Excel</button></div>
      </section>
      <section className="metrics-grid" aria-label="مؤشرات المنصة">
        <MetricCard label="الدورات النشطة" value="24" detail="4 دورات تبدأ هذا الأسبوع" tone="slate" />
        <MetricCard label="إجمالي المتدربين" value="1,248" detail="+56 متدربًا هذا الشهر" tone="blue" />
        <MetricCard label="الشهادات الصادرة" value="3,972" detail="142 شهادة خلال أغسطس" tone="green" />
        <MetricCard label="بانتظار الاعتماد" value="86" detail="تحتاج إلى مراجعة المسؤول" tone="orange" />
      </section>
      <section className="dashboard-grid">
        <article className="panel courses-panel">
          <div className="panel-head"><div><h2>الدورات الأخيرة</h2><p>متابعة جاهزية بيانات وشهادات كل دورة</p></div><button type="button" className="text-button">عرض الكل</button></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>الدورة</th><th>التاريخ</th><th>المتدربون</th><th>جاهزية الشهادات</th><th>الحالة</th></tr></thead>
              <tbody>{courses.map((course) => <tr key={course.code}><td><strong>{course.name}</strong><small>{course.code}</small></td><td>{course.date}</td><td>{course.trainees}</td><td><div className="progress-cell"><span><i style={{ width: `${course.completion}%` }} /></span><b>{course.completion}%</b></div></td><td><StatusBadge status={course.status} /></td></tr>)}</tbody>
            </table>
          </div>
        </article>
        <aside className="panel activity-panel">
          <div className="panel-head"><div><h2>آخر النشاطات</h2><p>سجل العمليات المهمة</p></div></div>
          <div className="activity-list">{activity.map((item, index) => <div className="activity-item" key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></div>)}</div>
        </aside>
      </section>
    </>
  );
}

function CoursesView() {
  return (
    <section className="panel full-panel">
      <div className="panel-head"><div><h2>إدارة الدورات</h2><p>جميع الدورات التدريبية وحالة تجهيز شهاداتها</p></div><button type="button" className="primary-button">إضافة دورة</button></div>
      <div className="course-grid">{courses.map((course) => <article className="course-admin-card" key={course.code}><div className="course-code">{course.code}</div><StatusBadge status={course.status} /><h3>{course.name}</h3><p>{course.date}</p><dl><div><dt>المتدربون</dt><dd>{course.trainees}</dd></div><div><dt>الجاهزية</dt><dd>{course.completion}%</dd></div></dl><div className="wide-progress"><i style={{ width: `${course.completion}%` }} /></div><button type="button" className="secondary-button full">فتح ملف الدورة</button></article>)}</div>
    </section>
  );
}

function TraineesView() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => trainees.filter((trainee) => `${trainee.name} ${trainee.id} ${trainee.course}`.includes(deferredSearch)), [deferredSearch]);
  return (
    <section className="panel full-panel">
      <div className="panel-head stacked-mobile"><div><h2>سجل المتدربين</h2><p>البحث برقم الهوية المخفي أو الاسم أو الدورة</p></div><label className="search-field" htmlFor="trainee-search"><span>بحث</span><input id="trainee-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتب اسمًا أو رقمًا..." /></label></div>
      <div className="table-scroll">
        <table><thead><tr><th>المتدرب</th><th>رقم الهوية</th><th>الدورة</th><th>الشهادات</th><th>الحالة</th><th><span className="sr-only">الإجراء</span></th></tr></thead><tbody>{filtered.map((trainee) => <tr key={trainee.id}><td><strong>{trainee.name}</strong></td><td dir="ltr">{trainee.id}</td><td>{trainee.course}</td><td>{trainee.certificates}</td><td><StatusBadge status={trainee.state} /></td><td><button type="button" className="text-button">فتح السجل</button></td></tr>)}</tbody></table>
      </div>
      {!filtered.length && <div className="empty-state"><strong>لا توجد نتائج مطابقة</strong><p>جرّب البحث بجزء من الاسم أو رقم الهوية.</p></div>}
    </section>
  );
}

function CertificatesView({ onUpload }: { onUpload: () => void }) {
  const docs = [
    { owner: "خالد أحمد العتيبي", name: "الشهادة المحلية – CNC", type: "PDF", size: "1.8 MB", state: "معتمدة" },
    { owner: "خالد أحمد العتيبي", name: "الشهادة الدولية – CNC", type: "PDF", size: "2.4 MB", state: "معتمدة" },
    { owner: "محمد عادل الغامدي", name: "بطاقة اللحام الدولية", type: "PDF", size: "860 KB", state: "بانتظار الاعتماد" },
    { owner: "سلمان فهد الشهري", name: "الشهادة المحلية – PLC", type: "PDF", size: "1.2 MB", state: "قيد المراجعة" },
  ];
  return (
    <section className="panel full-panel">
      <div className="panel-head"><div><h2>مستودع الشهادات</h2><p>ملفات PDF الخاصة المرتبطة بسجلات المتدربين</p></div><button type="button" className="primary-button" onClick={onUpload}>رفع شهادة PDF</button></div>
      <div className="document-list">{docs.map((doc) => <article key={`${doc.owner}-${doc.name}`}><span className="pdf-mark">PDF</span><div><strong>{doc.name}</strong><p>{doc.owner} · {doc.size}</p></div><StatusBadge status={doc.state} /><button type="button" className="secondary-button" onClick={() => downloadDemoCertificate(doc.name)}>تنزيل</button></article>)}</div>
    </section>
  );
}

function ImportsView({ onImport }: { onImport: () => void }) {
  return (
    <section className="panel full-panel import-page">
      <div className="panel-head"><div><h2>استيراد بيانات الدورات والمتدربين</h2><p>استخدم قالب Excel المعتمد لضمان مطابقة الحقول</p></div><button type="button" className="secondary-button">تنزيل القالب</button></div>
      <button type="button" className="drop-zone" onClick={onImport}><span className="upload-symbol" aria-hidden="true">XLSX</span><strong>اختر ملف Excel لبدء الاستيراد</strong><small>تتم مراجعة البيانات وعرض الأخطاء قبل الحفظ النهائي</small></button>
      <div className="import-history"><h3>آخر عمليات الاستيراد</h3><div><span className="file-chip">XLSX</span><p><strong>متدربو-السلامة-أغسطس.xlsx</strong><small>32 سجلًا · تم بواسطة نورة العبدالله</small></p><StatusBadge status="مكتمل" /></div><div><span className="file-chip">XLSX</span><p><strong>دورة-CNC-يوليو.xlsx</strong><small>24 سجلًا · تم بواسطة أحمد سالم</small></p><StatusBadge status="مكتمل" /></div></div>
    </section>
  );
}

function SimpleView({ view }: { view: "activity" | "settings" }) {
  if (view === "activity") return <section className="panel full-panel"><div className="panel-head"><div><h2>سجل النشاط</h2><p>سجل تدقيق زمني لجميع العمليات المهمة</p></div></div><div className="activity-list wide">{[...activity, ...activity].map((item, index) => <div className="activity-item" key={`${item.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></div>)}</div></section>;
  return <section className="panel full-panel"><div className="panel-head"><div><h2>إعدادات المنصة</h2><p>بيانات المعهد وسياسات الحسابات والتنزيل</p></div></div><div className="settings-grid"><article><h3>بيانات الجهة</h3><label htmlFor="institute-name">اسم المعهد</label><input id="institute-name" defaultValue="معهد التقنيات الصناعية العالي للتدريب" /><label htmlFor="support-email">بريد الدعم</label><input id="support-email" dir="ltr" defaultValue="support@hiti.edu.sa" /></article><article><h3>سياسة الشهادات</h3><label className="toggle-row"><span><strong>السماح بتنزيل المعتمد فقط</strong><small>لن يرى المتدرب الملفات قيد المراجعة</small></span><input type="checkbox" defaultChecked /></label><label className="toggle-row"><span><strong>تسجيل عمليات التنزيل</strong><small>حفظ المستخدم والوقت والملف</small></span><input type="checkbox" defaultChecked /></label></article></div><button type="button" className="primary-button">حفظ التغييرات</button></section>;
}

function Modal({ type, onClose, onSuccess }: { type: "import" | "upload" | "course"; onClose: () => void; onSuccess: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const titles = { import: "استيراد ملف Excel", upload: "رفع شهادة جديدة", course: "إضافة دورة تدريبية" };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSuccess(type === "import" ? "تم فحص ملف Excel وأصبح جاهزًا للمراجعة" : type === "upload" ? "تم رفع الشهادة وحفظها بانتظار الاعتماد" : "تمت إضافة الدورة التدريبية");
  };
  function selectFile(event: ChangeEvent<HTMLInputElement>) { setFile(event.target.files?.[0] ?? null); }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head"><div><p className="eyebrow">إجراء جديد</p><h2 id="modal-title">{titles[type]}</h2></div><button type="button" className="close-button" onClick={onClose}>إغلاق</button></div>
        <form onSubmit={submit}>
          {type === "course" ? <><label htmlFor="course-name">اسم الدورة</label><input id="course-name" required placeholder="مثال: أساسيات الصيانة الميكانيكية" /><div className="field-grid"><div><label htmlFor="course-code">رمز الدورة</label><input id="course-code" dir="ltr" required placeholder="MNT-101" /></div><div><label htmlFor="course-hours">عدد الساعات</label><input id="course-hours" inputMode="numeric" required placeholder="40" /></div></div></> : <><label htmlFor="target-course">الدورة التدريبية</label><select id="target-course" required defaultValue=""><option value="" disabled>اختر الدورة</option>{courses.map((course) => <option key={course.code}>{course.name}</option>)}</select><label className="file-picker" htmlFor="modal-file"><input id="modal-file" type="file" accept={type === "import" ? ".xlsx,.xls" : "application/pdf"} onChange={selectFile} required /><span className="upload-symbol" aria-hidden="true">{type === "import" ? "XLSX" : "PDF"}</span><strong>{file ? file.name : type === "import" ? "اختر ملف Excel" : "اختر شهادة PDF"}</strong><small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "اسحب الملف هنا أو اضغط للاختيار"}</small></label>{file && type === "import" && <div className="file-preview"><strong>فحص أولي ناجح</strong><span>32 سجلًا</span><span>0 أخطاء حرجة</span><span>2 تنبيهات</span></div>}</>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>إلغاء</button><button type="submit" className="primary-button">{type === "import" ? "متابعة إلى المراجعة" : type === "upload" ? "رفع وحفظ" : "إضافة الدورة"}</button></div>
        </form>
      </section>
    </div>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<AdminView>("overview");
  const [modal, setModal] = useState<"import" | "upload" | "course" | null>(null);
  const [toast, setToast] = useState("");
  const title = navItems.find((item) => item.id === view)?.label ?? "نظرة عامة";
  function success(message: string) { setModal(null); setToast(message); window.setTimeout(() => setToast(""), 3200); }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>
      <AdminSidebar active={view} setActive={setView} onLogout={onLogout} />
      <div className="app-main">
        <header className="topbar"><div><span>مركز إدارة الشهادات</span><strong>{title}</strong></div><div><span className="sync-status"><i /> آخر مزامنة: الآن</span><button type="button" className="notification-button" aria-label="الإشعارات">3</button><span className="date-label">3 أغسطس 2026</span></div></header>
        <main id="main-content" className="dashboard-content">
          {view === "overview" && <Overview onImport={() => setModal("import")} onAddCourse={() => setModal("course")} />}
          {view === "courses" && <CoursesView />}
          {view === "trainees" && <TraineesView />}
          {view === "certificates" && <CertificatesView onUpload={() => setModal("upload")} />}
          {view === "imports" && <ImportsView onImport={() => setModal("import")} />}
          {(view === "activity" || view === "settings") && <SimpleView view={view} />}
        </main>
      </div>
      {modal && <Modal type={modal} onClose={() => setModal(null)} onSuccess={success} />}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function CertificateRow({ type, number, available, onDownload }: { type: string; number: string; available: boolean; onDownload: () => void }) {
  return <div className={`certificate-row ${!available ? "muted" : ""}`}><span className="pdf-mark">PDF</span><div><strong>{type}</strong><p>{available ? `رقم الشهادة: ${number}` : "لم تصدر بعد"}</p></div>{available ? <button type="button" className="download-button" onClick={onDownload}>تنزيل PDF</button> : <StatusBadge status="قيد المراجعة" />}</div>;
}

function TraineeDashboard({ onLogout }: { onLogout: () => void }) {
  const [toast, setToast] = useState("");
  function download(title: string) { downloadDemoCertificate(title); setToast("بدأ تنزيل الشهادة بصيغة PDF"); window.setTimeout(() => setToast(""), 2800); }
  return (
    <div className="trainee-shell">
      <a className="skip-link" href="#trainee-content">تجاوز إلى المحتوى</a>
      <header className="trainee-header"><div className="brand-lockup"><span className="brand-symbol" aria-hidden="true"><b /><b /><b /></span><span><strong>معهد التقنيات الصناعية العالي للتدريب</strong><small>بوابة المتدرب</small></span></div><nav aria-label="حساب المتدرب"><button type="button">الملف الشخصي</button><span className="avatar">خ ع</span><button type="button" className="logout-button" onClick={onLogout}>تسجيل الخروج</button></nav></header>
      <main id="trainee-content" className="trainee-main">
        <section className="trainee-welcome"><div><p className="eyebrow light-text">بوابة المتدرب</p><h1>مرحبًا، خالد أحمد</h1><p>جميع دوراتك وشهاداتك التدريبية المعتمدة في مكان واحد.</p></div><div className="identity-card"><span>حساب موثّق</span><strong dir="ltr">هوية تنتهي بـ 4821</strong><small>مرتبط بسجل المعهد</small></div></section>
        <section className="trainee-metrics"><article><p>الدورات المسجلة</p><strong>3</strong><small>دورتان مكتملتان</small></article><article><p>الشهادات المتاحة</p><strong>2</strong><small>جاهزة للتنزيل</small></article><article><p>إجمالي الساعات</p><strong>80</strong><small>ساعة تدريبية</small></article></section>
        <section className="trainee-section-heading"><div><p className="eyebrow">سجلك التدريبي</p><h2>دوراتي وشهاداتي</h2></div><span className="privacy-note">ملفاتك خاصة ولا يمكن الوصول إليها دون تسجيل الدخول</span></section>
        <section className="trainee-courses">
          <article className="trainee-course-card featured"><div className="course-card-head"><div><span className="course-code">CNC-2407</span><h3>تشغيل وبرمجة ماكينات CNC</h3><p>15 يوليو – 8 أغسطس 2026 · 40 ساعة</p></div><StatusBadge status="مكتمل" /></div><div className="completion-strip"><span>اكتمل التدريب</span><i><b style={{ width: "100%" }} /></i><strong>100%</strong></div><div className="certificate-list"><CertificateRow type="الشهادة المحلية" number="LC-2026-04821" available onDownload={() => download("Local CNC Certificate")} /><CertificateRow type="الشهادة الدولية" number="IC-CNC-7791" available onDownload={() => download("International CNC Certificate")} /></div></article>
          <article className="trainee-course-card"><div className="course-card-head"><div><span className="course-code">SAFE-114</span><h3>السلامة والصحة المهنية</h3><p>2 – 6 أغسطس 2026 · 20 ساعة</p></div><StatusBadge status="قيد التدريب" /></div><div className="completion-strip"><span>تقدم الدورة</span><i><b style={{ width: "65%" }} /></i><strong>65%</strong></div><div className="certificate-list"><CertificateRow type="الشهادة المحلية" number="" available={false} onDownload={() => undefined} /></div></article>
          <article className="trainee-course-card"><div className="course-card-head"><div><span className="course-code">WLD-201</span><h3>أساسيات اللحام الصناعي</h3><p>4 – 18 يونيو 2026 · 20 ساعة</p></div><StatusBadge status="مكتمل" /></div><div className="completion-strip"><span>اكتمل التدريب</span><i><b style={{ width: "100%" }} /></i><strong>100%</strong></div><div className="certificate-list"><CertificateRow type="البطاقة الدولية" number="" available={false} onDownload={() => undefined} /></div></article>
        </section>
      </main>
      <footer className="trainee-footer"><span>معهد التقنيات الصناعية العالي للتدريب</span><span>الدعم الفني · سياسة الخصوصية</span></footer>
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState<Role | null>(null);
  if (!session) return <LoginScreen onLogin={setSession} />;
  if (session === "admin") return <AdminDashboard onLogout={() => setSession(null)} />;
  return <TraineeDashboard onLogout={() => setSession(null)} />;
}
