import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "auntifyeid",
  description: "Turn your photo into an auntie Eid Mubarak video.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#faf7f2",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`}>
      <head>
        {/*
          The four display fonts (Bowlby One / Cinzel / Pinyon Script / Amiri)
          are loaded via direct <link> rather than @import inside globals.css.
          Reason: a CSS @import is parsed only after globals.css itself has
          been fetched and parsed, so it adds a serialized round trip to the
          critical path — measurable on slow mobile networks. With preconnect
          + a top-level <link>, the font CSS request happens in parallel with
          the rest of the page CSS. The display=swap query parameter ensures
          text stays visible during the swap rather than flashing invisible.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* The no-page-custom-font rule fires on every <link> to a font
            stylesheet because it can't tell a root-layout import (shared
            across the whole app) from an ad-hoc page import (the real
            anti-pattern). This lives in the App Router root layout, so it
            loads once per session for the whole site. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bowlby+One&family=Cinzel:ital,wght@0,400;0,600;0,700;1,400;1,700&family=Pinyon+Script&family=Amiri:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
