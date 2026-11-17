import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

// The typeface studioasasi.com is set in.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "ASASI", template: "%s · ASASI" },
  description: "ASASI business management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the shell restores sidebar state onto <html>
    // from an inline script before React hydrates (see app-shell.tsx).
    <html
      lang="en"
      className={`${instrumentSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
