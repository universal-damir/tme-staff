'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { FormProgress } from '@/components/FormProgress';
import { EmployerForm } from '@/components/EmployerForm';
import { EmployeeForm } from '@/components/EmployeeForm';
import type { StaffOnboardingSubmission, EmployerFormData, EmployeeFormData } from '@/types';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Lock } from 'lucide-react';

type PageState =
  | 'loading'
  | 'employer'
  | 'employee'
  | 'combined' // Same-person mode
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
  const [clientIP, setClientIP] = useState<string | null>(null);

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
        } else if (data.is_same_person) {
          if (data.current_step === 'employer') {
            setPageState('combined');
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

  // Get client IP for audit
  useEffect(() => {
    async function fetchIP() {
      try {
        // Use a public IP service or get from headers
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        setClientIP(data.ip);
      } catch {
        // IP fetch failed, will be captured server-side
      }
    }
    fetchIP();
  }, []);

  // Handle employer form submission
  const handleEmployerSubmit = useCallback(
    async (data: EmployerFormData, signature: string) => {
      if (!submission) return;

      setIsSubmitting(true);
      setError(null);

      try {
        if (submission.is_same_person) {
          // Store employer data and show employee section
          setEmployerData(data);
          setShowEmployeeSection(true);
          // Scroll to top when transitioning to employee section
          window.scrollTo({ top: 0, behavior: 'smooth' });
          // Update local submission state
          setSubmission({
            ...submission,
            employer_data: data,
            employer_signature_data: signature,
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
              ip: clientIP || undefined,
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
    [submission, id, clientIP]
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
            ip: clientIP || undefined,
            isSamePerson: submission.is_same_person,
            employerData: submission.is_same_person ? employerData : undefined,
            employerSignature: submission.is_same_person ? submission.employer_signature_data : undefined,
          }),
        });

        if (response.ok) {
          setPageState('success');
        } else {
          setError('Failed to save form. Please try again.');
        }
      } catch (err) {
        console.error('Error submitting employee form:', err);
        setError('An error occurred. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [submission, id, clientIP, employerData]
  );

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
            {submission?.is_same_person
              ? 'Your form has been submitted successfully.'
              : pageState === 'success' && submission?.current_step === 'employer'
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

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="text-2xl md:text-3xl font-bold mb-2"
            style={{ color: TME_COLORS.primary }}
          >
            {isRenewal ? 'Staff Renewal' : 'Staff Onboarding'}
          </h1>
          {submission.staff_name && (
            <p className="text-gray-600">
              <span className="font-medium">{submission.staff_name}</span>
            </p>
          )}
        </div>

        {/* Progress */}
        <FormProgress
          currentStep={showEmployeeSection ? 'employee' : submission.current_step}
          isSamePerson={submission.is_same_person}
        />

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
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
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-gray-400">
          <p>TME Services - Staff {isRenewal ? 'Renewal' : 'Onboarding'} Portal</p>
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
