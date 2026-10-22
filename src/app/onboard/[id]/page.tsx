'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { FormProgress } from '@/components/FormProgress';
import { EmployerForm } from '@/components/EmployerForm';
import { EmployerRecallStatus } from '@/components/EmployerRecallStatus';
import { EmployeeForm } from '@/components/EmployeeForm';
import { DocumentRequestForm } from '@/components/DocumentRequestForm';
import { DependentForm } from '@/components/DependentForm';
import type {
  StaffOnboardingSubmission,
  EmployerFormData,
  EmployeeFormData,
  EmployerStatusView,
} from '@/types';
import { Loader2, CheckCircle, XCircle, AlertTriangle, AlertCircle, Lock, Info } from 'lucide-react';
import { Card, ClientPageHeader, PageBody } from '@/components/ui';
import { RECALLED_MESSAGE } from '@/lib/submit-validation';
import { sponsorshipTypeFromSponsor } from '@/lib/staff-form-logic';
import {
  requestJson,
  failureMessage,
  FAILURE_MESSAGES,
  type RequestFailure,
} from '@/lib/request-outcome';
import { reportClientFailure } from '@/lib/client-error-log';

/**
 * The submit routes send their own sentence for the cases people can act on
 * (already signed, withdrawn link, missing documents). Show that; otherwise
 * the plain message for the kind of failure.
 */
function submitFailureMessage(failure: RequestFailure): string {
  return failure.serverMessage ?? failureMessage(failure);
}

type PageState =
  | 'loading'
  | 'employer'
  | 'employee'
  | 'combined' // Same-person mode
  | 'document_request' // Re-upload of specific requested documents only
  | 'dependent' // Sponsor registers a dependent (spouse / child / parent / maid)
  | 'success'
  | 'error'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'already_complete'
  | 'token_required'
  | 'employer_status' // Employer opened their own link after signing (read-only + Recall)
  | 'recalled'; // Employee opened a link the employer has withdrawn

function RedirectTimer() {
  const [seconds, setSeconds] = useState(5);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(s => s - 1), 1000);
    const redirect = setTimeout(() => {
      window.location.href = 'https://tme-services.com';
    }, 5000);
    return () => { clearInterval(timer); clearTimeout(redirect); };
  }, []);
  return (
    <a
      href="https://tme-services.com"
      className="inline-flex items-center min-h-11 mt-2 text-[15px] font-medium text-tme-blue underline-offset-2 hover:underline sm:text-sm sm:min-h-9"
    >
      Redirecting to TME Services in {seconds > 0 ? seconds : 0}s...
    </a>
  );
}

type StatusTone = 'red' | 'amber' | 'green';

const STATUS_ICON_BG: Record<StatusTone, string> = {
  red: 'bg-red-100 text-tme-red',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
};

/**
 * One layout for every end / problem state of the link (invalid, expired,
 * cancelled, done ...): cloud header with the title, one white card with the
 * icon and the explanation.
 */
