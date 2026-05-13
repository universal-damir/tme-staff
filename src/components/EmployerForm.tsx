'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  TME_COLORS,
  SPONSOR_OPTIONS,
  WEEKLY_OFF_OPTIONS,
  LEAVE_TYPES,
} from '@/lib/constants';
import { useMohreProfessions } from '@/hooks/useMohreProfessions';
import { Input, Select, Button, CustomDropdown, CustomDatePicker } from '@/components/ui';
import { SalaryBreakdown } from '@/components/SalaryBreakdown';
import { SignaturePad } from '@/components/SignatureCanvas';
import type { EmployerFormData, EmployerFormProps } from '@/types';
import { isDmccAuthority, pluralizePeriod } from '@/lib/staff-form-logic';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import { uploadDocument, updateDocumentReferences } from '@/lib/supabase';
import type { StaffDocumentReferences } from '@/types';
import { Briefcase, Banknote, Calendar, FileSignature, Copy, FileText, Globe, Info } from 'lucide-react';

// Convert string array to dropdown options format
const toDropdownOptions = (items: readonly string[]) =>
  items.map((item) => ({ value: item, label: item }));

interface FormSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function FormSection({ title, icon, children }: FormSectionProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        {icon}
        <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

/**
 * Read-only view of a salary breakdown — used on renewal to show the current
 * payroll as reference data next to the editable contract salary.
 */
interface ReadOnlySalarySummaryProps {
  currency: string;
  total: number | undefined;
  basic: number | undefined;
  accommodation: number | undefined;
  transport: number | undefined;
  food?: number | undefined;
  other?: number | undefined;
  prepayCard?: number | undefined;
}

function ReadOnlySalarySummary(props: ReadOnlySalarySummaryProps) {
  const fmt = (n: number | undefined) =>
    n === undefined || n === null || isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const rows: Array<{ label: string; value: number | undefined }> = [
    { label: 'Monthly Salary (Total)', value: props.total },
    { label: 'Basic', value: props.basic },
    { label: 'Accommodation', value: props.accommodation },
    { label: 'Transport', value: props.transport },
    { label: 'Food', value: props.food },
    { label: 'Other', value: props.other },
    { label: 'Prepaid Card', value: props.prepayCard },
  ];
  return (
    <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b-2 border-gray-200 text-xs font-medium text-gray-600">
        Currency: <span style={{ color: TME_COLORS.primary }}>{props.currency}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-gray-600">{r.label}</span>
            <span className="font-medium" style={{ color: TME_COLORS.primary }}>{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TIME_PERIOD_UNIT_OPTIONS = [
  { value: 'days', label: 'Day(s)' },
  { value: 'months', label: 'Month(s)' },
];

export function EmployerForm({ submission, onSubmit, isSubmitting, isRenewal }: EmployerFormProps) {
  const { professions: jobTitleOptions, loading: jobTitlesLoading } = useMohreProfessions();
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [matchFeedback, setMatchFeedback] = useState<string | null>(null);
  const [jobTitleSameAsVisa, setJobTitleSameAsVisa] = useState(false);

  // DMCC detection from portal-provided authority
  const registeredAuthority = (submission.prefill_employer_data as Record<string, unknown> | null)?.registered_authority as string | undefined;
  const isDMCC = isDmccAuthority(registeredAuthority);

  // Job Offer Letter state (DMCC only)
  const [jobOfferLetterDoc, setJobOfferLetterDoc] = useState(submission.documents?.job_offer_letter);

  // UAE visa status — tri-state so "No" is a real answer, not the absence of one.
  // Prefill from saved data → prefill → null (unanswered).
  const savedApplicantInUAE =
    submission.employer_data?.applicant_in_uae ??
    (submission.prefill_employer_data as Record<string, unknown> | null)?.applicant_in_uae;
  const [applicantInUAE, setApplicantInUAE] = useState<boolean | null>(
    typeof savedApplicantInUAE === 'boolean' ? savedApplicantInUAE : null
  );
  const [applicantInUAEError, setApplicantInUAEError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EmployerFormData>({
    defaultValues: submission.employer_data || {
      salary_currency: 'AED',
      annual_leave_type: 'calendar',
      notice_period_unit: 'months',
      probation_period_unit: 'months',
      weekly_off: 'saturday_sunday',
      annual_leave_days: 30,
      notice_period_value: 1,
      probation_period_value: 6,
      sponsor: 'Company',
      // Default to 'allowance' for accommodation/transport (matches the typical
      // UAE 60/30/10 split) and 'no' for food (rarely provided as cash). AI
      // extraction or saved data overrides these.
      accommodation_provided: 'allowance',
      transport_provided: 'allowance',
      food_provided: 'no',
      // Merge pre-fill data from TME Portal (renewals) — overrides defaults, but saved data overrides prefill
      ...submission.prefill_employer_data,
    },
  });

  const jobTitleVisa = watch('job_title_visa');
  const jobTitleCompany = watch('job_title_company');
  const sponsor = watch('sponsor');
  const salaryCurrency = watch('salary_currency');
  const salaryTotal = watch('salary_total');
  const salaryBasic = watch('salary_basic');
  const salaryAccommodation = watch('salary_accommodation');
  const salaryTransport = watch('salary_transport');
  const salaryFood = watch('salary_food');
  const salaryOther = watch('salary_other');
  const salaryPrepayCard = watch('salary_prepay_card');
  const payrollCurrency = watch('payroll_salary_currency');
  const payrollTotal = watch('payroll_salary_total');
  const payrollBasic = watch('payroll_salary_basic');
  const payrollAccommodation = watch('payroll_salary_accommodation');
  const payrollTransport = watch('payroll_salary_transport');
  const payrollFood = watch('payroll_salary_food');
  const payrollOther = watch('payroll_salary_other');
  const payrollPrepayCard = watch('payroll_salary_prepay_card');
  const startingDate = watch('starting_date');
  const annualLeaveType = watch('annual_leave_type');
  const weeklyOff = watch('weekly_off');
  const noticePeriodValue = watch('notice_period_value');
  const noticePeriodUnit = watch('notice_period_unit');
  const probationPeriodValue = watch('probation_period_value');
  const probationPeriodUnit = watch('probation_period_unit');
  const accommodationProvided = watch('accommodation_provided');
  const transportProvided = watch('transport_provided');
  const foodProvided = watch('food_provided');

  const handleFormSubmit = async (data: EmployerFormData) => {
    if (!isRenewal && applicantInUAE === null) {
      setApplicantInUAEError('Please indicate whether the applicant is currently in the UAE');
      return;
    }
    setApplicantInUAEError(null);
    if (!signature) {
      setSignatureError('Please sign the form');
      return;
    }
    setSignatureError(null);
    // On renewal the checkbox is hidden entirely — the employee MUST be inside
    // the UAE for a visa renewal, so we force the flag to true regardless of
    // any previously-saved value from a prior new-hire onboarding.
    const applicantInUaeForSubmit = isRenewal ? true : (applicantInUAE ?? undefined);
    await onSubmit({ ...data, applicant_in_uae: applicantInUaeForSubmit }, signature);
  };

  const handleSalaryChange = (values: {
    salary_currency: string;
    salary_total: number | undefined;
    salary_basic: number | undefined;
    salary_accommodation: number | undefined;
    salary_transport: number | undefined;
    salary_food?: number | undefined;
    salary_other?: number | undefined;
    salary_prepay_card?: number | undefined;
    accommodation_provided?: 'yes' | 'no' | 'allowance';
    transport_provided?: 'yes' | 'no' | 'allowance';
    food_provided?: 'yes' | 'no' | 'allowance';
  }) => {
    setValue('salary_currency', values.salary_currency);
    setValue('salary_total', values.salary_total as number);
    setValue('salary_basic', values.salary_basic as number);
    setValue('salary_accommodation', values.salary_accommodation as number);
    setValue('salary_transport', values.salary_transport as number);
    setValue('salary_food', values.salary_food);
    setValue('salary_other', values.salary_other);
    setValue('salary_prepay_card', values.salary_prepay_card);
    if (values.accommodation_provided !== undefined) setValue('accommodation_provided', values.accommodation_provided);
    if (values.transport_provided !== undefined) setValue('transport_provided', values.transport_provided);
    if (values.food_provided !== undefined) setValue('food_provided', values.food_provided);
  };

  const showMatchFeedback = (label: string) => {
    setMatchFeedback(label);
    setTimeout(() => setMatchFeedback(null), 1500);
  };

  const handleMatchPayrollToContract = () => {
    setValue('salary_currency', payrollCurrency || 'AED');
    setValue('salary_total', payrollTotal as number);
    setValue('salary_basic', payrollBasic as number);
    setValue('salary_accommodation', payrollAccommodation as number);
    setValue('salary_transport', payrollTransport as number);
    setValue('salary_food', payrollFood);
    setValue('salary_other', payrollOther);
    setValue('salary_prepay_card', payrollPrepayCard);
    showMatchFeedback('contract');
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={`space-y-6 relative ${isSubmitting ? 'pointer-events-none' : ''}`}>
      {isSubmitting && (
        <div className="fixed inset-0 z-50 bg-white/70 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: TME_COLORS.primary }} />
            <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Submitting your form...</p>
          </div>
        </div>
      )}
      {jobTitlesLoading && (
        <div className="absolute inset-0 z-40 bg-white/80 backdrop-blur-[2px] rounded-xl flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: TME_COLORS.primary }} />
            <p className="text-sm font-medium text-gray-500">Loading form data...</p>
          </div>
        </div>
      )}
      {/* Position Details */}
      <FormSection
        title="Position Details"
        icon={<Briefcase className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          {/* Job Titles Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <CustomDropdown
                label="Job Title (Visa)"
                options={jobTitleOptions}
                value={jobTitleVisa || ''}
                onChange={(val) => {
                  setValue('job_title_visa', val);
                  if (jobTitleSameAsVisa) {
                    setValue('job_title_company', val);
                  }
                }}
                error={errors.job_title_visa?.message}
                required
                searchable
                loading={jobTitlesLoading}
                placeholder="Select visa designation..."
                onCustomEntry={(text) => {
                  setValue('job_title_visa', 'Other');
                  setValue('job_title_visa_custom', text);
                  if (jobTitleSameAsVisa) {
                    setValue('job_title_company', 'Other');
                    setValue('job_title_company_custom', text);
                  }
                }}
                customEntryHint="This title may not be available in the authority's approved visa job list. Our team will verify and inform you. You can use this title without restriction for your company job description."
              />
              <p className="text-xs text-gray-500 mt-1">Official designation for visa and government documents</p>
              {jobTitleVisa === 'Other' && (
                <div className="mt-2">
                  <Input
                    label="Specify Visa Job Title"
                    placeholder="Enter visa designation"
                    error={errors.job_title_visa_custom?.message}
                    {...register('job_title_visa_custom', {
                      required: jobTitleVisa === 'Other' ? 'Please specify visa job title' : false,
                    })}
                  />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  className="block text-sm font-medium"
                  style={{ color: TME_COLORS.primary }}
                >
                  Job Title (Company) <span className="text-red-500 ml-1">*</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={jobTitleSameAsVisa}
                    onChange={(e) => {
                      setJobTitleSameAsVisa(e.target.checked);
                      if (e.target.checked && jobTitleVisa) {
                        setValue('job_title_company', jobTitleVisa);
                        if (jobTitleVisa === 'Other') {
                          setValue('job_title_company_custom', watch('job_title_visa_custom') || '');
                        } else {
                          setValue('job_title_company_custom', '');
                        }
                      }
                    }}
                    className="rounded border-gray-300"
                    style={{ accentColor: TME_COLORS.primary }}
                  />
                  Same as Visa
                </label>
              </div>
              {jobTitleSameAsVisa ? (
                <div
                  className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 h-[42px] flex items-center text-sm"
                  style={{ backgroundColor: '#f9fafb', color: TME_COLORS.primary }}
                >
                  {jobTitleVisa === 'Other' ? (watch('job_title_visa_custom') || 'Other') : jobTitleVisa || <span className="text-gray-400">Select visa title first</span>}
                </div>
              ) : (
                <>
                  <CustomDropdown
                    options={jobTitleOptions}
                    value={jobTitleCompany || ''}
                    onChange={(val) => setValue('job_title_company', val)}
                    error={errors.job_title_company?.message}
                    searchable
                    loading={jobTitlesLoading}
                    placeholder="Select company role..."
                    onCustomEntry={(text) => {
                      setValue('job_title_company', 'Other');
                      setValue('job_title_company_custom', text);
                    }}
                    customEntryHint="You can use any title for your internal company designation."
                  />
                  <p className="text-xs text-gray-500 mt-1">Employee&apos;s actual position within the company</p>
                </>
              )}
              {!jobTitleSameAsVisa && jobTitleCompany === 'Other' && (
                <div className="mt-2">
                  <Input
                    label="Specify Company Job Title"
                    placeholder="Enter company role"
                    error={errors.job_title_company_custom?.message}
                    {...register('job_title_company_custom', {
                      required: jobTitleCompany === 'Other' ? 'Please specify company job title' : false,
                    })}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Department + Sponsor Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Department"
              placeholder="e.g. Finance, Operations, IT..."
              {...register('department')}
            />

            <CustomDropdown
              label="Sponsor"
              options={toDropdownOptions(SPONSOR_OPTIONS)}
              value={sponsor || 'Company'}
              onChange={(val) => setValue('sponsor', val)}
              error={errors.sponsor?.message}
              required
              placeholder="Select sponsor..."
            />
          </div>

          {/* Working Location + Responsible Manager Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Working Location"
              placeholder="e.g. JAFZA, DMCC, Dubai..."
              {...register('working_location')}
            />

            <Input
              label="Responsible Manager"
              placeholder="Enter manager name"
              {...register('responsible_manager')}
            />
          </div>
        </div>
      </FormSection>

      {/* Salary Contract — editable */}
      <FormSection
        title="Salary Contract"
        icon={<Banknote className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        {isRenewal && (
          <p className="text-xs text-gray-500 italic mb-3">
            The salary as written in the previous employment contract. The renewed contract will be issued with this amount.
          </p>
        )}
        {isRenewal && payrollTotal ? (
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleMatchPayrollToContract}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-[#243F7B] text-[#243F7B] transition-all hover:bg-[#243F7B] hover:text-white hover:shadow-sm"
            >
              <Copy className="w-3 h-3" />
              Match to current payroll
            </button>
            {matchFeedback === 'contract' && <span className="text-xs text-green-600 font-medium animate-pulse">Matched!</span>}
          </div>
        ) : null}
        <SalaryBreakdown
          currency={salaryCurrency || 'AED'}
          total={salaryTotal}
          basic={salaryBasic}
          accommodation={salaryAccommodation}
          transport={salaryTransport}
          food={salaryFood}
          other={salaryOther}
          prepayCard={salaryPrepayCard}
          accommodationProvided={accommodationProvided || 'no'}
          transportProvided={transportProvided || 'no'}
          foodProvided={foodProvided || 'no'}
          onChange={handleSalaryChange}
          errors={{
            total: errors.salary_total?.message,
          }}
        />
      </FormSection>

      {/* Salary Payroll — renewal only, read-only reference of what is currently
          being paid. Shown so the employer can compare contract vs actual and
          decide whether to update the contract figure above. Not collected on
          new onboarding (no prior payroll exists). */}
      {isRenewal && payrollTotal !== undefined && (
        <FormSection
          title="Current Salary Payroll (reference)"
          icon={<Banknote className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
        >
          <div className="space-y-3">
            <div
              className="flex items-start gap-3 p-4 rounded-lg"
              style={{ backgroundColor: '#F3F4F6' }}
            >
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-gray-500" />
              <p className="text-sm text-gray-700">
                This is the payroll currently on file — what is actually paid each month. It may differ from the contract above (e.g. after a raise). The renewed contract will use the figures in <strong>Salary Contract</strong>, not this. Use “Match to current payroll” above if you want to align the contract with what is being paid.
              </p>
            </div>
            <ReadOnlySalarySummary
              currency={payrollCurrency || salaryCurrency || 'AED'}
              total={payrollTotal}
              basic={payrollBasic}
              accommodation={payrollAccommodation}
              transport={payrollTransport}
              food={payrollFood}
              other={payrollOther}
              prepayCard={payrollPrepayCard}
            />
          </div>
        </FormSection>
      )}

      {/* Leave & Terms */}
      <FormSection
        title="Leave & Terms"
        icon={<Calendar className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          {/* Starting Date — only for new hires */}
          {!isRenewal && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CustomDatePicker
                label="Starting Date"
                value={startingDate || ''}
                onChange={(val) => setValue('starting_date', val)}
                error={errors.starting_date?.message}
                required
              />
            </div>
          )}

          {/* Row 1: Weekly Off | Annual Leave */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CustomDropdown
              label="Weekly Off"
              options={WEEKLY_OFF_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
              value={weeklyOff || 'saturday_sunday'}
              onChange={(val) => setValue('weekly_off', val as 'sunday' | 'saturday_sunday')}
              error={errors.weekly_off?.message}
              required
            />

            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: TME_COLORS.primary }}
              >
                Annual Leave
              </label>
              <div className="flex items-center gap-2">
                <div className="w-20 flex-shrink-0">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="30"
                    error={errors.annual_leave_days?.message}
                    {...register('annual_leave_days', {
                      required: 'Required',
                      pattern: { value: /^\d+$/, message: 'Enter a number' },
                    })}
                  />
                </div>
                <div className="flex-1">
                  <CustomDropdown
                    options={LEAVE_TYPES.map(opt => ({ value: opt.value, label: opt.label }))}
                    value={annualLeaveType || 'calendar'}
                    onChange={(val) => setValue('annual_leave_type', val as 'calendar' | 'working')}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Notice Period | Probation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">
                <span className="font-medium" style={{ color: TME_COLORS.primary }}>Notice Period</span>
                {' '}
                <span className="text-gray-400">
                  ({Number(noticePeriodValue) || 0} {pluralizePeriod(Number(noticePeriodValue), noticePeriodUnit)})
                </span>
              </label>
              <div className="flex gap-2">
                <div className="w-20 flex-shrink-0">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1"
                    error={errors.notice_period_value?.message}
                    {...register('notice_period_value', {
                      required: 'Required',
                      pattern: { value: /^\d+$/, message: 'Enter a number' },
                    })}
                  />
                </div>
                <div className="flex-1">
                  <CustomDropdown
                    options={TIME_PERIOD_UNIT_OPTIONS}
                    value={noticePeriodUnit || 'months'}
                    onChange={(val) => setValue('notice_period_unit', val as 'days' | 'weeks' | 'months')}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm mb-1">
                <span className="font-medium" style={{ color: TME_COLORS.primary }}>Probation</span>
                {' '}
                <span className="text-gray-400">
                  ({Number(probationPeriodValue) || 0} {pluralizePeriod(Number(probationPeriodValue), probationPeriodUnit)})
                </span>
              </label>
              <div className="flex gap-2">
                <div className="w-20 flex-shrink-0">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="6"
                    error={errors.probation_period_value?.message}
                    {...register('probation_period_value', {
                      required: 'Required',
                      pattern: { value: /^\d+$/, message: 'Enter a number' },
                    })}
                  />
                </div>
                <div className="flex-1">
                  <CustomDropdown
                    options={TIME_PERIOD_UNIT_OPTIONS}
                    value={probationPeriodUnit || 'months'}
                    onChange={(val) => setValue('probation_period_unit', val as 'days' | 'weeks' | 'months')}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </FormSection>

      {/* DMCC Job Offer Letter — only for DMCC authority, new-hire path.
          Skipped on renewal (already on file from the original onboarding). */}
      {isDMCC && !isRenewal && (
        <FormSection
          title="Job Offer Letter (DMCC Requirement)"
          icon={<FileText className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
        >
          <div className="space-y-4">
            <div
              className="flex items-start gap-3 p-4 rounded-lg"
              style={{ backgroundColor: '#FEF3C7' }}
            >
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">DMCC requires the Job Offer Letter to be stamped and duly signed with a blue pen by both the employer and the employee.</p>
                <p className="mt-1 text-xs">Please upload the signed and stamped copy. This document will be included in the onboarding confirmation.</p>
              </div>
            </div>
            <FileUploadSlot
              label="Signed Job Offer Letter"
              description="PDF or image of the stamped and blue-pen signed letter"
              uploaded={!!jobOfferLetterDoc}
              filename={jobOfferLetterDoc?.filename}
              onUpload={async (file) => {
                const result = await uploadDocument(submission.id, 'job_offer_letter', file);
                if (result) {
                  setJobOfferLetterDoc(result);
                  const currentDocs: StaffDocumentReferences = submission.documents || {};
                  await updateDocumentReferences(submission.id, { ...currentDocs, job_offer_letter: result });
                }
                return result;
              }}
              onRemove={async () => {
                setJobOfferLetterDoc(undefined);
                const currentDocs: StaffDocumentReferences = submission.documents || {};
                const { job_offer_letter: _, ...rest } = currentDocs;
                await updateDocumentReferences(submission.id, rest as StaffDocumentReferences);
              }}
            />
          </div>
        </FormSection>
      )}

      {/* UAE Visa Status — new-hire path only. On renewal the employee's
          current visa situation is already known from the prior onboarding. */}
      {!isRenewal && (
      <FormSection
        title="UAE Visa Status"
        icon={<Globe className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
            Is the applicant currently in the UAE? <span className="text-red-500">*</span>
          </p>
          <div className="flex items-center gap-6">
            {([
              { value: true, label: 'Yes' },
              { value: false, label: 'No' },
            ] as const).map((opt) => (
              <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="applicant_in_uae"
                  checked={applicantInUAE === opt.value}
                  onChange={() => {
                    setApplicantInUAE(opt.value);
                    setValue('applicant_in_uae', opt.value);
                    setApplicantInUAEError(null);
                  }}
                  className="w-4 h-4"
                  style={{ accentColor: TME_COLORS.primary }}
                />
                <span className="text-sm" style={{ color: TME_COLORS.primary }}>{opt.label}</span>
              </label>
            ))}
          </div>
          {applicantInUAE === true && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-600" />
              <p className="text-xs text-blue-800">
                The employee will confirm their current visa category (and upload any required supporting documents) during their part of the onboarding form.
              </p>
            </div>
          )}
          {applicantInUAEError && (
            <p className="text-sm text-red-500">{applicantInUAEError}</p>
          )}
        </div>
      </FormSection>
      )}

      {/* Signature */}
      <FormSection
        title="Signature"
        icon={<FileSignature className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            By signing below, I confirm that the information provided above is accurate and complete.
          </p>
          <SignaturePad
            onSignatureChange={setSignature}
            disabled={isSubmitting}
            label="Employer Signature"
          />
          {signatureError && (
            <p className="text-sm text-red-500">{signatureError}</p>
          )}
        </div>
      </FormSection>

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button
          type="submit"
          loading={isSubmitting}
          size="lg"
        >
          {submission.is_same_person ? 'Continue to Employee Details' : 'Submit & Send to Employee'}
        </Button>
      </div>
    </form>
  );
}
