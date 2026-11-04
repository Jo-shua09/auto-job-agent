import type { Metadata } from "next";

type PageMetadataInput = {
  path: string;
  title: string;
  description: string;
  keywords: string[];
};

export function createPageMetadata({ path, title, description, keywords }: PageMetadataInput): Metadata {
  const socialTitle = `${title} | Verdant`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  return {
    title,
    description,
    keywords,
    alternates: siteUrl ? { canonical: path } : undefined,
    robots: {
      index: false,
      follow: false,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
        "max-video-preview": -1,
        "max-image-preview": "none",
        "max-snippet": -1,
      },
    },
    openGraph: {
      title: socialTitle,
      description,
      siteName: "Verdant",
      locale: "en_US",
      type: "website",
      url: siteUrl ? path : undefined,
    },
    twitter: {
      card: "summary",
      title: socialTitle,
      description,
    },
  };
}
