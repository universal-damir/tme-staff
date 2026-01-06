'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  TME_COLORS,
  JOB_TITLES,
  DEPARTMENTS,
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
    },
  });

  const jobTitle = watch('job_title');
  const department = watch('department');
  const salaryCurrency = watch('salary_currency');
  const salaryTotal = watch('salary_total');
  const salaryBasic = watch('salary_basic');
  const salaryAccommodation = watch('salary_accommodation');
  const salaryTransport = watch('salary_transport');
  const salaryFood = watch('salary_food');
  const salaryOther = watch('salary_other');
  const noticePeriodValue = watch('notice_period_value');
  const probationPeriodValue = watch('probation_period_value');
  const startingDate = watch('starting_date');
  const annualLeaveType = watch('annual_leave_type');
  const noticePeriodUnit = watch('notice_period_unit');
  const probationPeriodUnit = watch('probation_period_unit');
  const weeklyOff = watch('weekly_off');

  // Create dynamic time period options based on the value
  const getTimePeriodOptions = (value: number | undefined) => [
    { value: 'days', label: pluralize(value, 'day') },
    { value: 'weeks', label: pluralize(value, 'week') },
    { value: 'months', label: pluralize(value, 'month') },
  ];

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
  }) => {
    setValue('salary_currency', values.salary_currency);
    setValue('salary_total', values.salary_total as number);
    setValue('salary_basic', values.salary_basic as number);
    setValue('salary_accommodation', values.salary_accommodation as number);
    setValue('salary_transport', values.salary_transport as number);
    setValue('salary_food', values.salary_food);
    setValue('salary_other', values.salary_other);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Position Details */}
      <FormSection
        title="Position Details"
        icon={<Briefcase className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <CustomDropdown
              label="Job Title"
              options={toDropdownOptions(JOB_TITLES)}
              value={jobTitle || ''}
              onChange={(val) => setValue('job_title', val)}
              error={errors.job_title?.message}
              required
              searchable
              placeholder="Select job title..."
            />
            {jobTitle === 'Other' && (
              <div className="mt-2">
                <Input
                  label="Specify Job Title"
                  placeholder="Enter job title"
                  error={errors.job_title_custom?.message}
                  {...register('job_title_custom', {
                    required: jobTitle === 'Other' ? 'Please specify job title' : false,
                  })}
                />
              </div>
            )}
          </div>

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
        <div className="space-y-6">
          {/* Annual Leave */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: TME_COLORS.primary }}
            >
              Annual Leave
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Days"
                error={errors.annual_leave_days?.message}
                {...register('annual_leave_days', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be positive' },
                })}
              />
              <CustomDropdown
                options={LEAVE_TYPES.map(opt => ({ value: opt.value, label: opt.label }))}
                value={annualLeaveType || 'calendar'}
                onChange={(val) => setValue('annual_leave_type', val as 'calendar' | 'working')}
              />
            </div>
          </div>

          {/* Notice Period */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: TME_COLORS.primary }}
            >
              Notice Period
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Value"
                error={errors.notice_period_value?.message}
                {...register('notice_period_value', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be positive' },
                })}
              />
              <CustomDropdown
                options={getTimePeriodOptions(noticePeriodValue)}
                value={noticePeriodUnit || 'months'}
                onChange={(val) => setValue('notice_period_unit', val as 'days' | 'weeks' | 'months')}
              />
            </div>
          </div>

          {/* Probation Period */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: TME_COLORS.primary }}
            >
              Probation Period
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Value"
                error={errors.probation_period_value?.message}
                {...register('probation_period_value', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be positive' },
                })}
              />
              <CustomDropdown
                options={getTimePeriodOptions(probationPeriodValue)}
                value={probationPeriodUnit || 'months'}
                onChange={(val) => setValue('probation_period_unit', val as 'days' | 'weeks' | 'months')}
              />
            </div>
          </div>

          {/* Weekly Off */}
          <CustomDropdown
            label="Weekly Off"
            options={WEEKLY_OFF_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
            value={weeklyOff || 'saturday_sunday'}
            onChange={(val) => setValue('weekly_off', val as 'sunday' | 'saturday_sunday')}
            error={errors.weekly_off?.message}
            required
          />

          {/* Starting Date */}
          <CustomDatePicker
            label="Starting Date"
            value={startingDate || ''}
            onChange={(val) => setValue('starting_date', val)}
            error={errors.starting_date?.message}
            required
          />
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
