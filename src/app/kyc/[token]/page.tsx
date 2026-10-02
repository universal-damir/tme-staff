'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import type { EkycText } from '@/types/ekyc';
import type { EkycClientPayload } from '@/lib/ekyc-token';
import { Bi, EkycBilingualContext } from '@/components/ekyc/Bi';
import { EkycForm, type EkycClosedReason } from '@/components/ekyc/EkycForm';
import { EKYC_UI } from '@/components/ekyc/texts';

type PageState =
  | { kind: 'loading' }
  | { kind: 'form'; payload: EkycClientPayload }
  | { kind: 'not_found' }
  | { kind: 'closed'; bilingual: boolean }
  | { kind: 'error' };

/**
 * The whole form may hold German (umlauts) and names in any script. The app's
 * root EnglishOnlyBoundary folds typed text to English letters for the
 * authority forms; this attribute opts the eKYC page out of it.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-allow-non-english="true"
      className="min-h-screen px-4 py-6 sm:py-8"
      style={{ backgroundColor: TME_COLORS.background }}
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 text-xs font-semibold uppercase tracking-wide" style={{ color: TME_COLORS.secondary }}>
          {EKYC_UI.brand.en}
        </div>
        {children}
      </div>
    </div>
  );
}

function MessageCard({ icon, title, body }: { icon: React.ReactNode; title: EkycText; body: EkycText }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
      <div className="flex flex-col items-center py-6 text-center">
        {icon}
        <h1 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
          <Bi text={title} />
        </h1>
        <Bi text={body} paragraphs className="max-w-md text-gray-600" />
      </div>
    </div>
  );
}

export default function EkycPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/kyc/${token}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) return setState({ kind: 'not_found' });
        if (res.status === 410) {
          const body = (await res.json().catch(() => ({}))) as { bilingual?: boolean };
          return setState({ kind: 'closed', bilingual: body.bilingual === true });
        }
        if (!res.ok) return setState({ kind: 'error' });
        const payload = (await res.json()) as EkycClientPayload;
        setState({ kind: 'form', payload });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Before the form is known (loading, unknown link, load error) the page
  // cannot tell whether the client reads German, so it shows both languages.
  if (state.kind === 'loading') {
    return (
      <EkycBilingualContext.Provider value={true}>
        <Shell>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 flex flex-col items-center text-center">
            <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: TME_COLORS.primary }} />
            <Bi text={EKYC_UI.loading} className="text-gray-500" />
          </div>
        </Shell>
      </EkycBilingualContext.Provider>
    );
  }

  if (state.kind === 'not_found' || state.kind === 'error') {
    const notFound = state.kind === 'not_found';
    return (
      <EkycBilingualContext.Provider value={true}>
        <Shell>
          <MessageCard
            icon={<XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />}
            title={notFound ? EKYC_UI.invalidTitle : EKYC_UI.errorTitle}
            body={notFound ? EKYC_UI.invalidBody : EKYC_UI.errorBody}
          />
        </Shell>
      </EkycBilingualContext.Provider>
    );
  }

  if (state.kind === 'closed') {
    return (
      <EkycBilingualContext.Provider value={state.bilingual}>
        <Shell>
          <MessageCard
            icon={<AlertTriangle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />}
            title={EKYC_UI.closedTitle}
            body={EKYC_UI.closedBody}
          />
        </Shell>
      </EkycBilingualContext.Provider>
    );
  }

  const { payload } = state;
  const readOnly = payload.status === 'submitted';

  const onClosed = (reason: EkycClosedReason) => {
    if (reason === 'submitted') {
      // Submitted in another tab: reload the locked version from the server.
      window.location.reload();
      return;
    }
    setState({ kind: 'closed', bilingual: payload.bilingual });
    window.scrollTo({ top: 0 });
  };

  // The form draws its own full-width page (sticky header, step list).
  return (
    <EkycBilingualContext.Provider value={payload.bilingual}>
      <div data-allow-non-english="true" className="min-h-screen" style={{ backgroundColor: TME_COLORS.background }}>
        <EkycForm
          // Remount when the form locks, so it re-renders read-only from the submitted answers.
          key={readOnly ? 'locked' : 'open'}
          token={token}
          payload={payload}
          readOnly={readOnly}
          onClosed={onClosed}
          onSubmitted={(formData, documents) => {
            setState({ kind: 'form', payload: { ...payload, status: 'submitted', formData, documents } });
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    </EkycBilingualContext.Provider>
  );
}
