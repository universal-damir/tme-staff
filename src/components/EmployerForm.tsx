'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  TME_COLORS,
  JOB_TITLES,
  DEPARTMENTS,
  WEEKLY_OFF_OPTIONS,
  TIME_PERIOD_UNITS,
  LEAVE_TYPES,
} from '@/lib/constants';
import { Input, Select, DatePicker, Button } from '@/components/ui';
import { SalaryBreakdown } from '@/components/SalaryBreakdown';
import { SignaturePad } from '@/components/SignatureCanvas';
import type { EmployerFormData, EmployerFormProps } from '@/types';
import { Briefcase, DollarSign, Calendar, FileSignature } from 'lucide-react';

interface FormSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function FormSection({ title, icon, children }: FormSectionProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: TME_COLORS.secondary }}
        >
          {icon}
        </div>
        <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
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
            <Select
              label="Job Title"
              options={JOB_TITLES}
              error={errors.job_title?.message}
              required
              {...register('job_title', { required: 'Job title is required' })}
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
            <Select
              label="Department"
              options={DEPARTMENTS}
              error={errors.department?.message}
              required
              {...register('department', { required: 'Department is required' })}
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
        icon={<DollarSign className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
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
                type="number"
                placeholder="Days"
                min={0}
                error={errors.annual_leave_days?.message}
                {...register('annual_leave_days', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be positive' },
                })}
              />
              <Select
                options={LEAVE_TYPES}
                {...register('annual_leave_type')}
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
                type="number"
                placeholder="Value"
                min={0}
                error={errors.notice_period_value?.message}
                {...register('notice_period_value', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be positive' },
                })}
              />
              <Select
                options={TIME_PERIOD_UNITS}
                {...register('notice_period_unit')}
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
                type="number"
                placeholder="Value"
                min={0}
                error={errors.probation_period_value?.message}
                {...register('probation_period_value', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be positive' },
                })}
              />
              <Select
                options={TIME_PERIOD_UNITS}
                {...register('probation_period_unit')}
              />
            </div>
          </div>

          {/* Weekly Off */}
          <Select
            label="Weekly Off"
            options={WEEKLY_OFF_OPTIONS}
            error={errors.weekly_off?.message}
            required
            {...register('weekly_off', { required: 'Required' })}
          />

          {/* Starting Date */}
          <DatePicker
            label="Starting Date"
            error={errors.starting_date?.message}
            required
            {...register('starting_date', { required: 'Starting date is required' })}
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
