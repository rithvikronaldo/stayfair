import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://acta.money"),
  title: {
    default: "acta — Ledger Sandbox",
    template: "%s — acta",
  },
  description:
    "Multi-currency, double-entry, point-in-time-queryable ledger sandbox for backend engineers. Sign up, get an API key, post your first transaction with curl.",
  openGraph: {
    title: "acta — Ledger Sandbox",
    description:
      "A double-entry Postgres ledger you can sign up to. Multi-currency, point-in-time queryable, multi-tenant.",
    url: "https://acta.money",
    siteName: "acta",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "acta — Ledger Sandbox",
    description:
      "A double-entry Postgres ledger you can sign up to. Multi-currency, point-in-time queryable, multi-tenant.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body className="min-h-screen bg-bg text-fg">{children}</body>
    </html>
  );
}
