import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { restorePanesScript } from "@/lib/panes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fred",
  description: "Fred finds your next apartment in New York.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning // the script below puts your pane sizes on <html> before React loads
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: restorePanesScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
