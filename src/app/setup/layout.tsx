import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Without it
// the link preview (Teams, Outlook, WhatsApp) shows the root "TME Staff Onboarding".
export const metadata: Metadata = {
  title: "TME Company Setup",
  description: "Complete your company setup details",
  openGraph: {
    title: "TME Company Setup",
    description: "Complete your company setup details",
    siteName: "TME Services",
  },
};

export default function CompanySetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
