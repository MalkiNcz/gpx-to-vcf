import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ThemeToggle from "@/app/components/theme-toggle";
import "./globals.css";

const themeInitScript = `(function(){try{var stored=localStorage.getItem("theme");var dark=stored?stored==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(dark)document.documentElement.classList.add("dark");}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GPX to VCF",
  description: "Route format converter",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-dvh flex items-center justify-center">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
