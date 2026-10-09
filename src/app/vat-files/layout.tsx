import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Without it
// the link preview (Outlook, Teams, WhatsApp) shows the root "TME Staff Onboarding".
export const metadata: Metadata = {
  title: "TME VAT filing documents",
  description: "Send us the documents for your VAT filing",
  openGraph: {
    title: "TME VAT filing documents",
    description: "Send us the documents for your VAT filing",
    siteName: "TME Services",
  },
};

export default function VatFilesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
