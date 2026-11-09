import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MOAI OS", template: "%s · MOAI OS" },
  description: "Piattaforma gestionale MOAI Athletics",
  robots: { index: false, follow: false },
  applicationName: "MOAI OS",
  appleWebApp: { capable: true, title: "MOAI OS", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eae7e7" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

/**
 * Runs before first paint: applies the saved theme (light / dark / system), marks the desktop
 * app (its WebView adds "MOAIOSDesktop" to the user agent) and restores the collapsed sidebar.
 */
const BOOT = `(function(){try{var d=document.documentElement;var m=window.matchMedia('(prefers-color-scheme: dark)');var a=function(){var t=localStorage.getItem('moai-theme')||'system';d.dataset.theme=(t==='system'?(m.matches?'dark':'light'):t)};a();window.__moaiTheme=a;if(m.addEventListener)m.addEventListener('change',a);if(/MOAIOSDesktop/.test(navigator.userAgent))d.dataset.desktop='1';if(localStorage.getItem('moai-sidebar')==='collapsed')d.dataset.sidebar='collapsed';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
