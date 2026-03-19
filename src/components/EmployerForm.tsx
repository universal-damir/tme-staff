'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  TME_COLORS,
  JOB_TITLES,
  DEPARTMENTS,
  SPONSOR_OPTIONS,
  WEEKLY_OFF_OPTIONS,
  LEAVE_TYPES,
} from '@/lib/constants';
import { Input, Select, Button, CustomDropdown, CustomDatePicker } from '@/components/ui';
import { SalaryBreakdown } from '@/components/SalaryBreakdown';
import { SignaturePad } from '@/components/SignatureCanvas';
import type { EmployerFormData, EmployerFormProps } from '@/types';
import { Briefcase, Banknote, Calendar, FileSignature } from 'lucide-react';

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

// Helper function to pluralize time units
function pluralize(value: number | undefined, singular: string): string {
  if (value === undefined || value === null) return singular + 's';
  return value === 1 ? singular : singular + 's';
}

export function EmployerForm({ submission, onSubmit, isSubmitting }: EmployerFormProps) {
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [jobTitleSameAsVisa, setJobTitleSameAsVisa] = useState(false);

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
      // Merge pre-fill data from TME Portal (renewals) — overrides defaults, but saved data overrides prefill
      ...submission.prefill_employer_data,
    },
  });

  const jobTitleVisa = watch('job_title_visa');
  const jobTitleCompany = watch('job_title_company');
  const department = watch('department');
  const sponsor = watch('sponsor');
  const salaryCurrency = watch('salary_currency');
  const salaryTotal = watch('salary_total');
  const salaryBasic = watch('salary_basic');
  const salaryAccommodation = watch('salary_accommodation');
  const salaryTransport = watch('salary_transport');
  const salaryFood = watch('salary_food');
  const salaryOther = watch('salary_other');
  const salaryPrepayCard = watch('salary_prepay_card');
  const startingDate = watch('starting_date');
  const annualLeaveType = watch('annual_leave_type');
  const weeklyOff = watch('weekly_off');
  const noticePeriodValue = watch('notice_period_value');
  const probationPeriodValue = watch('probation_period_value');

  const handleFormSubmit = async (data: EmployerFormData) => {
    if (!signature) {
      setSignatureError('Please sign the form');
      return;
    }
    setSignatureError(null);
    await onSubmit(data, signature);
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
  }) => {
    setValue('salary_currency', values.salary_currency);
    setValue('salary_total', values.salary_total as number);
    setValue('salary_basic', values.salary_basic as number);
    setValue('salary_accommodation', values.salary_accommodation as number);
    setValue('salary_transport', values.salary_transport as number);
    setValue('salary_food', values.salary_food);
    setValue('salary_other', values.salary_other);
    setValue('salary_prepay_card', values.salary_prepay_card);
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
                options={toDropdownOptions(JOB_TITLES)}
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
                placeholder="Select visa designation..."
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
                        if (jobTitleVisa !== 'Other') {
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
                  {jobTitleVisa || <span className="text-gray-400">Select visa title first</span>}
                </div>
              ) : (
                <>
                  <CustomDropdown
                    options={toDropdownOptions(JOB_TITLES)}
                    value={jobTitleCompany || ''}
                    onChange={(val) => setValue('job_title_company', val)}
                    error={errors.job_title_company?.message}
                    searchable
                    placeholder="Select company role..."
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
            <div>
              <CustomDropdown
                label="Department"
                options={toDropdownOptions(DEPARTMENTS)}
                value={department || ''}
                onChange={(val) => setValue('department', val)}
                error={errors.department?.message}
                required
                searchable
                placeholder="Select department..."
              />
              {department === 'Other' && (
                <div className="mt-2">
                  <Input
                    label="Specify Department"
                    placeholder="Enter department"
                    error={errors.department_custom?.message}
                    {...register('department_custom', {
                      required: department === 'Other' ? 'Please specify department' : false,
                    })}
                  />
                </div>
              )}
            </div>

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

      {/* Compensation */}
      <FormSection
        title="Compensation"
        icon={<Banknote className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <SalaryBreakdown
          currency={salaryCurrency || 'AED'}
          total={salaryTotal}
          basic={salaryBasic}
          accommodation={salaryAccommodation}
          transport={salaryTransport}
          food={salaryFood}
          other={salaryOther}
          prepayCard={salaryPrepayCard}
          onChange={handleSalaryChange}
          errors={{
            total: errors.salary_total?.message,
          }}
        />
      </FormSection>

      {/* Leave & Terms */}
      <FormSection
        title="Leave & Terms"
        icon={<Calendar className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          {/* Row 1: Starting Date | Weekly Off */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CustomDatePicker
              label="Starting Date"
              value={startingDate || ''}
              onChange={(val) => setValue('starting_date', val)}
              error={errors.starting_date?.message}
              required
            />

            <CustomDropdown
              label="Weekly Off"
              options={WEEKLY_OFF_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
              value={weeklyOff || 'saturday_sunday'}
              onChange={(val) => setValue('weekly_off', val as 'friday' | 'sunday' | 'saturday_sunday')}
              error={errors.weekly_off?.message}
              required
            />
          </div>

          {/* Row 2: Annual Leave | Notice & Probation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="flex justify-between gap-4">
              <div>
                <label className="block text-sm mb-1">
                  <span className="font-medium" style={{ color: TME_COLORS.primary }}>Notice Period</span>
                  {' '}
                  <span className="text-gray-400">({pluralize(Number(noticePeriodValue), 'month')})</span>
                </label>
                <div className="w-20">
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
              </div>

              <div>
                <label className="block text-sm mb-1">
                  <span className="font-medium" style={{ color: TME_COLORS.primary }}>Probation</span>
                  {' '}
                  <span className="text-gray-400">({pluralize(Number(probationPeriodValue), 'month')})</span>
                </label>
                <div className="w-20">
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
              </div>
            </div>
          </div>
        </div>
      </FormSection>

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
