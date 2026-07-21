import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Quotation Manager",
  description: "Build sanitaryware quotations from photographed price tags.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Quotation",
    // "default" keeps web content clear of the status bar — the header
    // isn't built to draw under it (no safe-area padding), so
    // "black-translucent" would let the status bar overlap the hamburger
    // icon and customer name.
    statusBarStyle: "default",
  },
  other: {
    // Next only emits the unprefixed "mobile-web-app-capable" from
    // appleWebApp.capable above. iOS Safari itself still keys standalone
    // (no address bar) mode off the old Apple-prefixed tag specifically —
    // without this exact tag, "Add to Home Screen" opens in Safari with
    // browser chrome instead of full-screen, defeating the whole point.
    "apple-mobile-web-app-capable": "yes",
  },
};

// maximumScale/userScalable lock out accidental pinch-zoom so the installed
// app feels native rather than like a browser tab — 16px inputs (see
// globals.css) already prevent Safari's zoom-on-focus. This doesn't take
// away text scaling: iOS's own accessibility zoom and Larger Text settings
// operate above the page and aren't affected by the viewport meta tag.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
