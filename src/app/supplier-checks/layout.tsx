import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Without it
// the link preview (Teams, Outlook, WhatsApp) shows the root "TME Staff Onboarding".
export const metadata: Metadata = {
  title: "TME Supplier Verification Policy",
  description: "Confirm the details for your Supplier Verification Policy",
  openGraph: {
    title: "TME Supplier Verification Policy",
    description: "Confirm the details for your Supplier Verification Policy",
    siteName: "TME Services",
  },
};

export default function SupplierChecksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
