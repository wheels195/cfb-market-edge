import type { Metadata } from "next";
import { Geist, Geist_Mono, Ubuntu_Mono } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/Navigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ubuntuMono = Ubuntu_Mono({
  variable: "--font-ubuntu-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Whodl Bets - Quantitative Sports Betting",
  description: "Data-driven CFB and CBB spread predictions using ensemble models",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ubuntuMono.variable} antialiased bg-[#050505] text-white`}
      >
        <Navigation />
        {children}
      </body>
    </html>
  );
}
