'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, ClientPageHeader, PageBody } from '@/components/ui';
import { CompanySetupForm } from '@/components/company-setup/CompanySetupForm';
import { requestJson, failureMessage } from '@/lib/request-outcome';
import type {
  CompanySetupDocuments,
  CompanySetupPrefillData,
  CompanySetupSubmittedData,
} from '@/types/company-setup';
import { AlertTriangle, CheckCircle, Info, Loader2, XCircle } from 'lucide-react';

type PageState =
  | 'loading'
  | 'form'
  | 'success'
  | 'already_submitted'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'error';

interface IntakePayload {
  status: string;
  prefill: CompanySetupPrefillData | null;
  submittedData: Partial<CompanySetupSubmittedData> | null;
  documents: CompanySetupDocuments | null;
  expiresAt: string | null;
}

// The form is wide (three-column rows: name parts, employer details, document
// tiles); the one-message screens (expired, cancelled, thank you) keep the
// narrower 880px column, where a short line reads better.
const FORM_WIDTH = 'max-w-5xl';

function Header({ wide = false }: { wide?: boolean }) {
  return (
    <ClientPageHeader
      eyebrow="Company setup"
      title="Set up your company"
      subtitle="Your new company in the IFZA free zone (International Free Zone Authority, Dubai)"
      maxWidth={wide ? FORM_WIDTH : undefined}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-tme-page">
      <Header />
      <PageBody>{children}</PageBody>
    </div>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-col items-center py-6 sm:py-8 text-center">{children}</div>
    </Card>
  );
}

function CenterTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl sm:text-lg font-semibold mb-2 text-tme-blue">{children}</h2>;
}

export default function CompanySetupIntakePage() {
  const params = useParams();
  const token = String(params?.token ?? '');

  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<IntakePayload | null>(null);
  // Why the form could not be loaded (offline, server error, ...).
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outcome = await requestJson<IntakePayload>(
        `/api/company-setup/${token}`,
        {},
        { form: 'company-setup', action: 'load', ref: token }
      );
      if (cancelled) return;
      if (!outcome.ok) {
        if (outcome.status === 404) return setState('not_found');
        if (outcome.status === 410) {
          // The route names the reason — cancelled and expired are different
          // situations for the client and get different copy.
          return setState(outcome.code === 'cancelled' ? 'cancelled' : 'expired');
        }
        setLoadError(failureMessage(outcome));
        return setState('error');
      }
      setData(outcome.data);
      setState(outcome.data.status === 'submitted' ? 'already_submitted' : 'form');
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <Shell>
        <CenterCard>
          <Loader2 className="w-8 h-8 animate-spin mb-3 text-tme-blue" aria-hidden />
          <span className="text-base text-gray-600 sm:text-sm">Loading your form…</span>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <CenterCard>
          <XCircle className="w-12 h-12 mb-4 text-tme-red" aria-hidden />
          <CenterTitle>We could not open the form</CenterTitle>
          <p className="text-base text-gray-600 max-w-md sm:text-sm">{loadError}</p>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'not_found') {
    return (
      <Shell>
        <CenterCard>
          <XCircle className="w-12 h-12 mb-4 text-tme-red" aria-hidden />
          <CenterTitle>This link is not valid</CenterTitle>
          <p className="text-base text-gray-600 max-w-md sm:text-sm">
            The link may be incorrect. Please use the link from your TME email, or contact your
            TME consultant.
          </p>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'expired') {
    return (
      <Shell>
        <CenterCard>
          <AlertTriangle className="w-12 h-12 mb-4 text-amber-600" aria-hidden />
          <CenterTitle>This link has expired</CenterTitle>
          <p className="text-base text-gray-600 max-w-md sm:text-sm">
            Setup links stay open for a limited time. Anything you already filled in is saved,
            please ask your TME consultant to send you a fresh link and you can carry on where you
            left off.
          </p>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'cancelled') {
    return (
      <Shell>
        <CenterCard>
          <Info className="w-12 h-12 mb-4 text-tme-blue" aria-hidden />
          <CenterTitle>This setup form has been closed</CenterTitle>
          <p className="text-base text-gray-600 max-w-md sm:text-sm">
            TME has closed this company setup form, so it no longer accepts entries. If you did not
            expect this, please contact your TME consultant.
          </p>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'success' || state === 'already_submitted') {
    return (
      <Shell>
        <CenterCard>
          <CheckCircle className="w-12 h-12 mb-4 text-green-600" aria-hidden />
          <CenterTitle>Thank you, we have your details</CenterTitle>
          <p className="text-base text-gray-600 max-w-md sm:text-sm">
            Your TME consultant will check your details and documents and contact you about the
            next steps. The free zone authority still has to approve the company name. You do not
            need to do anything right now.
          </p>
        </CenterCard>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen bg-tme-page">
      <Header wide />
      <CompanySetupForm
        maxWidth={FORM_WIDTH}
        token={token}
        prefill={data?.prefill ?? null}
        savedData={data?.submittedData ?? null}
        savedDocuments={data?.documents ?? null}
        onSubmitted={() => {
          setState('success');
          window.scrollTo({ top: 0 });
        }}
        onClosed={(reason) => {
          // The link stopped accepting writes while the client was working.
          // Expired is the far likelier of the two 410 reasons mid-session.
          setState(reason === 'already_submitted' ? 'already_submitted' : 'expired');
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}
