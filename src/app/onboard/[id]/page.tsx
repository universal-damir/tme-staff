'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import {
  getStaffOnboarding,
  updateEmployerData,
  updateEmployeeData,
  updateSamePersonData,
} from '@/lib/supabase';
import { FormProgress } from '@/components/FormProgress';
import { EmployerForm } from '@/components/EmployerForm';
import { EmployeeForm } from '@/components/EmployeeForm';
import type { StaffOnboardingSubmission, EmployerFormData, EmployeeFormData } from '@/types';
import { Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

type PageState =
  | 'loading'
  | 'employer'
  | 'employee'
  | 'combined' // Same-person mode
  | 'success'
  | 'error'
  | 'not_found'
  | 'cancelled'
  | 'already_complete';

export default function OnboardingPage() {
  const params = useParams();
  const id = params.id as string;

  const [submission, setSubmission] = useState<StaffOnboardingSubmission | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientIP, setClientIP] = useState<string | null>(null);

  // For same-person combined form
  const [employerData, setEmployerData] = useState<EmployerFormData | null>(null);
  const [showEmployeeSection, setShowEmployeeSection] = useState(false);

  // Fetch submission data
  useEffect(() => {
    async function fetchSubmission() {
      try {
        const data = await getStaffOnboarding(id);

        if (!data) {
          setPageState('not_found');
          return;
        }

        setSubmission(data);

        // Determine page state based on submission status
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
        } else {
          setPageState(data.current_step as 'employer' | 'employee');
        }
      } catch (err) {
        console.error('Error fetching submission:', err);
        setError('Failed to load onboarding form');
        setPageState('error');
      }
    }

    fetchSubmission();
  }, [id]);

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
          // Update local submission state
          setSubmission({
            ...submission,
            employer_data: data,
            employer_signature_data: signature,
          });
        } else {
          // Regular flow - save and trigger employee email
          const success = await updateEmployerData(id, data, signature, clientIP || undefined);

          if (success) {
            // TODO: Trigger employee email via TME Portal API
            // await triggerEmployeeEmail(id);
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
        let success: boolean;

        if (submission.is_same_person && employerData) {
          // Same-person mode - save both in one go
          success = await updateSamePersonData(
            id,
            employerData,
            data,
            submission.employer_signature_data || signature,
            clientIP || undefined
          );
        } else {
          // Regular flow - just save employee data
          success = await updateEmployeeData(id, data, signature, clientIP || undefined);
        }

        if (success) {
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
          <p className="text-gray-600">Loading your onboarding form...</p>
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
          <h1 className="text-xl font-bold text-gray-900 mb-4">Form Not Found</h1>
          <p className="text-gray-600">
            This onboarding link is invalid or has expired. Please contact your HR
            representative for a new link.
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
            This onboarding form has been cancelled. Please contact your HR
            representative for more information.
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
            This onboarding form has already been submitted. Thank you for completing
            your onboarding process.
          </p>
        </div>
      </div>
    );
  }

  // Success state
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
              ? 'Your onboarding form has been submitted successfully.'
              : pageState === 'success' && submission?.current_step === 'employer'
              ? 'The employer section has been completed. An email has been sent to the employee to complete their section.'
              : 'Your onboarding form has been submitted successfully.'}
          </p>
          <p className="text-sm text-gray-400">You can close this window.</p>
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

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="text-2xl md:text-3xl font-bold mb-2"
            style={{ color: TME_COLORS.primary }}
          >
            Staff Onboarding
          </h1>
          {submission.staff_name && (
            <p className="text-gray-600">
              Welcome, <span className="font-medium">{submission.staff_name}</span>
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
          <p>TME Services - Staff Onboarding Portal</p>
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
