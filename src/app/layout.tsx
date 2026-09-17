import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { EnglishOnlyBoundary } from "@/components/EnglishOnlyBoundary";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TME Staff Onboarding",
  description: "Complete your staff onboarding process",
  icons: {
    icon: '/favicon.ico',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className={`${inter.className} antialiased bg-gray-50`}>
        {/* Everything typed in this app lands on an ICP, MoHRE or DET form,
            and those take English letters only. Folds anything else as it is
            typed or pasted, in every form, including ones added later. */}
        <EnglishOnlyBoundary>{children}</EnglishOnlyBoundary>
      </body>
    </html>
  );
}
