'use client';

/**
 * Read-only status page the EMPLOYER sees when opening their own link after
 * signing, while the employee has not submitted yet. Offers "Recall and
 * correct" (inline confirm step, not window.confirm) for two-person staff
 * onboardings / renewals that carry an employer access token.
 */

import React, { useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { formatDubaiDateShort } from '@/lib/utils';
import type { EmployerStatusView } from '@/types';

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
      const res = await fetch(`/api/onboarding/${encodeURIComponent(linkToken)}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employerToken }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (res.ok && body?.success) {
        onRecalled();
        return;
      }
      if (body?.error === 'already_submitted') {
        setError(
          `${nameStart} has already submitted their part. The form can no longer be recalled. Please contact TME Services if something needs to change.`,
        );
      } else if (body?.error === 'unauthorized') {
        setError(
          'This link cannot recall the form. Please use the link from your latest email from TME Services.',
        );
      } else {
        setError('Something went wrong. Please reload the page and try again.');
      }
      setConfirming(false);
    } catch {
      setError('Something went wrong. Please reload the page and try again.');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div
          className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
          style={{ backgroundColor: '#E8ECF5' }}
        >
          <Clock className="w-8 h-8" style={{ color: TME_COLORS.primary }} />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-4">Waiting for the employee</h1>
        <p className="text-gray-600">
          You sent this form to {name}
          {date ? ` on ${date}` : ''}. We are waiting for them to fill in their part.
        </p>

        {view.can_recall ? (
          confirming ? (
            <div className="mt-6 text-left rounded-lg border-2 border-gray-200 p-4">
              <h2 className="text-base font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
                Recall this form?
              </h2>
              <p className="text-sm text-gray-600">
                The link we sent to {name} will stop working straight away. Your answers stay filled
                in. You make your changes and sign again. Then we send {name} a new email with a new
                link.
              </p>
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleRecall}
                  disabled={sending}
                >
                  {sending ? 'Recalling...' : 'Yes, recall the form'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-sm text-gray-600 mb-4">
                Did you make a mistake in your part? You can take the form back, correct it and sign
                again.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
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
          <p className="mt-6 text-sm text-gray-600">
            If something needs to change, please contact TME Services.
          </p>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-left">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
