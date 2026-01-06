'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  TME_COLORS,
  TITLES,
  NATIONALITIES,
  RELIGIONS,
  MARITAL_STATUS_OPTIONS,
  EDUCATIONAL_QUALIFICATIONS,
  LANGUAGES,
  UAE_PRESENCE_OPTIONS,
  UAE_BANKS,
} from '@/lib/constants';
import { Input, Select, Button } from '@/components/ui';
import { SignaturePad } from '@/components/SignatureCanvas';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PassportUpload } from '@/components/PassportUpload';
import type { EmployeeFormData, EmployeeFormProps } from '@/types';
import { uploadDocument, updateDocumentReferences } from '@/lib/supabase';
import { calculateFullName } from '@/lib/utils';
import {
  User,
  Users,
  MapPin,
  Mail,
  GraduationCap,
  Building2,
  FileSignature,
  Camera,
} from 'lucide-react';

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

export function EmployeeForm({
  submission,
  onSubmit,
  isSubmitting,
  reuseEmployerSignature = false,
}: EmployeeFormProps) {
  const [signature, setSignature] = useState<string | null>(
    reuseEmployerSignature ? submission.employer_signature_data : null
  );
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoDoc, setPhotoDoc] = useState(submission.documents?.photo);
  const [passportDoc, setPassportDoc] = useState(submission.documents?.passport);

  // Refs to track latest values (avoids stale closure issues in callbacks)
  const photoDocRef = React.useRef(photoDoc);
  const passportDocRef = React.useRef(passportDoc);

  // Keep refs in sync with state
  React.useEffect(() => {
    photoDocRef.current = photoDoc;
  }, [photoDoc]);

  React.useEffect(() => {
    passportDocRef.current = passportDoc;
  }, [passportDoc]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EmployeeFormData>({
    defaultValues: submission.employee_data || {
      same_emails: false,
      has_uae_bank: false,
      uae_presence: 'inside',
      languages_spoken: ['English'],
    },
  });

  const maritalStatus = watch('marital_status');
  const sameEmails = watch('same_emails');
  const hasUAEBank = watch('has_uae_bank');
  const firstName = watch('first_name');
  const middleName = watch('middle_name');
  const lastName = watch('last_name');

  // Auto-calculate full name
  React.useEffect(() => {
    if (firstName || lastName) {
      const fullName = calculateFullName(firstName || '', middleName, lastName || '');
      setValue('full_name', fullName);
    }
  }, [firstName, middleName, lastName, setValue]);

  const handleFormSubmit = async (data: EmployeeFormData) => {
    // Validate photo is uploaded
    if (!photoDoc) {
      setPhotoError('Please upload your photo');
      // Scroll to top where photo upload is
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPhotoError(null);

    // Validate signature
    if (!signature && !reuseEmployerSignature) {
      setSignatureError('Please sign the form');
      return;
    }
    setSignatureError(null);

    // Use employer signature if same person mode
    const signatureToUse = reuseEmployerSignature && submission.employer_signature_data
      ? submission.employer_signature_data
      : signature!;

    await onSubmit(data, signatureToUse);
  };

  const handlePhotoUpload = async (file: File) => {
    const result = await uploadDocument(submission.id, 'photo', file);
    if (result) {
      const newDoc = { ...result, validated: false };
      setPhotoDoc(newDoc);
      photoDocRef.current = newDoc; // Update ref immediately
      setPhotoError(null);
      await updateDocumentReferences(submission.id, {
        photo: newDoc,
        passport: passportDocRef.current,
      });
      return result;
    }
    return null;
  };

  const handlePassportUpload = async (file: File) => {
    const result = await uploadDocument(submission.id, 'passport', file);
    if (result) {
      const newDoc = { ...result };
      setPassportDoc(newDoc);
      passportDocRef.current = newDoc; // Update ref immediately
      await updateDocumentReferences(submission.id, {
        photo: photoDocRef.current,
        passport: newDoc,
      });
      return result;
    }
    return null;
  };

  const handlePassportExtracted = (data: Partial<EmployeeFormData>) => {
    // Auto-fill form fields from extracted data
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        setValue(key as keyof EmployeeFormData, value as never);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Document Upload */}
      <FormSection
        title="Documents"
        icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PhotoUpload
            value={photoDoc}
            onUpload={handlePhotoUpload}
            onValidated={async (validated, validationErrors) => {
              // Use ref to get latest photoDoc (avoids stale closure)
              const currentPhotoDoc = photoDocRef.current;
              if (currentPhotoDoc) {
                const updatedDoc = { ...currentPhotoDoc, validated, validation_errors: validationErrors };
                setPhotoDoc(updatedDoc);
                photoDocRef.current = updatedDoc; // Update ref immediately
                // Persist validation result to Supabase
                await updateDocumentReferences(submission.id, {
                  photo: updatedDoc,
                  passport: passportDocRef.current,
                });
              }
              // Clear error when photo is uploaded
              if (photoError) setPhotoError(null);
            }}
            onRemove={() => {
              setPhotoDoc(undefined);
              photoDocRef.current = undefined;
            }}
            error={photoError || undefined}
          />
          <PassportUpload
            value={passportDoc}
            onUpload={handlePassportUpload}
            onExtracted={handlePassportExtracted}
            onRemove={() => {
              setPassportDoc(undefined);
              passportDocRef.current = undefined;
            }}
          />
        </div>
      </FormSection>

      {/* Personal Details */}
      <FormSection
        title="Personal Details"
        icon={<User className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Select
              label="Title"
              options={TITLES}
              error={errors.title?.message}
              required
              {...register('title', { required: 'Required' })}
            />
            <Input
              label="First Name"
              error={errors.first_name?.message}
              required
              {...register('first_name', { required: 'Required' })}
            />
            <Input
              label="Middle Name"
              {...register('middle_name')}
            />
            <Input
              label="Last Name"
              error={errors.last_name?.message}
              required
              {...register('last_name', { required: 'Required' })}
            />
          </div>

          <Input
            label="Full Name"
            value={calculateFullName(firstName || '', middleName, lastName || '')}
            disabled
            helperText="Auto-calculated from name fields"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Nationality"
              options={NATIONALITIES}
              error={errors.nationality?.message}
              required
              {...register('nationality', { required: 'Required' })}
            />
            <Input
              label="Previous Nationality"
              placeholder="If applicable"
              {...register('previous_nationality')}
            />
          </div>
        </div>
      </FormSection>

      {/* Family Details */}
      <FormSection
        title="Family Details"
        icon={<Users className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Father's Full Name"
              error={errors.father_full_name?.message}
              required
              {...register('father_full_name', { required: 'Required' })}
            />
            <Input
              label="Mother's Full Name"
              error={errors.mother_full_name?.message}
              required
              {...register('mother_full_name', { required: 'Required' })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Religion"
              options={RELIGIONS}
              error={errors.religion?.message}
              required
              {...register('religion', { required: 'Required' })}
            />
            <Select
              label="Marital Status"
              options={MARITAL_STATUS_OPTIONS}
              error={errors.marital_status?.message}
              required
              {...register('marital_status', { required: 'Required' })}
            />
          </div>

          {maritalStatus === 'Married' && (
            <Input
              label="Spouse Name"
              error={errors.spouse_name?.message}
              required
              {...register('spouse_name', {
                required: maritalStatus === 'Married' ? 'Required' : false,
              })}
            />
          )}
        </div>
      </FormSection>

      {/* Contact - Home Country */}
      <FormSection
        title="Home Country Address"
        icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <Input
            label="Street Address"
            error={errors.home_street_address?.message}
            required
            {...register('home_street_address', { required: 'Required' })}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Input
              label="City"
              error={errors.home_city?.message}
              required
              {...register('home_city', { required: 'Required' })}
            />
            <Input
              label="Postal Code"
              {...register('home_postal_code')}
            />
            <Select
              label="Country"
              options={NATIONALITIES}
              error={errors.home_country?.message}
              required
              {...register('home_country', { required: 'Required' })}
            />
            <Input
              label="Telephone"
              type="tel"
              {...register('home_telephone')}
            />
          </div>
        </div>
      </FormSection>

      {/* Contact - UAE */}
      <FormSection
        title="UAE Address"
        icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <Select
            label="Current Presence"
            options={UAE_PRESENCE_OPTIONS}
            {...register('uae_presence')}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Flat/Villa Number"
              {...register('uae_flat_villa')}
            />
            <Input
              label="Building Name"
              {...register('uae_building_name')}
            />
            <Input
              label="Street Name"
              {...register('uae_street_name')}
            />
          </div>
        </div>
      </FormSection>

      {/* Email & Phone */}
      <FormSection
        title="Email & Phone"
        icon={<Mail className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Personal Email"
              type="email"
              error={errors.personal_email?.message}
              required
              {...register('personal_email', {
                required: 'Required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Invalid email format',
                },
              })}
            />
            <div>
              <Input
                label="Company Email"
                type="email"
                disabled={sameEmails}
                {...register('company_email')}
              />
              <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  {...register('same_emails')}
                  className="rounded"
                />
                Same as personal email
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="UAE Mobile"
              type="tel"
              placeholder="05X XXX XXXX"
              error={errors.mobile_uae?.message}
              required
              {...register('mobile_uae', { required: 'Required' })}
            />
            <Input
              label="International Mobile"
              type="tel"
              placeholder="+XX XXX XXX XXXX"
              {...register('mobile_international')}
            />
          </div>
        </div>
      </FormSection>

      {/* Education & Languages */}
      <FormSection
        title="Education & Languages"
        icon={<GraduationCap className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <Select
            label="Educational Qualification"
            options={EDUCATIONAL_QUALIFICATIONS}
            error={errors.educational_qualification?.message}
            required
            {...register('educational_qualification', { required: 'Required' })}
          />

          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: TME_COLORS.primary }}
            >
              Languages Spoken
              <span className="text-red-500 ml-1">*</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {LANGUAGES.slice(0, 12).map((lang) => (
                <label key={lang} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={lang}
                    {...register('languages_spoken', { required: 'Select at least one' })}
                    className="rounded"
                  />
                  {lang}
                </label>
              ))}
            </div>
            {errors.languages_spoken && (
              <p className="mt-1 text-sm text-red-500">{errors.languages_spoken.message}</p>
            )}
          </div>
        </div>
      </FormSection>

      {/* Bank Details */}
      <FormSection
        title="Bank Details"
        icon={<Building2 className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register('has_uae_bank')}
              className="rounded"
            />
            <span className="text-sm text-gray-700">I have a UAE bank account</span>
          </label>

          {hasUAEBank && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Bank Name"
                  options={UAE_BANKS}
                  error={errors.bank_name?.message}
                  required
                  {...register('bank_name', {
                    required: hasUAEBank ? 'Required' : false,
                  })}
                />
                <Input
                  label="Branch"
                  {...register('bank_branch')}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Account Name"
                  error={errors.bank_account_name?.message}
                  required
                  {...register('bank_account_name', {
                    required: hasUAEBank ? 'Required' : false,
                  })}
                />
                <Input
                  label="SWIFT Code"
                  {...register('bank_swift')}
                />
              </div>

              <Input
                label="IBAN"
                placeholder="AE..."
                error={errors.bank_iban?.message}
                required
                {...register('bank_iban', {
                  required: hasUAEBank ? 'Required' : false,
                  pattern: {
                    value: /^AE\d{21}$/i,
                    message: 'Invalid UAE IBAN format',
                  },
                })}
              />
            </div>
          )}
        </div>
      </FormSection>

      {/* Other Information */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: TME_COLORS.primary }}
        >
          Other Information
        </label>
        <textarea
          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 min-h-[100px]"
          placeholder="Any additional information you would like to provide..."
          {...register('other_information')}
        />
      </div>

      {/* Signature */}
      {!reuseEmployerSignature && (
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
              label="Employee Signature"
            />
            {signatureError && (
              <p className="text-sm text-red-500">{signatureError}</p>
            )}
          </div>
        </FormSection>
      )}

      {reuseEmployerSignature && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <p className="text-sm text-blue-700">
            Your signature from the employer section will be used for both sections.
          </p>
        </div>
      )}

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button
          type="submit"
          loading={isSubmitting}
          size="lg"
        >
          Submit Onboarding Form
        </Button>
      </div>
    </form>
  );
}
