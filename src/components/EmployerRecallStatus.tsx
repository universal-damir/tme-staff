'use client';

/**
 * Read-only status page the EMPLOYER sees when opening their own link after
 * signing, while the employee has not submitted yet. Offers "Recall and
 * correct" (inline confirm step, not window.confirm) for two-person staff
 * onboardings / renewals that carry an employer access token.
 */

import React, { useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import { Button, Card, ClientPageHeader, FormFooter, PageBody } from '@/components/ui';
import { formatDubaiDateShort } from '@/lib/utils';
import type { EmployerStatusView } from '@/types';
import { requestJson, failureMessage, FAILURE_MESSAGES } from '@/lib/request-outcome';

interface EmployerRecallStatusProps {
  view: EmployerStatusView;
  linkToken: string;
  employerToken: string | null;
  onRecalled: () => void;
}

export function EmployerRecallStatus({
  view,
  linkToken,
  employerToken,
  onRecalled,
}: EmployerRecallStatusProps) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = (view.staff_name ?? '').trim();
  const name = trimmedName || 'the employee';
  const nameStart = trimmedName || 'The employee';
  const date = formatDubaiDateShort(view.employer_signed_at);

  const handleRecall = async () => {
    setSending(true);
    setError(null);
    try {
      const outcome = await requestJson<{ success?: boolean }>(
        `/api/onboarding/${encodeURIComponent(linkToken)}/recall`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employerToken }),
        },
        { form: 'employer', action: 'recall', ref: linkToken }
      );
      if (outcome.ok && outcome.data?.success) {
        onRecalled();
        return;
      }
      const code = outcome.ok ? null : outcome.code;
      if (code === 'already_submitted') {
        setError(
          `${nameStart} has already submitted their part. The form can no longer be recalled. Please contact TME Services if something needs to change.`,
        );
      } else if (code === 'unauthorized') {
        setError(
          'This link cannot recall the form. Please use the link from your latest email from TME Services.',
        );
      } else if (code === 'not_recallable') {
        setError(
          'This form cannot be recalled from this page. If something needs to change, please email portal@tme-services.com.',
        );
      } else if (code === 'conflict') {
        setError('The form changed while you were recalling it. Please reload the page and try again.');
      } else {
        setError(outcome.ok ? FAILURE_MESSAGES.server_error : failureMessage(outcome));
      }
      setConfirming(false);
    } catch {
      setError(FAILURE_MESSAGES.server_error);
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-tme-page">
      <ClientPageHeader
        eyebrow="Employer details"
        title="Waiting for the employee"
        subtitle={trimmedName || undefined}
      />
      <PageBody>
        <Card padded>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center bg-[#E8ECF5]">
              <Clock className="w-6 h-6 text-tme-blue" aria-hidden />
            </div>
            <p className="text-base leading-normal text-gray-700 pt-2.5 sm:text-sm">
              You sent this form to {name}
              {date ? ` on ${date}` : ''}. We are waiting for them to fill in their part.
            </p>
          </div>

          {view.can_recall ? (
            confirming ? (
              <div className="mt-6 rounded-[10px] border-2 border-gray-200 p-4 sm:p-5">
                <h2 className="text-[17px] font-semibold leading-snug mb-2 text-tme-blue sm:text-[15px]">Recall this form?</h2>
                <p className="text-[15px] leading-normal text-gray-600 sm:text-sm">
                  The link we sent to {name} will stop working straight away. Your answers stay filled
                  in. You make your changes and sign again. Then we send {name} a new email with a new
                  link.
                </p>
                <FormFooter className="mt-4">
                  <Button tone="plain" onClick={() => setConfirming(false)} disabled={sending}>
                    Cancel
                  </Button>
                  <Button tone="primary" onClick={handleRecall} busy={sending} disabled={sending}>
                    {sending ? 'Recalling...' : 'Yes, recall the form'}
                  </Button>
                </FormFooter>
              </div>
            ) : (
              <div className="mt-6">
                <p className="text-[15px] leading-normal text-gray-600 mb-4 sm:text-sm">
                  Did you make a mistake in your part? You can take the form back, correct it and sign
                  again.
                </p>
                <Button
                  tone="secondary"
                  fullWidthOnMobile
                  onClick={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  Recall and correct
                </Button>
              </div>
            )
          ) : (
            <p className="mt-6 text-[15px] leading-normal text-gray-600 sm:text-sm">
              If something needs to change, please contact TME Services.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mt-6 p-4 bg-red-50 border border-red-200 rounded-[10px] flex items-start gap-2"
            >
              <AlertCircle className="w-[18px] h-[18px] text-tme-red flex-shrink-0 mt-px" aria-hidden />
              <p className="text-sm font-medium leading-snug text-tme-red">{error}</p>
            </div>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
