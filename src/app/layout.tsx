import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Mono } from "next/font/google";
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

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
        className={`${geistSans.variable} ${geistMono.variable} ${dmMono.variable} antialiased bg-[#050505] text-white`}
      >
        <Navigation />
        {children}
      </body>
    </html>
  );
}
