'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { CompanySetupForm } from '@/components/company-setup/CompanySetupForm';
import { requestJson, failureMessage } from '@/lib/request-outcome';
import type {
  CompanySetupDocuments,
  CompanySetupPrefillData,
  CompanySetupSubmittedData,
} from '@/types/company-setup';
import { AlertTriangle, CheckCircle, Loader2, XCircle } from 'lucide-react';

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

// `wide` is the form itself: it carries three-column rows (name parts, employer
// details, document tiles) that were being squeezed into a 3xl column while the
// screen stayed empty left and right. The narrow width stays for the one-message
// screens (expired, cancelled, thank you), where a short line reads better.
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen px-4 py-8" style={{ backgroundColor: TME_COLORS.background }}>
      <div className={`mx-auto ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <div className="mb-6">
          <div
            className="text-xs font-semibold tracking-wide uppercase mb-1"
            style={{ color: TME_COLORS.secondary }}
          >
            TME Services: Company Setup
          </div>
          <h1 className="text-2xl font-bold" style={{ color: TME_COLORS.primary }}>
            IFZA Company Setup
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
      <div className="flex flex-col items-center py-8 text-center">{children}</div>
    </div>
  );
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
          <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: TME_COLORS.primary }} />
          <span className="text-gray-500">Loading…</span>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <CenterCard>
          <XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            We could not open the form
          </h2>
          <p className="text-gray-600 max-w-md">{loadError}</p>
        </CenterCard>
      </Shell>
    );
  }

  if (state === 'not_found') {
    return (
      <Shell>
        <CenterCard>
          <XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This link is not valid
          </h2>
          <p className="text-gray-600">
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
          <AlertTriangle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This link has expired
          </h2>
          <p className="text-gray-600 max-w-md">
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
          <AlertTriangle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This setup form has been closed
          </h2>
          <p className="text-gray-600 max-w-md">
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
          <CheckCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.success }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            Thank you, we have received your submission
          </h2>
          <p className="text-gray-600 max-w-md">
            Our team will review your details and documents, and your TME consultant will be in
            touch with the next steps. Please note that the company names remain subject to
            authority approval. No further action is needed from you right now.
          </p>
        </CenterCard>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <CompanySetupForm
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
    </Shell>
  );
}