function StatusScreen({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-tme-page">
      <ClientPageHeader title={title} />
      <PageBody>
        <Card>
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full shrink-0 flex items-center justify-center ${STATUS_ICON_BG[tone]}`}>
              <Icon className="w-6 h-6" aria-hidden />
            </div>
            <div className="pt-2.5 text-base leading-normal text-gray-700 sm:text-sm">{children}</div>
          </div>
        </Card>
      </PageBody>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-tme-page flex items-center justify-center p-4">
      <div className="text-center" role="status">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-tme-blue" aria-hidden />
        <p className="text-base text-gray-600 sm:text-sm">Loading your form...</p>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <OnboardingPageInner />
    </Suspense>
  );
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function OnboardingPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const token = searchParams.get('token');
  // Employer access token from the employer's email link. Authorises the
  // employer status page, "Recall and correct" and the re-sign after recall.
  const employerToken = searchParams.get('e');

  const [submission, setSubmission] = useState<StaffOnboardingSubmission | null>(null);
  const [pageState, setPageState] = useState<PageState>(
    UUID_REGEX.test(id) ? 'loading' : 'not_found'
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set from /api/submit-employer: false when the portal sent no employee
  // invitation, so the thank-you text must not claim an email went out.
  const [employeeNotified, setEmployeeNotified] = useState<boolean | undefined>(undefined);
  const [employerStatus, setEmployerStatus] = useState<EmployerStatusView | null>(null);
  // Bumped after a successful recall to re-read the row (now back on the
  // employer step, prefilled).
  const [reloadKey, setReloadKey] = useState(0);

  // For same-person combined form
  const [employerData, setEmployerData] = useState<EmployerFormData | null>(null);
  const [showEmployeeSection, setShowEmployeeSection] = useState(false);

  // Fetch submission data via the server route. The route uses the service
  // role client + token gating so the anon-key fetch (which RLS-leaks every
  // column) is no longer in the page's path.
  useEffect(() => {
    if (!UUID_REGEX.test(id)) return;

    async function fetchSubmission() {
      const loadContext = {
        form: employerToken ? 'employer' : 'employee',
        action: 'load',
        ref: id,
      };
      try {
        const qs = new URLSearchParams();
        if (token) qs.set('token', token);
        if (employerToken) qs.set('e', employerToken);
        const query = qs.toString();
        const url = query ? `/api/onboarding/${id}?${query}` : `/api/onboarding/${id}`;
        const outcome = await requestJson<{ status?: string; view?: string; id?: string }>(
          url,
          { cache: 'no-store' }
        );
        if (!outcome.ok) {
          // These statuses have their own screens; they are not failures to log.
          const status = outcome.body?.status;
          if (outcome.status === 404) {
            setPageState('not_found');
            return;
          }
          if (outcome.status === 403) {
            setPageState(status === 'recalled' ? 'recalled' : 'token_required');
            return;
          }
          if (outcome.status === 410) {
            setPageState(status === 'expired' ? 'expired' : 'cancelled');
            return;
          }
          reportClientFailure(loadContext, outcome);
          setError(failureMessage(outcome));
          setPageState('error');
          return;
        }
        const body = outcome.data;
        // A 200 with an empty answer is our fault, not a missing form.
        if (!body) {
          reportClientFailure(loadContext, { kind: 'server_error', status: outcome.status });
          setError(FAILURE_MESSAGES.server_error);
          setPageState('error');
          return;
        }

        if (body?.view === 'employer_status') {
          setEmployerStatus(body as unknown as EmployerStatusView);
          setPageState('employer_status');
          return;
        }

        const data = body as unknown as StaffOnboardingSubmission;
        if (!data || !data.id) {
          setPageState('not_found');
          return;
        }

        setSubmission(data);

        if (data.status === 'cancelled') {
          setPageState('cancelled');
        } else if (data.status === 'complete') {
          setPageState('already_complete');
        } else if (
          data.onboarding_type === 'document_request' ||
          data.onboarding_type === 'dependent_document_request'
        ) {
          // Document re-request: ONLY the requested documents get uploaded —
          // no employer/employee steps, no signature. The dependent flavour
          // takes the identical path; the SPONSOR uploads on behalf of a
          // dependent already on file. Token gating already happened
          // server-side (current_step='employee' rows require the
          // employee_access_token on the read route; sponsor rows carry none,
          // so the rotatable link_token is the secret).
          setPageState('document_request');
        } else if (
          data.onboarding_type === 'dependent' ||
          data.onboarding_type === 'dependent_renewal'
        ) {
          // Dependent onboarding / renewal: a single-stage form the SPONSOR
          // fills in for their dependent — no employer/employee steps.
          // DependentForm switches itself into renewal mode off
          // onboarding_type. Gating already happened server-side (link_token
          // is the secret; dependent rows carry no employee_access_token).
          setPageState('dependent');
        } else if (data.prefill_employer_data?.visa_track === 'partner_investor') {
          // Partner/Investor track (DET company shareholders): the visa is not
          // employment-based, so the portal creates these rows with the
          // employer stage already skipped (status='employer_completed',
          // current_step='employee', is_same_person=false). Route straight to
          // the employee form — even if a row somehow arrives on the employer
          // step, the salary form must never render for this track.
          setPageState('employee');
        } else if (data.is_same_person) {
          if (data.current_step === 'employer') {
            setPageState('combined');
          } else if (data.current_step === 'employee') {
            // Refresh mid-flow after the employer step was saved server-side.
            // Drop the user straight into the employee section so they don't
            // have to re-fill the employer details + signature they already
            // submitted.
            setPageState('combined');
            setShowEmployeeSection(true);
          } else {
            setPageState('already_complete');
          }
        } else if (data.current_step === 'employee') {
          // Token validation already happened server-side; if we got here
          // with a 200 the token is good (or none was required for this row).
          setPageState('employee');
        } else {
          setPageState(data.current_step as 'employer');
        }
      } catch (err) {
        console.error('Error fetching submission:', err);
        reportClientFailure(loadContext, { kind: 'server_error' });
        setError(FAILURE_MESSAGES.server_error);
        setPageState('error');
      }
    }

    fetchSubmission();
  }, [id, token, employerToken, reloadKey]);

  // Client IP is derived server-side from request headers (see
  // submit-validation.ts `getSignerIp` — P2-3 hardening). The previous
  // browser-side ipify.org fetch is no longer used and was being blocked by
  // the CSP `connect-src` allowlist.

  // Handle employer form submission
  const handleEmployerSubmit = useCallback(
    async (data: EmployerFormData, signature: string) => {
      if (!submission) return;

      setIsSubmitting(true);
      setError(null);

      const submitContext = { form: 'employer', action: 'submit', ref: id };
      const submitInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          employerData: data,
          signature,
          employerToken,
        }),
      };

      try {
        if (submission.is_same_person) {
          // Persist employer data + signature server-side so a refresh
          // doesn't lose them. The portal-side employer-complete webhook
          // recognises is_same_person and skips the employee invite email,
          // it just flips current_step to 'employee' and logs the status.
          const outcome = await requestJson('/api/submit-employer', submitInit, submitContext);

          if (!outcome.ok) {
            setError(submitFailureMessage(outcome));
            return;
          }

          // Store employer data and show employee section
          setEmployerData(data);
          setShowEmployeeSection(true);
          // Scroll to top when transitioning to employee section
          window.scrollTo({ top: 0, behavior: 'smooth' });
          // Update local submission state so refresh-detection lands in the
          // right place and EmployeeForm has the employer data it needs.
          setSubmission({
            ...submission,
            employer_data: data,
            employer_signature_data: signature,
            current_step: 'employee',
          });
        } else {
          // Regular flow - save AND notify via server-side API (guaranteed delivery)
          const outcome = await requestJson<{ employeeNotified?: boolean } | null>(
            '/api/submit-employer',
            submitInit,
            submitContext
          );

          if (outcome.ok) {
            // false = the portal answered but no employee email went out
            // (e.g. no employee email on record): TME sends the link instead.
            setEmployeeNotified(outcome.data?.employeeNotified === false ? false : undefined);
            setPageState('success');
          } else {
            // Show the server's plain-English reason (e.g. already signed,
            // or the link is not the latest one) instead of a generic error.
            setError(submitFailureMessage(outcome));
          }
        }
      } catch (err) {
        console.error('Error submitting employer form:', err);
        reportClientFailure(submitContext, { kind: 'server_error' });
        setError(FAILURE_MESSAGES.server_error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [submission, id, employerToken]
  );

  // Handle employee form submission
  const handleEmployeeSubmit = useCallback(
    async (data: EmployeeFormData, signature: string) => {
      if (!submission) return;

      setIsSubmitting(true);
      setError(null);

      const submitContext = { form: 'employee', action: 'submit', ref: id };
      try {
        // Save AND notify via server-side API (guaranteed delivery)
        const outcome = await requestJson(
          '/api/submit-employee',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              employeeData: data,
              signature,
              isSamePerson: submission.is_same_person,
              // Refresh after the employer step wipes local `employerData`; in
              // that case the server already has the authoritative copy in
              // submission.employer_data, so fall back to it.
              employerData: submission.is_same_person
                ? (employerData || submission.employer_data)
                : undefined,
              employerSignature: submission.is_same_person ? submission.employer_signature_data : undefined,
              // Employee access token from the invitation link — the server
              // checks it so a withdrawn (recalled) link cannot submit.
              token,
            }),
          },
          submitContext
        );

        if (outcome.ok) {
          setPageState('success');
        } else if (outcome.serverMessage === RECALLED_MESSAGE) {
          // The route sends RECALLED_MESSAGE (with code 'recalled') when the
          // employer took the form back.
          setPageState('recalled');
        } else {
          // Surface the server's reason (e.g. the required-documents gate
          // listing what's missing) instead of a generic failure.
          setError(submitFailureMessage(outcome));
        }
      } catch (err) {
        console.error('Error submitting employee form:', err);
        reportClientFailure(submitContext, { kind: 'server_error' });
        setError(FAILURE_MESSAGES.server_error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [submission, id, employerData, token]
  );

  // Partner/Investor track (DET company shareholders) — employer stage is
  // skipped by the portal; the form is addressed to the applicant, not an
  // employee. Derived before the early returns so the success copy below can
  // use it too.
  const isPartnerInvestorTrack =
    submission?.prefill_employer_data?.visa_track === 'partner_investor';

  // Loading state
  if (pageState === 'loading') {
    return <LoadingScreen />;
  }

  // Not found state
  if (pageState === 'not_found') {
    return (
      <StatusScreen title="Link invalid" icon={XCircle} tone="red">
        <p>
          This link is invalid or has expired. If you believe this is an error,
          please contact your HR representative.
        </p>
      </StatusScreen>
    );
  }

  // Cancelled state
  if (pageState === 'cancelled') {
    return (
      <StatusScreen title="Form cancelled" icon={AlertTriangle} tone="amber">
        <p>
          This form has been cancelled. Please contact your HR
          representative for more information.
        </p>
      </StatusScreen>
    );
  }

  // Expired state — link past 14-day window
  if (pageState === 'expired') {
    return (
      <StatusScreen title="Link expired" icon={AlertTriangle} tone="amber">
        <p>
          This onboarding link has expired. Please ask your HR
          representative to send you a new one.
        </p>
      </StatusScreen>
    );
  }

  // Already complete state
  if (pageState === 'already_complete') {
    return (
      <StatusScreen title="Already completed" icon={CheckCircle} tone="green">
        <p>
          This form has already been submitted. Thank you for completing
          the process.
        </p>
      </StatusScreen>
    );
  }

  // Employer opened their own link after signing: read-only status + Recall
  if (pageState === 'employer_status' && employerStatus) {
    return (
      <EmployerRecallStatus
        view={employerStatus}
        linkToken={id}
        employerToken={employerToken}
        onRecalled={() => {
          setEmployerStatus(null);
          setSubmission(null);
          setPageState('loading');
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  // Employee opened a link the employer has withdrawn to make a correction
  if (pageState === 'recalled') {
    return (
      <StatusScreen title="Form withdrawn" icon={AlertTriangle} tone="amber">
        <p>{RECALLED_MESSAGE}</p>
      </StatusScreen>
    );
  }

  // Token required state (employee access without valid token)
  if (pageState === 'token_required') {
    return (
      <StatusScreen title="Email link needed" icon={Lock} tone="amber">
        <p>
          Please use the link sent to your email to access this form.
          If you haven&apos;t received the email, please contact your HR representative.
        </p>
      </StatusScreen>
    );
  }

  // Success state — auto-redirect to TME website after 5 seconds
  if (pageState === 'success') {
    return (
      <StatusScreen title="Thank you" icon={CheckCircle} tone="green">
        <p className="mb-3">
          {submission?.onboarding_type === 'document_request'
            ? 'Your documents have been submitted successfully.'
            : submission?.onboarding_type === 'dependent_document_request'
            ? "The dependent's documents have been submitted successfully."
            : submission?.onboarding_type === 'dependent_renewal'
            ? 'The renewal details have been submitted successfully. TME Services will review them and get in touch.'
            : submission?.onboarding_type === 'dependent'
            ? 'The dependent details have been submitted successfully. TME Services will review them and get in touch.'
            : submission?.is_same_person
            ? 'Your form has been submitted successfully.'
            : !isPartnerInvestorTrack && pageState === 'success' && submission?.current_step === 'employer'
            ? (employeeNotified === false
                ? 'The employer section has been completed. TME Services will send the employee their link.'
                : 'The employer section has been completed. An email has been sent to the employee to complete their section.')
            : 'Your form has been submitted successfully.'}
        </p>
        <p className="text-[15px] text-gray-600 sm:text-sm">You will be redirected shortly...</p>
        <RedirectTimer />
      </StatusScreen>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <StatusScreen title="Something went wrong" icon={XCircle} tone="red">
        <p>{error || 'An unexpected error occurred.'}</p>
      </StatusScreen>
    );
  }

  // Form states
  if (!submission) return null;

  const isRenewal = submission.onboarding_type === 'renewal';
  const isDependentDocumentRequest = submission.onboarding_type === 'dependent_document_request';
  const isDocumentRequest =
    submission.onboarding_type === 'document_request' || isDependentDocumentRequest;
  const isDependentRenewal = submission.onboarding_type === 'dependent_renewal';
  const isDependent = submission.onboarding_type === 'dependent' || isDependentRenewal;
  // Renewal header wording. Only company-sponsored staff renew a residence
  // visa; for family- and self/GCC-sponsored staff the applicant already holds
  // their own visa and TME only files the Labour Card, so their renewal is an
  // Employment ID renewal. Derived the same way as EmployeeForm's gate — the
  // employer's FINAL sponsor pick first, then the prefilled column, then
  // 'company' — so the title matches the flow the applicant actually gets.
  const headerSponsor = (submission.employer_data as Record<string, unknown> | null)?.sponsor as
    | string
    | undefined;
  const headerSponsorshipType = headerSponsor
    ? sponsorshipTypeFromSponsor(headerSponsor)
    : (submission.sponsorship_type ?? 'company');
  // The portal marks a labour-card renewal explicitly — it wins over the
  // sponsor, which can still say Company on a dependent-visa holder.
  const isEmploymentIdRenewal = submission.prefill_employer_data?.renewal_kind === 'labour_card';
  const isShowingEmployer = pageState === 'employer' || (pageState === 'combined' && !showEmployeeSection);
  // Area name above the title in the header band. Document requests and
  // dependent flows are their own areas; otherwise it names the part of the
  // form on screen (employer part, or the employee / applicant part).
  const headerEyebrow = isDocumentRequest
    ? 'Document request'
    : isDependent
    ? 'Dependent visa'
    : isShowingEmployer
    ? 'Employer details'
    : isPartnerInvestorTrack
    ? 'Partner / Investor visa'
    : 'Employee onboarding';

  // Sponsor flows are ABOUT the dependent but ADDRESSED to the sponsor, so the
  // header names the dependent and the sub-line names the sponsor. The portal
  // writes the dependent's name parts + relationship into prefill_employee_data;
  // when it typed no name (possible on a first registration) fall back to
  // "Dependent of <sponsor>", then to a generic label. `staff_name` on these
  // rows is the SPONSOR, never the dependent — don't print it as the subject.
  const dependentPrefill = (submission.prefill_employee_data ?? {}) as {
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    dependent_type?: string;
    sponsor_staff_name?: string;
  };
  const sponsorName = dependentPrefill.sponsor_staff_name || submission.staff_name || null;
  const dependentName =
    [dependentPrefill.first_name, dependentPrefill.middle_name, dependentPrefill.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || (sponsorName ? `Dependent of ${sponsorName}` : 'Your Dependent');
  const dependentRelationship = dependentPrefill.dependent_type
    ? dependentPrefill.dependent_type.toLowerCase()
    : 'dependent';

  const headerTitle = isDependentDocumentRequest
    ? `Document Upload for ${dependentName}`
    : isDocumentRequest
    ? `Document Re-Upload${submission.staff_name ? ` for ${submission.staff_name}` : ''}`
    : isDependentRenewal ? 'Dependent Visa Renewal'
    : isDependent ? 'Dependent Onboarding'
    : isPartnerInvestorTrack
    ? (isRenewal ? 'Partner / Investor Visa Renewal' : 'Partner / Investor Visa Application')
    : isRenewal
    ? (headerSponsorshipType === 'company' && !isEmploymentIdRenewal
        ? 'Staff Visa Renewal'
        : 'Staff Employment ID Renewal')
    : submission.onboarding_type === 'cancel_copy'
    ? 'Confirm Staff Details'
    : 'Staff Onboarding';

  const headerSubtitle = isDependentDocumentRequest ? (
    <>
      You are uploading these documents for your {dependentRelationship}
      {sponsorName ? <> as their sponsor (<span className="font-medium text-gray-700">{sponsorName}</span>)</> : null}.
    </>
  ) : !isDocumentRequest && submission.staff_name ? (
    <span className="font-medium text-gray-700">{submission.staff_name}</span>
  ) : undefined;

  return (
    <div className="min-h-screen bg-tme-page">
      {/* Header band. Never sticky and never a `progress` bar here: the
          employee and dependent forms bring their own sticky step bar, and
          only one sticky element may sit at the top. */}
      <ClientPageHeader eyebrow={headerEyebrow} title={headerTitle} subtitle={headerSubtitle}>
        {/* Progress — the employer/employee step bar makes no sense for a
            document re-request (single upload step, no signature), a
            dependent registration (single-stage form with its own step bar),
            or the Partner/Investor track (no employer step ever exists). */}
        {!isDocumentRequest && !isDependent && !isPartnerInvestorTrack && (
          <FormProgress
            currentStep={showEmployeeSection ? 'employee' : submission.current_step}
            isSamePerson={submission.is_same_person}
          />
        )}
      </ClientPageHeader>

      <PageBody>
        {/* Employer Form - Show in employer state or combined mode before employee */}
        {pageState === 'employer' && submission.employer_recalled && (
          <div className="p-4 rounded-[14px] flex items-start gap-3 border border-tme-line bg-[#F3F5FA]">
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-tme-blue" aria-hidden />
            <p className="text-[15px] leading-normal text-tme-blue sm:text-sm">
              You took this form back to correct it. Your previous answers are filled in. Check
              them, make your changes and sign again. We will then send{' '}
              {(submission.staff_name ?? '').trim() || 'the employee'} a new email with a new link.
            </p>
          </div>
        )}
        {isShowingEmployer && (
          <EmployerForm
            submission={submission}
            onSubmit={handleEmployerSubmit}
            isSubmitting={isSubmitting}
            isRenewal={isRenewal}
            employerToken={employerToken}
          />
        )}

        {/* Employee Form - Show in employee state or combined mode after employer */}
        {(pageState === 'employee' || (pageState === 'combined' && showEmployeeSection)) && (
          <EmployeeForm
            submission={submission}
            onSubmit={handleEmployeeSubmit}
            isSubmitting={isSubmitting}
            reuseEmployerSignature={submission.is_same_person}
          />
        )}

        {/* Document Re-Request — only the requested document slots */}
        {pageState === 'document_request' && (
          <DocumentRequestForm
            submission={submission}
            onSubmitted={() => setPageState('success')}
          />
        )}

        {/* Dependent Onboarding — sponsor fills in one form for their
            dependent (own steps + signature, submits itself). */}
        {pageState === 'dependent' && (
          <DependentForm
            submission={submission}
            onSubmitted={() => setPageState('success')}
          />
        )}

        {/* Error banner — rendered right under the form so it sits just
            below the Submit button. A top-of-page banner would be off-screen
            after the user scrolled through the form, leaving failed submits
            looking like "nothing happened". */}
        {error && (
          <div
            role="alert"
            className="p-4 bg-red-50 border-2 border-red-200 rounded-[10px] flex items-start gap-2"
          >
            <AlertCircle className="w-5 h-5 text-tme-red flex-shrink-0 mt-px" aria-hidden />
            <p className="text-[15px] font-medium leading-snug text-tme-red sm:text-[13px]">{error}</p>
          </div>
        )}

        {/* Footer */}
        <footer className="pt-6 text-center text-sm text-gray-600 sm:text-[13px]">
          <p>TME Services - {isPartnerInvestorTrack ? `Visa ${isRenewal ? 'Renewal' : 'Application'}` : `Staff ${isDocumentRequest ? 'Document' : isDependent ? 'Dependent' : isRenewal ? 'Renewal' : 'Onboarding'}`} Portal</p>
          <p className="mt-1">
            Need help?{' '}
            <a
              href="mailto:portal@tme-services.com"
              className="inline-flex items-center min-h-11 font-medium text-tme-blue underline underline-offset-2 sm:min-h-9"
            >
              Contact us
            </a>
          </p>
        </footer>
      </PageBody>
    </div>
  );
}
