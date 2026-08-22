'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { CompanySetupForm } from '@/components/company-setup/CompanySetupForm';
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
  | 'closed' // cancelled / expired
  | 'error';

interface IntakePayload {
  status: string;
  prefill: CompanySetupPrefillData | null;
  submittedData: Partial<CompanySetupSubmittedData> | null;
  documents: CompanySetupDocuments | null;
  expiresAt: string | null;
}

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen px-4 py-8" style={{ backgroundColor: TME_COLORS.background }}>
      <div className={`mx-auto ${wide ? 'max-w-3xl' : 'max-w-2xl'}`}>
        <div className="mb-6">
          <div
            className="text-xs font-semibold tracking-wide uppercase mb-1"
            style={{ color: TME_COLORS.secondary }}
          >
            TME Services — Company Setup
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/company-setup/${token}`);
        if (cancelled) return;
        if (res.status === 404) return setState('not_found');
        if (res.status === 410) return setState('closed');
        if (!res.ok) return setState('error');
        const json: IntakePayload = await res.json();
        setData(json);
        setState(json.status === 'submitted' ? 'already_submitted' : 'form');
      } catch {
        if (!cancelled) setState('error');
      }
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

  if (state === 'not_found' || state === 'error') {
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

  if (state === 'closed') {
    return (
      <Shell>
        <CenterCard>
          <AlertTriangle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This link has expired
          </h2>
          <p className="text-gray-600">Please contact your TME consultant to receive a fresh link.</p>
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
            Thank you — we have received your submission
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
      />
    </Shell>
  );
}
