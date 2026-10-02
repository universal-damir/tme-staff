import type { Metadata } from 'next';

// The page is a client component, so its title lives here (link previews in
// Outlook, Teams and WhatsApp read it).
export const metadata: Metadata = {
  title: 'TME Services eKYC',
  description: 'Complete your KYC form for TME Services',
  openGraph: {
    title: 'TME Services eKYC',
    description: 'Complete your KYC form for TME Services',
    siteName: 'TME Services',
  },
};

export default function EkycLayout({ children }: { children: React.ReactNode }) {
  return children;
}
