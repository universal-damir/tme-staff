'use client';

// Round 4 B: "Who are you?" + email code before the VAT filing upload page
// (Damir 11.10.2026). Shown when the page API answers 401
// `email_code_required` (switch VAT_FILES_EMAIL_CODE=on and the request names
// who may open it). The person picks their masked address, gets a 6-digit
// code by email and types it; the server then sets a proof cookie (7 days)
// and the page loads. Someone not on the list is told to ask TME to add them.

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Mail, ShieldCheck, UserX } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import { reportClientFailure } from '@/lib/client-error-log';
import { FAILURE_MESSAGES, failureMessage, requestJson, type RequestFailure } from '@/lib/request-outcome';
import { VAT_FILES_CODE_LENGTH, VAT_FILES_PROOF_DAYS, type VatFilesCodeAddress } from '@/types/vat-files';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#243F7B]/50';
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

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 bg-[#F6F7F9]">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)] p-5 sm:p-7">
        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: TME_COLORS.secondary }}>
          TME Services
        </div>
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight leading-tight" style={{ color: TME_COLORS.primary }}>
          {title || 'VAT filing documents'}
        </h1>

        <div className="mt-5 flex items-start gap-3">
          <span
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(36,63,123,0.08)', color: TME_COLORS.primary }}
            aria-hidden
          >
            <ShieldCheck className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-gray-900">
              {step === 'pick' ? 'Who are you?' : 'Type the code from the email'}
            </h2>
            <p className="text-[13px] text-gray-600 leading-snug mt-0.5">
              {step === 'pick'
                ? 'Choose your email address. We will send you a 6-digit code to open the page.'
                : `We sent a ${VAT_FILES_CODE_LENGTH}-digit code to ${picked?.masked ?? 'your email'}. It works for 10 minutes.`}
            </p>
          </div>
        </div>

        {step === 'code' && devCode && (
          <div
            className="mt-4 text-[13px] rounded-lg px-3 py-2.5 border"
            style={{ backgroundColor: '#FEF9C3', borderColor: '#FDE047', color: '#713F12' }}
          >
            Dev only, no email sent: the code is <span className="font-semibold tabular-nums tracking-widest">{devCode}</span>
          </div>
        )}

        {error && (
          <div
            className="mt-4 text-[13px] rounded-lg px-3 py-2.5 flex items-start gap-2"
            style={{ backgroundColor: 'rgba(239,68,68,0.07)', color: TME_COLORS.error }}
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            {error}
          </div>
        )}

        {step === 'pick' ? (
          <>
            <fieldset className="mt-4">
              <legend className="sr-only">Your email address</legend>
              <div className="space-y-2">
                {addresses.map((a) => {
                  const on = a.id === choice;
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 h-11 cursor-pointer transition-colors ${
                        on ? 'bg-[#243F7B]/[0.04]' : 'hover:bg-gray-50'
                      } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#243F7B]/50`}
                      style={{ borderColor: on ? TME_COLORS.primary : '#E5E7EB' }}
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
                        className="w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center"
                        style={{ borderColor: on ? TME_COLORS.primary : '#D1D5DB' }}
                        aria-hidden
                      >
                        {on && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TME_COLORS.primary }} />}
                      </span>
                      <Mail className="w-4 h-4 shrink-0 text-gray-400" aria-hidden />
                      <span className="text-[14px] text-gray-900 truncate tabular-nums">{a.masked}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <button
              type="button"
              onClick={sendCode}
              disabled={!picked || busy}
              className={`mt-4 w-full h-10 rounded-lg text-sm font-semibold text-white inline-flex items-center justify-center gap-2 shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 ${FOCUS}`}
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              Send code
            </button>

            <div className="mt-4 pt-4 border-t border-gray-100">
              {notListed ? (
                <div className="flex items-start gap-2.5 text-[13px] text-gray-700 leading-snug" role="status">
                  <UserX className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" aria-hidden />
                  <p>{NOT_ON_LIST_TEXT}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNotListed(true);
                    setChoice(null);
                    setError(null);
                  }}
                  className={`text-[13px] font-medium rounded ${FOCUS}`}
                  style={{ color: TME_COLORS.primary }}
                >
                  My email address is not on the list
                </button>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={checkCode} className="mt-4">
            <label htmlFor="vat-files-code" className="sr-only">
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
              className="w-full h-12 rounded-lg border border-gray-300 text-center text-2xl font-semibold tracking-[0.5em] tabular-nums text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-[#243F7B] focus:ring-2 focus:ring-[#243F7B]/20"
            />
            <button
              type="submit"
              disabled={busy || code.length !== VAT_FILES_CODE_LENGTH}
              className={`mt-3 w-full h-10 rounded-lg text-sm font-semibold text-white inline-flex items-center justify-center gap-2 shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 ${FOCUS}`}
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              Open the page
            </button>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <button
                type="button"
                onClick={() => {
                  setStep('pick');
                  setError(null);
                }}
                className={`inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 rounded ${FOCUS}`}
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
                Use another address
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={busy || cooldown > 0}
                className={`font-medium rounded disabled:text-gray-400 disabled:cursor-not-allowed ${FOCUS}`}
                style={cooldown > 0 || busy ? undefined : { color: TME_COLORS.primary }}
              >
                {cooldown > 0 ? `Send a new code in ${cooldown} s` : 'Send a new code'}
              </button>
            </div>
            {demo && <p className="mt-3 text-xs text-gray-400">Demo page: the code is {DEMO_CODE}.</p>}
          </form>
        )}

        <p className="mt-5 text-xs text-gray-500 leading-snug">
          After the code, this page stays open in this browser for {VAT_FILES_PROOF_DAYS} days.
        </p>
      </div>
    </div>
  );
}
