'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { Card, ClientPageHeader, PageBody } from '@/components/ui';
import type { EkycText } from '@/types/ekyc';
import type { EkycClientPayload } from '@/lib/ekyc-token';
import { Bi, BiTitle, EkycBilingualContext } from '@/components/ekyc/Bi';
import { EkycForm, type EkycClosedReason } from '@/components/ekyc/EkycForm';
import { EKYC_UI } from '@/components/ekyc/texts';
import { reportClientFailure } from '@/lib/client-error-log';
import { requestJson } from '@/lib/request-outcome';

type PageState =
  | { kind: 'loading' }
  | { kind: 'form'; payload: EkycClientPayload }
  | { kind: 'not_found' }
  | { kind: 'closed'; bilingual: boolean }
  | { kind: 'error'; offline: boolean };

/**
 * The whole form may hold German (umlauts) and names in any script. The app's
 * root EnglishOnlyBoundary folds typed text to English letters for the
 * authority forms; this attribute opts the eKYC page out of it.
 */
function Shell({ title, eyebrow = true, children }: { title: EkycText; eyebrow?: boolean; children: React.ReactNode }) {
  return (
    <div data-allow-non-english="true" className="min-h-screen bg-tme-page">
      <ClientPageHeader
        eyebrow={eyebrow ? EKYC_UI.area.en : undefined}
        title={<BiTitle text={title} />}
        maxWidth="max-w-3xl"
      />
      <PageBody maxWidth="max-w-3xl">{children}</PageBody>
    </div>
  );
}

/** Unknown link, load error, closed form: the title is in the page band, the card says what to do. */
function MessageCard({ icon, body }: { icon: React.ReactNode; body: EkycText }) {
  return (
    <Card>
      <div className="flex flex-col items-center py-4 text-center sm:py-6">
        {icon}
        <Bi text={body} paragraphs className="max-w-md text-base text-gray-700 sm:text-[15px]" />
      </div>
    </Card>
  );
}

export default function EkycPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const context = { form: 'ekyc', action: 'load', ref: token };
      const outcome = await requestJson<EkycClientPayload>(`/api/kyc/${token}`, { cache: 'no-store' });
      if (cancelled) return;
      if (!outcome.ok) {
        if (outcome.status === 404) return setState({ kind: 'not_found' });
        // The 410 answer carries `bilingual`: the language of the closed page.
        if (outcome.status === 410) {
          return setState({ kind: 'closed', bilingual: outcome.body?.bilingual === true });
        }
        reportClientFailure(context, outcome);
        return setState({ kind: 'error', offline: outcome.kind === 'offline' });
      }
      const payload = outcome.data;
      if (!payload) {
        reportClientFailure(context, { kind: 'server_error', status: outcome.status });
        return setState({ kind: 'error', offline: false });
      }
      setState({ kind: 'form', payload });
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
        <Shell title={EKYC_UI.area} eyebrow={false}>
          <Card>
            <div className="flex flex-col items-center py-6 text-center" role="status">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-tme-blue" aria-hidden="true" />
              <Bi text={EKYC_UI.loading} className="text-base text-gray-600 sm:text-sm" />
            </div>
          </Card>
        </Shell>
      </EkycBilingualContext.Provider>
    );
  }

  if (state.kind === 'not_found' || state.kind === 'error') {
    const notFound = state.kind === 'not_found';
    return (
      <EkycBilingualContext.Provider value={true}>
        <Shell title={notFound ? EKYC_UI.invalidTitle : EKYC_UI.errorTitle}>
          <MessageCard
            icon={<XCircle className="mb-4 h-12 w-12 text-tme-red" aria-hidden="true" />}
            body={
              notFound
                ? EKYC_UI.invalidBody
                : state.kind === 'error' && state.offline
                  ? EKYC_UI.offline
                  : EKYC_UI.errorBody
            }
          />
        </Shell>
      </EkycBilingualContext.Provider>
    );
  }

  if (state.kind === 'closed') {
    return (
      <EkycBilingualContext.Provider value={state.bilingual}>
        <Shell title={EKYC_UI.closedTitle}>
          <MessageCard
            icon={<AlertTriangle className="mb-4 h-12 w-12 text-amber-600" aria-hidden="true" />}
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
      <div data-allow-non-english="true" className="min-h-screen bg-tme-page">
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
