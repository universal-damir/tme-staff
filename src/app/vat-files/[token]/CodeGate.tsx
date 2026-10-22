'use client';

// Round 4 B: "Who are you?" + email code before the VAT filing upload page
// (Damir 11.10.2026). Shown when the page API answers 401
// `email_code_required` (switch VAT_FILES_EMAIL_CODE=on and the request names
// who may open it). The person picks their masked address, gets a 6-digit
// code by email and types it; the server then sets a proof cookie (7 days)
// and the page loads. Someone not on the list is told to ask TME to add them.

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Mail, ShieldCheck, UserX } from 'lucide-react';
import { Button, Card, ClientPageHeader, PageBody } from '@/components/ui';
import { reportClientFailure } from '@/lib/client-error-log';
import { FAILURE_MESSAGES, failureMessage, requestJson, type RequestFailure } from '@/lib/request-outcome';
import { VAT_FILES_CODE_LENGTH, VAT_FILES_PROOF_DAYS, type VatFilesCodeAddress } from '@/types/vat-files';

const MAX_W = 'max-w-[640px]';
const RESEND_SECONDS = 60;

/** Damir's wording (11.10.2026) for someone who is not on the list. */
export const NOT_ON_LIST_TEXT =
  'This page is only for the people we sent the request to. Please ask TME Services to add you.';

/** Demo (next dev only): this code opens the demo page. */
export const DEMO_CODE = '123456';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One plain sentence for a failed code call. */
function codeErrorText(outcome: RequestFailure): string {
  if (outcome.serverMessage) return outcome.serverMessage;
  if (outcome.code === 'unknown_address') return 'Please choose your email address again.';
  if (outcome.code === 'rate_limited' || outcome.kind === 'busy') return FAILURE_MESSAGES.busy;
  return failureMessage(outcome);
}

/** Our own failures are logged; a wrong code or a limit is the person's, not ours. */
function reportIfOurs(action: string, token: string, outcome: RequestFailure): void {
  if (outcome.kind === 'server_error' || outcome.kind === 'timeout' || outcome.kind === 'offline') {
    reportClientFailure({ form: 'vat-files', action, ref: token }, outcome);
  }
}

