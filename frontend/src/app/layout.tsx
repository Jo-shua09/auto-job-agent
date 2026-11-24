import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AppToaster } from "@/components/app-toaster";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const themeInitScript = `(function(){try{document.documentElement.classList.toggle('dark',(localStorage.getItem('jh-theme')||'dark')==='dark');}catch(e){document.documentElement.classList.add('dark');}})();`;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const socialImage = siteUrl ? new URL("/logo.png", siteUrl).toString() : undefined;
const siteDescription = "Verdant is an AI-powered job search assistant that finds relevant roles, tailors applications to your verified experience, and keeps every submission under your control.";

export const metadata: Metadata = {
  title: {
    default: "Verdant | AI Job Search Assistant",
    template: "%s | Verdant",
  },
  description: siteDescription,
  applicationName: "Verdant",
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  keywords: [
    "AI job search assistant",
    "automated job search",
    "job application assistant",
    "tailored resume",
    "cover letter generator",
    "job matching",
    "application tracking",
    "career profile",
  ],
  authors: [{ name: "Verdant" }],
  creator: "Verdant",
  category: "technology",
  openGraph: {
    type: "website",
    siteName: "Verdant",
    title: "Verdant | AI Job Search Assistant",
    description: siteDescription,
    url: siteUrl ? new URL("/", siteUrl).toString() : undefined,
    locale: "en_US",
    images: socialImage ? [{ url: socialImage, alt: "Verdant AI job search assistant" }] : undefined,
  },
  twitter: {
    card: socialImage ? "summary_large_image" : "summary",
    title: "Verdant | AI Job Search Assistant",
    description: siteDescription,
    images: socialImage ? [socialImage] : undefined,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${plusJakartaSans.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans antialiased">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
