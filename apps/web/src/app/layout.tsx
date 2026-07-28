import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Business Factory", template: "%s · Business Factory" },
  description: "Operations platform for AI-assisted businesses",
  // iOS home-screen install: standalone chrome + the branded title.
  appleWebApp: { capable: true, title: "Factory", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
  // Let the layout paint edge-to-edge behind the iPhone notch / home bar;
  // safe-area insets are handled by the dashboard shell.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
