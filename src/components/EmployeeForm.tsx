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
  UAE_BANKS,
} from '@/lib/constants';
import { Input, Button, MultiSelectDropdown, CustomDropdown } from '@/components/ui';
import { SignaturePad } from '@/components/SignatureCanvas';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PassportMultiUpload } from '@/components/PassportMultiUpload';
import type { EmployeeFormData, EmployeeFormProps, PassportPageReference } from '@/types';
import { uploadDocument, updateDocumentReferences, uploadPassportPage, PassportPageKey } from '@/lib/supabase';
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

// Sort languages alphabetically
const SORTED_LANGUAGES = [...LANGUAGES].sort((a, b) => {
  if (a === 'Other') return 1;
  if (b === 'Other') return -1;
  return a.localeCompare(b);
});

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
  const [passportError, setPassportError] = useState<string | null>(null);
  const [photoDoc, setPhotoDoc] = useState(submission.documents?.photo);

  // Passport pages state
  const [passportPages, setPassportPages] = useState<{
    cover?: PassportPageReference;
    dataPage?: PassportPageReference;
    observationsPage?: PassportPageReference;
  }>(submission.documents?.passportPages || {});

  // Refs to track latest values (avoids stale closure issues in callbacks)
  const photoDocRef = React.useRef(photoDoc);
  const passportPagesRef = React.useRef(passportPages);

  // Keep refs in sync with state
  React.useEffect(() => {
    photoDocRef.current = photoDoc;
  }, [photoDoc]);

  React.useEffect(() => {
    passportPagesRef.current = passportPages;
  }, [passportPages]);

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

  const title = watch('title');
  const nationality = watch('nationality');
  const religion = watch('religion');
  const maritalStatus = watch('marital_status');
  const educationalQualification = watch('educational_qualification');
  const bankName = watch('bank_name');
  const sameEmails = watch('same_emails');
  const hasUAEBank = watch('has_uae_bank');
  const firstName = watch('first_name');
  const middleName = watch('middle_name');
  const lastName = watch('last_name');
  const languagesSpoken = watch('languages_spoken') || [];
  const otherNationality = watch('other_nationality');
  const previousNationality = watch('previous_nationality');

  // New checkbox states for nationality and address
  const [hasOtherNationality, setHasOtherNationality] = useState(
    !!submission.employee_data?.other_nationality
  );
  const [hasPreviousNationality, setHasPreviousNationality] = useState(
    !!submission.employee_data?.previous_nationality
  );
  const [isInUAE, setIsInUAE] = useState(
    submission.employee_data?.uae_presence === 'inside' ||
    !!(submission.employee_data?.uae_flat_villa || submission.employee_data?.uae_building_name || submission.employee_data?.uae_street_name)
  );

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

    // Validate all passport pages are uploaded
    const pagesUploaded = passportPages.cover && passportPages.dataPage && passportPages.observationsPage;
    if (!pagesUploaded) {
      setPassportError('Please upload all three passport pages');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPassportError(null);

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
        passportPages: passportPagesRef.current,
      });
      return result;
    }
    return null;
  };

  const handlePassportPageUpload = async (pageType: string, file: File): Promise<{ path: string } | null> => {
    const pageKey = pageType as PassportPageKey;
    const result = await uploadPassportPage(submission.id, pageKey, file);
    if (result) {
      const newPage: PassportPageReference = {
        path: result.path,
        filename: result.filename,
        validated: true,
      };
      const updatedPages = {
        ...passportPagesRef.current,
        [pageKey]: newPage,
      };
      setPassportPages(updatedPages);
      passportPagesRef.current = updatedPages;
      setPassportError(null);
      await updateDocumentReferences(submission.id, {
        photo: photoDocRef.current,
        passportPages: updatedPages,
      });
      return { path: result.path };
    }
    return null;
  };

  const handlePassportPagesChange = async (pages: {
    cover: { storagePath: string | null; validated: boolean };
    dataPage: { storagePath: string | null; validated: boolean };
    observationsPage: { storagePath: string | null; validated: boolean };
  }) => {
    // Convert internal page state to PassportPageReference format
    const updatedPages: typeof passportPages = {};
    if (pages.cover.storagePath && pages.cover.validated) {
      updatedPages.cover = {
        path: pages.cover.storagePath,
        filename: pages.cover.storagePath.split('/').pop() || '',
        validated: true,
      };
    }
    if (pages.dataPage.storagePath && pages.dataPage.validated) {
      updatedPages.dataPage = {
        path: pages.dataPage.storagePath,
        filename: pages.dataPage.storagePath.split('/').pop() || '',
        validated: true,
      };
    }
    if (pages.observationsPage.storagePath && pages.observationsPage.validated) {
      updatedPages.observationsPage = {
        path: pages.observationsPage.storagePath,
        filename: pages.observationsPage.storagePath.split('/').pop() || '',
        validated: true,
      };
    }
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
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
        <div className="space-y-6">
          {/* Photo Upload */}
          <div>
            <h3 className="text-sm font-medium mb-3" style={{ color: TME_COLORS.primary }}>
              Passport Photo
            </h3>
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
                    passportPages: passportPagesRef.current,
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
          </div>

          {/* Passport Pages Upload */}
          <div>
            <h3 className="text-sm font-medium mb-3" style={{ color: TME_COLORS.primary }}>
              Passport Pages
            </h3>
            <PassportMultiUpload
              submissionId={submission.id}
              onUpload={handlePassportPageUpload}
              onExtracted={handlePassportExtracted}
              onPagesChange={handlePassportPagesChange}
              initialPages={submission.documents?.passportPages ? {
                cover: submission.documents.passportPages.cover ? {
                  path: submission.documents.passportPages.cover.path,
                  validated: submission.documents.passportPages.cover.validated,
                } : undefined,
                dataPage: submission.documents.passportPages.dataPage ? {
                  path: submission.documents.passportPages.dataPage.path,
                  validated: submission.documents.passportPages.dataPage.validated,
                } : undefined,
                observationsPage: submission.documents.passportPages.observationsPage ? {
                  path: submission.documents.passportPages.observationsPage.path,
                  validated: submission.documents.passportPages.observationsPage.validated,
                } : undefined,
              } : undefined}
            />
            {passportError && (
              <p className="mt-2 text-sm text-red-500">{passportError}</p>
            )}
          </div>
        </div>
      </FormSection>

      {/* Personal Details */}
      <FormSection
        title="Personal Details"
        icon={<User className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <CustomDropdown
              label="Title"
              options={TITLES.map(t => ({ value: t, label: t }))}
              value={title || ''}
              onChange={(val) => setValue('title', val)}
              error={errors.title?.message}
              required
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
            <CustomDropdown
              label="Nationality"
              options={NATIONALITIES.map(n => ({ value: n, label: n }))}
              value={nationality || ''}
              onChange={(val) => setValue('nationality', val)}
              error={errors.nationality?.message}
              required
              searchable
            />
          </div>

          {/* Other Nationality */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasOtherNationality}
                onChange={(e) => {
                  setHasOtherNationality(e.target.checked);
                  if (!e.target.checked) {
                    setValue('other_nationality', undefined);
                  }
                }}
                className="w-4 h-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                I have another nationality
              </span>
            </label>
            {hasOtherNationality && (
              <div className="pl-6">
                <CustomDropdown
                  label="Other Nationality"
                  options={NATIONALITIES.map(n => ({ value: n, label: n }))}
                  value={otherNationality || ''}
                  onChange={(val) => setValue('other_nationality', val)}
                  placeholder="Select nationality"
                  searchable
                />
              </div>
            )}
          </div>

          {/* Previous Nationality */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasPreviousNationality}
                onChange={(e) => {
                  setHasPreviousNationality(e.target.checked);
                  if (!e.target.checked) {
                    setValue('previous_nationality', undefined);
                  }
                }}
                className="w-4 h-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                I had a previous nationality
              </span>
            </label>
            {hasPreviousNationality && (
              <div className="pl-6">
                <CustomDropdown
                  label="Previous Nationality"
                  options={NATIONALITIES.map(n => ({ value: n, label: n }))}
                  value={previousNationality || ''}
                  onChange={(val) => setValue('previous_nationality', val)}
                  placeholder="Select previous nationality"
                  searchable
                />
              </div>
            )}
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
            <CustomDropdown
              label="Religion"
              options={RELIGIONS.map(r => ({ value: r, label: r }))}
              value={religion || ''}
              onChange={(val) => setValue('religion', val)}
              error={errors.religion?.message}
              required
              searchable
            />
            <CustomDropdown
              label="Marital Status"
              options={MARITAL_STATUS_OPTIONS.map(m => ({ value: m, label: m }))}
              value={maritalStatus || ''}
              onChange={(val) => setValue('marital_status', val)}
              error={errors.marital_status?.message}
              required
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
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: TME_COLORS.primary }}
            >
              Home Country Address <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none focus:border-[#243F7B] transition-all duration-200 min-h-[80px]"
              placeholder="Enter your full address (street, city, postal code, country)"
              {...register('home_address', { required: 'Home address is required' })}
              style={{ fontFamily: 'Inter, sans-serif' }}
            />
            {errors.home_address && (
              <p className="mt-1 text-sm text-red-500">{errors.home_address.message}</p>
            )}
          </div>

          <Input
            label="Home Telephone"
            type="tel"
            placeholder="+XX XXX XXX XXXX"
            {...register('home_telephone')}
          />
        </div>
      </FormSection>

      {/* Contact - UAE (Conditional) */}
      <FormSection
        title="UAE Address"
        icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
      >
        <div className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isInUAE}
              onChange={(e) => {
                setIsInUAE(e.target.checked);
                setValue('uae_presence', e.target.checked ? 'inside' : 'outside');
                if (!e.target.checked) {
                  setValue('uae_flat_villa', '');
                  setValue('uae_building_name', '');
                  setValue('uae_street_name', '');
                }
              }}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
              Applicant is currently in the UAE
            </span>
          </label>

          {isInUAE && (
            <div className="space-y-4 pl-6 border-l-2 border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Flat/Villa Number"
                  error={errors.uae_flat_villa?.message}
                  required
                  {...register('uae_flat_villa', {
                    required: isInUAE ? 'Required' : false,
                  })}
                />
                <Input
                  label="Building Name"
                  error={errors.uae_building_name?.message}
                  required
                  {...register('uae_building_name', {
                    required: isInUAE ? 'Required' : false,
                  })}
                />
                <Input
                  label="Street Name"
                  error={errors.uae_street_name?.message}
                  required
                  {...register('uae_street_name', {
                    required: isInUAE ? 'Required' : false,
                  })}
                />
              </div>
            </div>
          )}
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
          <CustomDropdown
            label="Educational Qualification"
            options={EDUCATIONAL_QUALIFICATIONS.map(e => ({ value: e, label: e }))}
            value={educationalQualification || ''}
            onChange={(val) => setValue('educational_qualification', val)}
            error={errors.educational_qualification?.message}
            required
          />

          <MultiSelectDropdown
            label="Languages Spoken"
            options={SORTED_LANGUAGES}
            value={languagesSpoken}
            onChange={(values) => setValue('languages_spoken', values)}
            required
            searchable
            allowCustom
            customPlaceholder="Add another language..."
            error={errors.languages_spoken?.message}
          />
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
                <CustomDropdown
                  label="Bank Name"
                  options={UAE_BANKS.map(b => ({ value: b, label: b }))}
                  value={bankName || ''}
                  onChange={(val) => setValue('bank_name', val)}
                  error={errors.bank_name?.message}
                  required
                  searchable
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
