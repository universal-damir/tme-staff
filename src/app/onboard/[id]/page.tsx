'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { FormProgress } from '@/components/FormProgress';
import { EmployerForm } from '@/components/EmployerForm';
import { EmployeeForm } from '@/components/EmployeeForm';
import { DocumentRequestForm } from '@/components/DocumentRequestForm';
import { DependentForm } from '@/components/DependentForm';
import type { StaffOnboardingSubmission, EmployerFormData, EmployeeFormData } from '@/types';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Lock } from 'lucide-react';
import { sponsorshipTypeFromSponsor } from '@/lib/staff-form-logic';

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
  | 'token_required';

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
      className="inline-block mt-4 text-sm hover:underline"
      style={{ color: TME_COLORS.primary }}
    >
      Redirecting to TME Services in {seconds > 0 ? seconds : 0}s...
    </a>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4" style={{ color: TME_COLORS.primary }} />
          <p className="text-gray-600">Loading your form...</p>
        </div>
      </div>
    }>
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

  const [submission, setSubmission] = useState<StaffOnboardingSubmission | null>(null);
  const [pageState, setPageState] = useState<PageState>(
    UUID_REGEX.test(id) ? 'loading' : 'not_found'
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // For same-person combined form
  const [employerData, setEmployerData] = useState<EmployerFormData | null>(null);
  const [showEmployeeSection, setShowEmployeeSection] = useState(false);

  // Fetch submission data via the server route. The route uses the service
  // role client + token gating so the anon-key fetch (which RLS-leaks every
  // column) is no longer in the page's path.
  useEffect(() => {
    if (!UUID_REGEX.test(id)) return;

    async function fetchSubmission() {
      try {
        const url = token
          ? `/api/onboarding/${id}?token=${encodeURIComponent(token)}`
          : `/api/onboarding/${id}`;
        const res = await fetch(url, { cache: 'no-store' });
        const body = await res.json().catch(() => null) as { status?: string } | null;

        if (res.status === 404) {
          setPageState('not_found');
          return;
        }
        if (res.status === 403) {
          setPageState('token_required');
          return;
        }
        if (res.status === 410) {
          if (body?.status === 'cancelled') setPageState('cancelled');
          else if (body?.status === 'expired') setPageState('expired');
          else setPageState('cancelled');
          return;
        }
        if (!res.ok) {
          setError('Failed to load onboarding form');
          setPageState('error');
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
        setError('Failed to load onboarding form');
        setPageState('error');
      }
    }

    fetchSubmission();
  }, [id, token]);

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

      try {
        if (submission.is_same_person) {
          // Persist employer data + signature server-side so a refresh
          // doesn't lose them. The portal-side employer-complete webhook
          // recognises is_same_person and skips the employee invite email,
          // it just flips current_step to 'employee' and logs the status.
          const response = await fetch('/api/submit-employer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              employerData: data,
              signature,
            }),
          });

          if (!response.ok) {
            setError('Failed to save form. Please try again.');
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
          const response = await fetch('/api/submit-employer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              employerData: data,
              signature,
            }),
          });

          if (response.ok) {
            setPageState('success');
          } else {
            setError('Failed to save form. Please try again.');
          }
        }
      } catch (err) {
        console.error('Error submitting employer form:', err);
        setError('An error occurred. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [submission, id]
  );

  // Handle employee form submission
  const handleEmployeeSubmit = useCallback(
    async (data: EmployeeFormData, signature: string) => {
      if (!submission) return;

      setIsSubmitting(true);
      setError(null);

      try {
        // Save AND notify via server-side API (guaranteed delivery)
        const response = await fetch('/api/submit-employee', {
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
          }),
        });

        if (response.ok) {
          setPageState('success');
        } else {
          // Surface the server's reason (e.g. the required-documents gate
          // listing what's missing) instead of a generic failure.
          let message = 'Failed to save form. Please try again.';
          try {
            const body = await response.json();
            if (typeof body?.error === 'string' && body.error) message = body.error;
          } catch {
            // Non-JSON error body — keep the generic message.
          }
          setError(message);
        }
      } catch (err) {
        console.error('Error submitting employee form:', err);
        setError('An error occurred. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [submission, id, employerData]
  );

  // Partner/Investor track (DET company shareholders) — employer stage is
  // skipped by the portal; the form is addressed to the applicant, not an
  // employee. Derived before the early returns so the success copy below can
  // use it too.
  const isPartnerInvestorTrack =
    submission?.prefill_employer_data?.visa_track === 'partner_investor';

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2
            className="w-12 h-12 animate-spin mx-auto mb-4"
            style={{ color: TME_COLORS.primary }}
          />
          <p className="text-gray-600">Loading your form...</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (pageState === 'not_found') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 mx-auto mb-6 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-4">Link Invalid</h1>
          <p className="text-gray-600">
            This link is invalid or has expired. If you believe this is an error,
            please contact your HR representative.
          </p>
        </div>
      </div>
    );
  }

  // Cancelled state
  if (pageState === 'cancelled') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 mx-auto mb-6 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-4">Form Cancelled</h1>
          <p className="text-gray-600">
            This form has been cancelled. Please contact your HR
            representative for more information.
          </p>
        </div>
      </div>
    );
  }

  // Expired state — link past 14-day window
  if (pageState === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 mx-auto mb-6 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-4">Link Expired</h1>
          <p className="text-gray-600">
            This onboarding link has expired. Please ask your HR
            representative to send you a new one.
          </p>
        </div>
      </div>
    );
  }

  // Already complete state
  if (pageState === 'already_complete') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 mx-auto mb-6 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-4">Already Completed</h1>
          <p className="text-gray-600">
            This form has already been submitted. Thank you for completing
            the process.
          </p>
        </div>
      </div>
    );
  }

  // Token required state (employee access without valid token)
  if (pageState === 'token_required') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 mx-auto mb-6 flex items-center justify-center">
            <Lock className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-4">Authentication Required</h1>
          <p className="text-gray-600">
            Please use the link sent to your email to access this form.
            If you haven&apos;t received the email, please contact your HR representative.
          </p>
        </div>
      </div>
    );
  }

  // Success state — auto-redirect to TME website after 5 seconds
  if (pageState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 mx-auto mb-6 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Thank You!</h1>
          <p className="text-gray-600 mb-6">
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
              ? 'The employer section has been completed. An email has been sent to the employee to complete their section.'
              : 'Your form has been submitted successfully.'}
          </p>
          <p className="text-sm text-gray-400">You will be redirected shortly...</p>
          <RedirectTimer />
        </div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 mx-auto mb-6 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-4">Something Went Wrong</h1>
          <p className="text-gray-600">{error || 'An unexpected error occurred.'}</p>
        </div>
      </div>
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
  const isShowingEmployer = pageState === 'employer' || (pageState === 'combined' && !showEmployeeSection);
  // Widen the page only for the renewal employer step, where Salary Contract +
  // Payroll render side-by-side. Other steps (employee form, success states)
  // stay at the narrower default width.
  const containerWidthClass = isRenewal && isShowingEmployer ? 'max-w-6xl' : 'max-w-3xl';

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

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className={`${containerWidthClass} mx-auto`}>
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="text-2xl md:text-3xl font-bold mb-2"
            style={{ color: TME_COLORS.primary }}
          >
            {isDependentDocumentRequest
              ? `Document Upload for ${dependentName}`
              : isDocumentRequest
              ? `Document Re-Upload${submission.staff_name ? ` for ${submission.staff_name}` : ''}`
              : isDependentRenewal ? 'Dependent Visa Renewal'
              : isDependent ? 'Dependent Onboarding'
              : isPartnerInvestorTrack
              ? (isRenewal ? 'Partner / Investor Visa Renewal' : 'Partner / Investor Visa Application')
              : isRenewal
              ? (headerSponsorshipType === 'company'
                  ? 'Staff Visa Renewal'
                  : 'Staff Employment ID Renewal')
              : 'Staff Onboarding'}
          </h1>
          {isDependentDocumentRequest ? (
            <p className="text-gray-600">
              You are uploading these documents for your {dependentRelationship}
              {sponsorName ? <> as their sponsor (<span className="font-medium">{sponsorName}</span>)</> : null}.
            </p>
          ) : !isDocumentRequest && submission.staff_name ? (
            <p className="text-gray-600">
              <span className="font-medium">{submission.staff_name}</span>
            </p>
          ) : null}
        </div>

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

        {/* Forms */}
        <div className="space-y-8">
          {/* Employer Form - Show in employer state or combined mode before employee */}
          {(pageState === 'employer' || (pageState === 'combined' && !showEmployeeSection)) && (
            <EmployerForm
              submission={submission}
              onSubmit={handleEmployerSubmit}
              isSubmitting={isSubmitting}
              isRenewal={isRenewal}
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

          {/* Error banner — rendered at the bottom of the form area so it
              sits just under the Submit button. A top-of-page banner would
              be off-screen after the user scrolled through the form, leaving
              failed submits looking like "nothing happened". */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-gray-400">
          <p>TME Services - {isPartnerInvestorTrack ? `Visa ${isRenewal ? 'Renewal' : 'Application'}` : `Staff ${isDocumentRequest ? 'Document' : isDependent ? 'Dependent' : isRenewal ? 'Renewal' : 'Onboarding'}`} Portal</p>
          <p className="mt-1">
            Need help?{' '}
            <a
              href="mailto:info@tme-services.com"
              className="underline"
              style={{ color: TME_COLORS.primary }}
            >
              Contact us
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
