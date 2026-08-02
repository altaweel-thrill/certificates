import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3001";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "منصة شهادات معهد التقنيات الصناعية",
    description: "بوابة إدارة الدورات والشهادات التدريبية للمعهد، مع وصول آمن للمسؤولين والمتدربين.",
    openGraph: {
      title: "منصة شهادات معهد التقنيات الصناعية",
      description: "دوراتك وشهاداتك في مكان واحد.",
      locale: "ar_SA",
      type: "website",
      images: [{ url: imageUrl, width: 1733, height: 909, alt: "منصة شهادات معهد التقنيات الصناعية" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "منصة شهادات معهد التقنيات الصناعية",
      description: "دوراتك وشهاداتك في مكان واحد.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
