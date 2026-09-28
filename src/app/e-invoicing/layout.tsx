import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Without it
// the link preview (Teams, Outlook, WhatsApp) shows the root "TME Staff Onboarding".
export const metadata: Metadata = {
  title: "TME E-Invoicing Readiness Check",
  description: "Upload sample invoices for your e-invoicing gap analysis",
  openGraph: {
    title: "TME E-Invoicing Readiness Check",
    description: "Upload sample invoices for your e-invoicing gap analysis",
    siteName: "TME Services",
  },
};

export default function EInvoicingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
