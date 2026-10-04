import { describe, it, expect } from 'vitest';
import {
  companySetupVisaEducationWarning,
  companySetupVisaTitleNeedsDegree,
} from '@/types/company-setup';

// Tina 04.10: General Manager = any education; any other manager title needs a
// Bachelor's degree or higher + the attested certificate; no manager title = any.
const person = (jobTitle: string, education?: string) => ({
  fullName: 'Hanna R',
  educationalQualification: education,
  visa: { visaRequired: true, jobTitle },
});

describe('companySetupVisaTitleNeedsDegree', () => {
  it('General Manager never needs a degree', () => {
    expect(companySetupVisaTitleNeedsDegree('General Manager')).toBe(false);
    expect(companySetupVisaTitleNeedsDegree('general  manager')).toBe(false);
  });
  it('other manager titles do', () => {
    for (const t of ['Marketing Manager', 'Director', 'Managing Director', 'CEO', 'Chief Accountant']) {
      expect(companySetupVisaTitleNeedsDegree(t)).toBe(true);
    }
  });
  it('titles without a manager word do not', () => {
    for (const t of ['Admin Support', 'Sales Executive', 'Driver', '', undefined]) {
      expect(companySetupVisaTitleNeedsDegree(t)).toBe(false);
    }
  });
});

describe('companySetupVisaEducationWarning', () => {
  it('no warning for General Manager with any education', () => {
    expect(companySetupVisaEducationWarning(person('General Manager', 'Primary School'), false)).toBeNull();
  });
  it('no warning for a title without a manager word', () => {
    expect(companySetupVisaEducationWarning(person('Admin Support', 'Diploma'), false)).toBeNull();
  });
  it('no warning when no visa is wanted', () => {
    const p = { ...person('Marketing Manager', 'Diploma'), visa: { visaRequired: false, jobTitle: 'Marketing Manager' } };
    expect(companySetupVisaEducationWarning(p, false)).toBeNull();
  });
  it('manager title below a bachelor degree warns no_degree', () => {
    const w = companySetupVisaEducationWarning(person('Marketing Manager', 'Diploma'), false);
    expect(w?.kind).toBe('no_degree');
    expect(w?.message).toContain('"Marketing Manager"');
    expect(w?.message).toContain('"Diploma"');
    expect(w?.message).not.toMatch(/[–—]/);
  });
  it('manager title with a degree asks for the certificate until it is uploaded', () => {
    expect(companySetupVisaEducationWarning(person('Director', "Master's Degree"), false)?.kind).toBe('certificate');
    expect(companySetupVisaEducationWarning(person('Director', "Master's Degree"), true)).toBeNull();
  });
});
