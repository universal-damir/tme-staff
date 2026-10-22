'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  SPONSOR_OPTIONS,
  WEEKLY_OFF_OPTIONS,
  LEAVE_TYPES,
} from '@/lib/constants';
import { useMohreProfessions } from '@/hooks/useMohreProfessions';
import { Input, Button, CustomDropdown, CustomDatePicker, Card, FieldError, FieldHelp, FormFooter } from '@/components/ui';
import { SalaryBreakdown } from '@/components/SalaryBreakdown';
import { SignaturePad } from '@/components/SignatureCanvas';
import type { EmployerFormData, EmployerFormProps } from '@/types';
import { CANCEL_COPY_INTRO, employerApplicantInUaeForSubmit, isDmccAuthority, pluralizePeriod } from '@/lib/staff-form-logic';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import { uploadDocument, updateDocumentReferences, isUploadFailure } from '@/lib/supabase';
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
    <Card
      seed={title}
      title={
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

/**
 * Read-only view of a salary breakdown — used on renewal to show the current
 * payroll as reference data next to the editable contract salary.
 */
const PAYROLL_OTHER_TYPE_LABELS: Record<NonNullable<EmployerFormData['payroll_salary_other_breakdown']>[number]['type'], string> = {
  education: 'Education / Schooling',
  phone: 'Phone / Telephone',
  commute: 'Commute',
  bonus: 'Bonus',
  salik: 'Salik',
  petrol: 'Petrol / Fuel',
  pension: 'Pension',
  health_insurance: 'Health Insurance',
  car: 'Car',
  flight: 'Flight / Air Ticket',
  prepay_card: 'Prepaid Card',
  other: 'Other',
};

interface ReadOnlySalarySummaryProps {
  currency: string;
  total: number | undefined;
  basic: number | undefined;
  accommodation: number | undefined;
  transport: number | undefined;
  food?: number | undefined;
  other?: number | undefined;
  // Shape-agnostic so the same read-only summary can render either the contract
  // or payroll breakdown (both share the same { type, amount } row shape).
  otherBreakdown?: ReadonlyArray<{ type: string; amount: number }>;
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
  ];
  const hasBreakdown = !!props.otherBreakdown && props.otherBreakdown.length > 0;
  return (
    <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b-2 border-gray-200 text-sm font-medium text-gray-600">
        Currency: <span className="text-tme-blue">{props.currency}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-gray-600">{r.label}</span>
            <span className="font-medium text-tme-blue">{fmt(r.value)}</span>
          </div>
        ))}
        {hasBreakdown && (
          <div className="bg-gray-50 px-3 py-2">
            <div className="text-sm font-medium text-gray-600 mb-1">Other breakdown</div>
            <div className="divide-y divide-gray-100">
              {props.otherBreakdown!.map((entry, idx) => (
                <div key={`${entry.type}-${idx}`} className="flex items-center justify-between pl-3 py-1.5 text-sm">
                  <span className="text-gray-600">
                    {PAYROLL_OTHER_TYPE_LABELS[entry.type as keyof typeof PAYROLL_OTHER_TYPE_LABELS] ?? entry.type}
                  </span>
                  <span className="font-medium text-tme-blue">{fmt(entry.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const TIME_PERIOD_UNIT_OPTIONS = [
  { value: 'days', label: 'Day(s)' },
  { value: 'months', label: 'Month(s)' },
];

export function EmployerForm({ submission, onSubmit, isSubmitting, isRenewal, employerToken }: EmployerFormProps) {
  const { professions: jobTitleOptions, loading: jobTitlesLoading } = useMohreProfessions();
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [matchFeedback, setMatchFeedback] = useState<string | null>(null);
  const [jobTitleSameAsVisa, setJobTitleSameAsVisa] = useState(false);

  // DMCC detection from portal-provided authority
  const registeredAuthority = (submission.prefill_employer_data as Record<string, unknown> | null)?.registered_authority as string | undefined;
  const isDMCC = isDmccAuthority(registeredAuthority);

  // The portal pre-fills dates as ISO (YYYY-MM-DD); CustomDatePicker — and the
  // rest of this form — speak dd.mm.yyyy. Normalize prefilled date fields so a
  // pre-filled starting date both DISPLAYS correctly and SUBMITS in the same
  // format a manual calendar pick produces (string split, not Date(), to avoid
  // timezone day-shifts). Anything already dd.mm.yyyy passes through.
  const normalizedPrefill = ((): Record<string, unknown> | null => {
    const raw = submission.prefill_employer_data as Record<string, unknown> | null;
    if (!raw) return raw;
    const sd = raw.starting_date;
    if (typeof sd === 'string') {
      const m = sd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return { ...raw, starting_date: `${m[3]}.${m[2]}.${m[1]}` };
    }
    return raw;
  })();

  // Job Offer Letter state (DMCC only)
  const [jobOfferLetterDoc, setJobOfferLetterDoc] = useState(submission.documents?.job_offer_letter);

  // 'cancel_copy': a person TME already has on file (visa type change or a
  // move inside the group). They are in the UAE, so the in-UAE question is
  // not asked.
  const isCancelCopy = submission.onboarding_type === 'cancel_copy';

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
    // Order: defaults < portal prefill < saved answers. Saved answers win (a
    // recalled form reopens with everything the employer entered), while
    // prefill-only keys (payroll reference, registered_authority, ...) that
    // the saved data never carried still survive. The signature always
    // starts empty: a recalled form must be signed again.
    defaultValues: {
      salary_currency: 'AED',
      annual_leave_type: 'calendar',
      notice_period_unit: 'months',
      probation_period_unit: 'months',
      weekly_off: 'saturday_sunday',
      annual_leave_days: 30,
      notice_period_value: 1,
      probation_period_value: 6,
      sponsor: 'Company',
      // Accommodation / Transport / Food "Provided" intentionally start unset so
      // the employer must consciously choose each (validated on submit) rather
      // than silently accepting a presumed default. AI extraction or saved data
      // (incl. renewals via prefill below) fills them in when available.
      // Merge pre-fill data from TME Portal (renewals + new-hire LOI/contract) —
      // overrides defaults, but saved data overrides prefill. Dates normalized
      // to dd.mm.yyyy (see normalizedPrefill above).
      ...normalizedPrefill,
      ...(submission.employer_data ?? {}),
    } as EmployerFormData,
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
  const salaryOtherBreakdown = watch('salary_other_breakdown');
  const payrollCurrency = watch('payroll_salary_currency');
  const payrollTotal = watch('payroll_salary_total');
  const payrollBasic = watch('payroll_salary_basic');
  const payrollAccommodation = watch('payroll_salary_accommodation');
  const payrollTransport = watch('payroll_salary_transport');
  const payrollFood = watch('payroll_salary_food');
  const payrollOther = watch('payroll_salary_other');
  const payrollOtherBreakdown = watch('payroll_salary_other_breakdown');
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
  // Validation errors for the "Provided" dropdowns — these are set via setValue
  // (not register), so react-hook-form doesn't validate them; we check on submit.
  const [salaryProvidedErrors, setSalaryProvidedErrors] = useState<{
    accommodation?: string;
    transport?: string;
    food?: string;
  }>({});

  const handleFormSubmit = async (data: EmployerFormData) => {
    if (!isRenewal && !isCancelCopy && applicantInUAE === null) {
      setApplicantInUAEError('Please indicate whether the applicant is currently in the UAE');
      return;
    }
    setApplicantInUAEError(null);

    // The "Provided" dropdowns start unset and must be chosen explicitly.
    const providedErrors: typeof salaryProvidedErrors = {};
    if (!data.accommodation_provided) providedErrors.accommodation = 'Please select';
    if (!data.transport_provided) providedErrors.transport = 'Please select';
    if (!data.food_provided) providedErrors.food = 'Please select';
    if (providedErrors.accommodation || providedErrors.transport || providedErrors.food) {
      setSalaryProvidedErrors(providedErrors);
      return;
    }
    setSalaryProvidedErrors({});

    if (!signature) {
      setSignatureError('Please sign the form');
      return;
    }
    setSignatureError(null);
    // On renewal the question is hidden entirely. Normally the employee MUST
    // be inside the UAE, so we force the flag to true regardless of any
    // previously-saved value from a prior new-hire onboarding. A labour card
    // renewal with uae_presence_rule 'not_required' leaves it unset instead:
    // nobody is asked.
    // 'cancel_copy': the person already holds a UAE visa through TME, so the
    // question is not asked and the answer is Yes.
    const applicantInUaeForSubmit = isCancelCopy
      ? true
      : employerApplicantInUaeForSubmit(
          !!isRenewal,
          submission.prefill_employer_data,
          applicantInUAE
        );
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
    salary_other_breakdown?: EmployerFormData['salary_other_breakdown'];
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
    if (values.salary_other_breakdown !== undefined) {
      setValue('salary_other_breakdown', values.salary_other_breakdown);
    }
    if (values.accommodation_provided !== undefined) {
      setValue('accommodation_provided', values.accommodation_provided);
      setSalaryProvidedErrors((prev) => ({ ...prev, accommodation: undefined }));
    }
    if (values.transport_provided !== undefined) {
      setValue('transport_provided', values.transport_provided);
      setSalaryProvidedErrors((prev) => ({ ...prev, transport: undefined }));
    }
    if (values.food_provided !== undefined) {
      setValue('food_provided', values.food_provided);
      setSalaryProvidedErrors((prev) => ({ ...prev, food: undefined }));
    }
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
    setValue('salary_other_breakdown', payrollOtherBreakdown ?? []);
    showMatchFeedback('contract');
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={`space-y-6 relative ${isSubmitting ? 'pointer-events-none' : ''}`}>
      {isSubmitting && (
        <div className="fixed inset-0 z-50 bg-white/70 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-gray-200 border-t-tme-blue rounded-full animate-spin" />
            <p className="text-[15px] font-medium text-tme-blue sm:text-sm">Submitting your form...</p>
          </div>
        </div>
      )}
      {jobTitlesLoading && (
        <div className="absolute inset-0 z-40 bg-white/80 backdrop-blur-[2px] rounded-[14px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-tme-blue rounded-full animate-spin" />
            <p className="text-[15px] font-medium text-gray-600 sm:text-sm">Loading form data...</p>
          </div>
        </div>
      )}
      {submission.onboarding_type === 'cancel_copy' && (
        <div className="p-4 rounded-[14px] flex items-start gap-3 border border-tme-line bg-[#F3F5FA]">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-tme-blue" aria-hidden />
          <p className="text-[15px] leading-normal text-tme-blue sm:text-sm">
            {CANCEL_COPY_INTRO}
          </p>
        </div>
      )}
      {/* Position Details */}
      <FormSection
        title="Position Details"
        icon={<Briefcase className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
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
              <FieldHelp>Official designation for visa and government documents</FieldHelp>
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
              <div className="flex flex-wrap items-center justify-between gap-x-3 mb-1.5">
                <label className="block text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm sm:font-medium">
                  Job Title (Company) <span className="text-tme-red ml-1" aria-hidden>*</span>
                </label>
                <label className="flex items-center gap-2 min-h-11 sm:min-h-0 text-sm text-gray-700 cursor-pointer select-none">
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
                    className="w-4 h-4 rounded border-gray-300 accent-tme-blue"
                  />
                  Same as Visa
                </label>
              </div>
              {jobTitleSameAsVisa ? (
                <div className="w-full px-3.5 py-2 rounded-[10px] border-2 border-gray-200 min-h-[46px] flex items-center text-base bg-gray-50 text-tme-blue sm:min-h-10 sm:border sm:border-gray-300 sm:rounded-lg sm:text-sm">
                  {jobTitleVisa === 'Other' ? (watch('job_title_visa_custom') || 'Other') : jobTitleVisa || <span className="text-gray-600">Select visa title first</span>}
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
                  <FieldHelp>
                    {submission.is_same_person ? 'Your' : 'Employee’s'} actual position within the company
                  </FieldHelp>
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

      {/* Salary Contract + Payroll — on renewal the payroll card sits right under
          the contract card (stacked, so both stay readable in the 880px column
          and on phones). On new-hire (no payroll yet) only the contract shows. */}
      <div className={isRenewal && payrollTotal !== undefined ? "space-y-6" : ""}>
      {/* Salary Contract — editable */}
      <FormSection
        title="Salary Contract"
        icon={<Banknote className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
      >
        {isRenewal && (
          <p className="text-[15px] leading-normal text-gray-600 mb-4 sm:text-sm">
            The salary as written in the previous employment contract. The renewed contract will be issued with this amount.
          </p>
        )}
        {isRenewal && payrollTotal ? (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button tone="secondary" onClick={handleMatchPayrollToContract}>
              <Copy className="w-4 h-4" aria-hidden />
              Match to current payroll
            </Button>
            {matchFeedback === 'contract' && (
              <span className="text-sm text-green-700 font-medium" role="status">Matched</span>
            )}
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
          otherBreakdown={salaryOtherBreakdown}
          accommodationProvided={accommodationProvided || ''}
          transportProvided={transportProvided || ''}
          foodProvided={foodProvided || ''}
          onChange={handleSalaryChange}
          errors={{
            total: errors.salary_total?.message,
            accommodationProvided: salaryProvidedErrors.accommodation,
            transportProvided: salaryProvidedErrors.transport,
            foodProvided: salaryProvidedErrors.food,
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
          icon={<Banknote className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
        >
          <div className="space-y-3">
            <div
              className="flex items-start gap-3 p-4 rounded-[10px] bg-gray-100"
            >
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-gray-600" aria-hidden />
              <p className="text-[15px] leading-normal text-gray-700 sm:text-sm">
                This is the payroll currently on file — what is actually paid each month.
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
              otherBreakdown={payrollOtherBreakdown}
            />
          </div>
        </FormSection>
      )}
      </div>

      {/* Leave & Terms */}
      <FormSection
        title="Leave & Terms"
        icon={<Calendar className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
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
              <label className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium">
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
              <label className="block text-[15px] leading-snug mb-1.5 sm:text-sm">
                <span className="font-semibold sm:font-medium text-tme-blue">Notice Period</span>
                {' '}
                <span className="text-gray-600">
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
              <label className="block text-[15px] leading-snug mb-1.5 sm:text-sm">
                <span className="font-semibold sm:font-medium text-tme-blue">Probation</span>
                {' '}
                <span className="text-gray-600">
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

      {/* DMCC Job Offer Letter — DMCC authority, NEW HIRE only. DMCC asks for
          the signed and stamped letter when the employee is first onboarded;
          a visa renewal does not need it again, so the slot is hidden there. */}
      {isDMCC && !isRenewal && (
        <FormSection
          title="Job Offer Letter (DMCC Requirement)"
          icon={<FileText className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
        >
          <div className="space-y-4">
            <div
              className="flex items-start gap-3 p-4 rounded-[10px] bg-amber-50 border border-amber-200"
            >
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-700" aria-hidden />
              <div className="text-[15px] leading-normal text-amber-900 sm:text-sm">
                <p className="font-medium">DMCC requires the Job Offer Letter to be stamped and duly signed with a blue pen by both the employer and the employee.</p>
                <p className="mt-1">
                  Please upload the signed and stamped copy. This document will be included in the confirmation document.
                </p>
              </div>
            </div>
            <FileUploadSlot
              label="Signed Job Offer Letter"
              description="PDF or image of the stamped and blue-pen signed letter"
              uploaded={!!jobOfferLetterDoc}
              filename={jobOfferLetterDoc?.filename}
              onUpload={async (file) => {
                const result = await uploadDocument(submission.id, 'job_offer_letter', file);
                // A failure carries its own message; FileUploadSlot shows it.
                if (!isUploadFailure(result)) {
                  setJobOfferLetterDoc(result);
                  const currentDocs: StaffDocumentReferences = submission.documents || {};
                  await updateDocumentReferences(submission.id, { ...currentDocs, job_offer_letter: result }, null, employerToken);
                }
                return result;
              }}
              onRemove={async () => {
                setJobOfferLetterDoc(undefined);
                const currentDocs: StaffDocumentReferences = submission.documents || {};
                const { job_offer_letter: _, ...rest } = currentDocs;
                await updateDocumentReferences(submission.id, rest as StaffDocumentReferences, null, employerToken);
              }}
            />
          </div>
        </FormSection>
      )}

      {/* UAE Visa Status — new-hire path only. On renewal and cancel_copy the
          employee's current visa situation is already known. */}
      {!isRenewal && !isCancelCopy && (
      <FormSection
        title="UAE Visa Status"
        icon={<Globe className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
      >
        <div className="space-y-3">
          <p className="text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm">
            {submission.is_same_person ? 'Are you currently in the UAE?' : 'Is the applicant currently in the UAE?'} <span className="text-tme-red" aria-hidden>*</span>
          </p>
          <div className="flex items-center gap-6" role="radiogroup">
            {([
              { value: true, label: 'Yes' },
              { value: false, label: 'No' },
            ] as const).map((opt) => (
              <label key={opt.label} className="flex items-center gap-2 min-h-11 cursor-pointer sm:min-h-9">
                <input
                  type="radio"
                  name="applicant_in_uae"
                  checked={applicantInUAE === opt.value}
                  onChange={() => {
                    setApplicantInUAE(opt.value);
                    setValue('applicant_in_uae', opt.value);
                    setApplicantInUAEError(null);
                  }}
                  className="w-5 h-5 accent-tme-blue"
                />
                <span className="text-base text-tme-blue sm:text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
          {applicantInUAE === true && (
            <div className="flex items-start gap-2 p-3 rounded-[10px] bg-blue-50">
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-700" aria-hidden />
              <p className="text-[15px] leading-normal text-blue-900 sm:text-sm">
                {submission.is_same_person
                  ? 'You’ll confirm your current visa category (and upload any required supporting documents) later.'
                  : 'The employee will confirm their current visa category (and upload any required supporting documents) during their part of the onboarding form.'}
              </p>
            </div>
          )}
          <FieldError>{applicantInUAEError}</FieldError>
        </div>
      </FormSection>
      )}

      {/* Signature */}
      <FormSection
        title="Signature"
        icon={<FileSignature className="w-[18px] h-[18px] text-tme-blue" aria-hidden />}
      >
        <div className="space-y-4">
          <p className="text-[15px] leading-normal text-gray-600 sm:text-sm">
            By signing below, I confirm that the information provided above is accurate and complete.
          </p>
          <SignaturePad
            onSignatureChange={setSignature}
            disabled={isSubmitting}
            label="Employer Signature"
          />
          <FieldError>{signatureError}</FieldError>
        </div>
      </FormSection>

      {/* Submit Button */}
      <FormFooter>
        <Button
          type="submit"
          tone="primary"
          busy={isSubmitting}
          size="lg"
          fullWidthOnMobile
        >
          {submission.is_same_person ? 'Continue to employee details' : 'Sign and send to employee'}
        </Button>
      </FormFooter>
    </form>
  );
}