export default function CodeGate({
  token,
  addresses,
  demo,
  title,
  onConfirmed,
}: {
  token: string;
  addresses: VatFilesCodeAddress[];
  demo: boolean;
  /** "VAT filing Jun - Aug 2026" when known; else a plain title. */
  title: string | null;
  onConfirmed: () => void;
}) {
  const [step, setStep] = useState<'pick' | 'code'>('pick');
  // Local testing only: the code next dev printed instead of mailing it.
  const [devCode, setDevCode] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(addresses.length === 1 ? addresses[0].id : null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notListed, setNotListed] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const picked = addresses.find((a) => a.id === choice) ?? null;

  const sendCode = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    if (demo) {
      await sleep(500);
    } else {
      const outcome = await requestJson<{ ok: true; masked: string; devCode?: string }>(`/api/vat-files/${token}/code/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: picked.id }),
      });
      if (!outcome.ok) {
        reportIfOurs('code-send', token, outcome);
        setError(codeErrorText(outcome));
        setBusy(false);
        return;
      }
      setDevCode(outcome.data.devCode ?? null);
    }
    setBusy(false);
    setCode('');
    setStep('code');
    setCooldown(RESEND_SECONDS);
  };

  const checkCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!picked || busy) return;
    const typed = code.replace(/\s+/g, '');
    if (!new RegExp(`^\\d{${VAT_FILES_CODE_LENGTH}}$`).test(typed)) {
      setError(`Please type the ${VAT_FILES_CODE_LENGTH}-digit code from the email.`);
      return;
    }
    setBusy(true);
    setError(null);
    if (demo) {
      await sleep(400);
      setBusy(false);
      if (typed !== DEMO_CODE) {
        setError('This code is not right. Please check the email and try again.');
        return;
      }
      onConfirmed();
      return;
    }
    const outcome = await requestJson<{ ok: true }>(`/api/vat-files/${token}/code/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: picked.id, code: typed }),
    });
    setBusy(false);
    if (!outcome.ok) {
      reportIfOurs('code-check', token, outcome);
      setError(codeErrorText(outcome));
      return;
    }
    onConfirmed();
  };

  const errorBox = error && (
    <div
      className="mt-4 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-medium leading-snug text-tme-red sm:py-2.5 sm:text-[13px]"
      role="alert"
    >
      <AlertTriangle className="w-[18px] h-[18px] shrink-0 mt-px sm:w-4 sm:h-4" aria-hidden />
      <span>{error}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-tme-page">
      <ClientPageHeader eyebrow="VAT files" title={title || 'VAT filing documents'} maxWidth={MAX_W} />
      <PageBody maxWidth={MAX_W}>
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="w-[18px] h-[18px] text-tme-blue sm:w-4 sm:h-4" aria-hidden />
              {step === 'pick' ? 'Who are you?' : 'Type the code from the email'}
            </span>
          }
          seed="vat-code-gate"
          description={
            step === 'pick'
              ? 'Choose your email address. We will send you a 6-digit code to open the page.'
              : `We sent a ${VAT_FILES_CODE_LENGTH}-digit code to ${picked?.masked ?? 'your email'}. It works for 10 minutes.`
          }
        >
          {step === 'code' && devCode && (
            <div
              className="text-sm rounded-[10px] px-3.5 py-3 border sm:text-[13px] sm:rounded-lg sm:py-2.5"
              style={{ backgroundColor: '#FEF9C3', borderColor: '#FDE047', color: '#713F12' }}
            >
              Dev only, no email sent: the code is <span className="font-semibold tabular-nums tracking-widest">{devCode}</span>
            </div>
          )}

          {step === 'pick' ? (
            <>
              <fieldset>
                <legend className="sr-only">Your email address</legend>
                <div className="space-y-2">
                  {addresses.map((a) => {
                    const on = a.id === choice;
                    return (
                      <label
                        key={a.id}
                        className={`flex items-center gap-3 rounded-[10px] border-2 px-3.5 min-h-[46px] py-2 cursor-pointer transition-colors sm:gap-2.5 sm:rounded-lg sm:border sm:px-3 sm:min-h-10 ${
                          on ? 'border-tme-blue bg-tme-blue/[0.04]' : 'border-gray-200 sm:border-gray-300 hover:bg-gray-50'
                        } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tme-wash`}
                      >
                        <input
                          type="radio"
                          name="vat-files-address"
                          value={a.id}
                          checked={on}
                          onChange={() => {
                            setChoice(a.id);
                            setError(null);
                            setNotListed(false);
                          }}
                          className="sr-only"
                        />
                        <span
                          className={`w-[18px] h-[18px] shrink-0 rounded-full border-2 sm:w-4 sm:h-4 flex items-center justify-center ${on ? 'border-tme-blue' : 'border-gray-300'}`}
                          aria-hidden
                        >
                          {on && <span className="w-2 h-2 rounded-full bg-tme-blue" />}
                        </span>
                        <Mail className="w-[18px] h-[18px] shrink-0 text-gray-500 sm:w-4 sm:h-4" aria-hidden />
                        <span className="text-base text-gray-900 break-all tabular-nums sm:text-sm">{a.masked}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {errorBox}

              <Button tone="primary" onClick={sendCode} disabled={!picked} busy={busy} className="mt-4 w-full">
                Send me the code
              </Button>

              <div className="mt-5 pt-4 border-t border-gray-100">
                {notListed ? (
                  <div className="flex items-start gap-2.5 text-[15px] text-gray-700 leading-snug sm:text-sm" role="status">
                    <UserX className="w-[18px] h-[18px] shrink-0 mt-0.5 text-gray-600" aria-hidden />
                    <p>{NOT_ON_LIST_TEXT}</p>
                  </div>
                ) : (
                  <Button
                    tone="ghost"
                    className="-ml-3"
                    onClick={() => {
                      setNotListed(true);
                      setChoice(null);
                      setError(null);
                    }}
                  >
                    My email address is not on the list
                  </Button>
                )}
              </div>
            </>
          ) : (
            <form onSubmit={checkCode}>
              <label htmlFor="vat-files-code" className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium">
                Code from the email
              </label>
              <input
                id="vat-files-code"
                ref={codeRef}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/[^\d]/g, '').slice(0, VAT_FILES_CODE_LENGTH));
                  setError(null);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={'0'.repeat(VAT_FILES_CODE_LENGTH)}
                maxLength={VAT_FILES_CODE_LENGTH}
                className="w-full h-14 rounded-[10px] border-2 border-gray-200 bg-white text-center text-2xl font-semibold tracking-[0.5em] tabular-nums text-gray-900 placeholder:text-gray-300 transition-colors focus:outline-none focus:border-tme-blue sm:h-12 sm:rounded-lg sm:border sm:border-gray-300 sm:text-xl sm:focus:ring-2 sm:focus:ring-tme-blue/15"
              />
              {errorBox}
              <Button
                type="submit"
                tone="primary"
                disabled={code.length !== VAT_FILES_CODE_LENGTH}
                busy={busy}
                className="mt-4 w-full"
              >
                Open the page
              </Button>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  tone="plain"
                  onClick={() => {
                    setStep('pick');
                    setError(null);
                  }}
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden />
                  Use another address
                </Button>
                <Button tone="ghost" onClick={sendCode} disabled={busy || cooldown > 0}>
                  {cooldown > 0 ? `Send a new code in ${cooldown} s` : 'Send a new code'}
                </Button>
              </div>
              {demo && <p className="mt-3 text-sm text-gray-600 sm:text-[13px]">Demo page: the code is {DEMO_CODE}.</p>}
            </form>
          )}

          <p className="mt-5 text-sm text-gray-600 leading-snug sm:text-[13px]">
            After the code, this page stays open in this browser for {VAT_FILES_PROOF_DAYS} days.
          </p>
        </Card>
      </PageBody>
    </div>
  );
}
