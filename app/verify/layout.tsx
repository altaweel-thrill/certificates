import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "التحقق من الشهادات | معهد التقنيات الصناعية",
  description: "تحقق من صحة الشهادات الصادرة عن معهد التقنيات الصناعية العالي للتدريب.",
};

export default function VerificationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
