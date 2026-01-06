/**
 * Staff onboarding constants
 * Dropdown options for job titles, departments, religions, languages, etc.
 */

// ===================================================================
// JOB TITLES
// ===================================================================

export const JOB_TITLES = [
  'Director',
  'General Manager',
  'Manager',
  'Assistant Manager',
  'Supervisor',
  'Accountant',
  'Senior Accountant',
  'Finance Manager',
  'Admin Assistant',
  'Admin Manager',
  'HR Manager',
  'HR Executive',
  'Sales Executive',
  'Sales Manager',
  'Marketing Executive',
  'Marketing Manager',
  'IT Manager',
  'IT Specialist',
  'Operations Manager',
  'Project Manager',
  'Business Development Manager',
  'Customer Service Representative',
  'Receptionist',
  'Driver',
  'Office Boy',
  'PRO (Public Relations Officer)',
  'Legal Advisor',
  'Consultant',
  'Engineer',
  'Technician',
  'Designer',
  'Other',
] as const;

export type JobTitle = (typeof JOB_TITLES)[number];

// ===================================================================
// DEPARTMENTS
// ===================================================================

export const DEPARTMENTS = [
  'Administration',
  'Finance & Accounting',
  'Human Resources',
  'Information Technology',
  'Sales',
  'Marketing',
  'Operations',
  'Legal',
  'Business Development',
  'Customer Service',
  'Procurement',
  'Logistics',
  'Quality Assurance',
  'Research & Development',
  'Production',
  'Maintenance',
  'Security',
  'Other',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// ===================================================================
// RELIGIONS
// ===================================================================

export const RELIGIONS = [
  'Muslim - Sunni',
  'Muslim - Shia',
  'Christian - Catholic',
  'Christian - Protestant',
  'Christian - Orthodox',
  'Christian - Other',
  'Hindu',
  'Buddhist',
  'Jewish',
  'Sikh',
  'Jain',
  'Zoroastrian',
  'Bahai',
  'Atheist/Non-religious',
  'Other',
] as const;

export type Religion = (typeof RELIGIONS)[number];

// ===================================================================
// EDUCATIONAL QUALIFICATIONS
// ===================================================================

export const EDUCATIONAL_QUALIFICATIONS = [
  'Primary School',
  'Secondary School / High School',
  'Vocational Certificate',
  'Diploma',
  "Bachelor's Degree",
  "Master's Degree",
  'Doctorate (PhD)',
  'Professional Certification',
  'Other',
] as const;

export type EducationalQualification = (typeof EDUCATIONAL_QUALIFICATIONS)[number];

// ===================================================================
// LANGUAGES
// ===================================================================

export const LANGUAGES = [
  'English',
  'Arabic',
  'Hindi',
  'Urdu',
  'Tagalog',
  'Malayalam',
  'Tamil',
  'Bengali',
  'Nepali',
  'Sinhala',
  'French',
  'Spanish',
  'German',
  'Russian',
  'Chinese (Mandarin)',
  'Chinese (Cantonese)',
  'Japanese',
  'Korean',
  'Portuguese',
  'Italian',
  'Farsi',
  'Turkish',
  'Pashto',
  'Dutch',
  'Other',
] as const;

export type Language = (typeof LANGUAGES)[number];

// ===================================================================
// NATIONALITIES
// ===================================================================

export const NATIONALITIES = [
  'United Arab Emirates',
  'India',
  'Pakistan',
  'Bangladesh',
  'Philippines',
  'Nepal',
  'Sri Lanka',
  'Egypt',
  'Jordan',
  'Lebanon',
  'Syria',
  'Palestine',
  'Iraq',
  'Iran',
  'Saudi Arabia',
  'United States',
  'United Kingdom',
  'Germany',
  'France',
  'Canada',
  'Australia',
  'Russia',
  'China',
  'Japan',
  'South Korea',
  'South Africa',
  'Nigeria',
  'Kenya',
  'Afghanistan',
  'Albania',
  'Algeria',
  'Argentina',
  'Armenia',
  'Austria',
  'Azerbaijan',
  'Bahrain',
  'Belarus',
  'Belgium',
  'Bosnia and Herzegovina',
  'Brazil',
  'Bulgaria',
  'Cambodia',
  'Cameroon',
  'Chile',
  'Colombia',
  'Croatia',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Ecuador',
  'Estonia',
  'Ethiopia',
  'Finland',
  'Georgia',
  'Ghana',
  'Greece',
  'Hungary',
  'Iceland',
  'Indonesia',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Kazakhstan',
  'Kosovo',
  'Kuwait',
  'Latvia',
  'Libya',
  'Lithuania',
  'Luxembourg',
  'Malaysia',
  'Maldives',
  'Malta',
  'Mexico',
  'Montenegro',
  'Morocco',
  'Myanmar',
  'Netherlands',
  'New Zealand',
  'North Macedonia',
  'Norway',
  'Oman',
  'Peru',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Serbia',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Spain',
  'Sudan',
  'Sweden',
  'Switzerland',
  'Taiwan',
  'Tanzania',
  'Thailand',
  'Tunisia',
  'Turkmenistan',
  'Uganda',
  'Ukraine',
  'Uzbekistan',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zimbabwe',
  'Other',
] as const;

export type Nationality = (typeof NATIONALITIES)[number];

// ===================================================================
// TITLE OPTIONS (Mr, Mrs, Ms, etc.)
// ===================================================================

export const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Eng', 'Other'] as const;

export type Title = (typeof TITLES)[number];

// ===================================================================
// SALARY CURRENCIES
// ===================================================================

export const SALARY_CURRENCIES = [
  { value: 'AED', label: 'AED - UAE Dirham' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'CHF', label: 'CHF - Swiss Franc' },
] as const;

export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number]['value'];

// ===================================================================
// WEEKLY OFF OPTIONS
// ===================================================================

export const WEEKLY_OFF_OPTIONS = [
  { value: 'sunday', label: 'Sunday only' },
  { value: 'saturday_sunday', label: 'Saturday & Sunday' },
] as const;

// ===================================================================
// TIME PERIOD UNITS
// ===================================================================

export const TIME_PERIOD_UNITS = [
  { value: 'days', label: 'Day(s)' },
  { value: 'weeks', label: 'Week(s)' },
  { value: 'months', label: 'Month(s)' },
] as const;

// ===================================================================
// LEAVE TYPES
// ===================================================================

export const LEAVE_TYPES = [
  { value: 'calendar', label: 'Calendar days' },
  { value: 'working', label: 'Working days' },
] as const;

// ===================================================================
// MARITAL STATUS OPTIONS
// ===================================================================

export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed'] as const;

export type MaritalStatus = (typeof MARITAL_STATUS_OPTIONS)[number];

// ===================================================================
// UAE PRESENCE OPTIONS
// ===================================================================

export const UAE_PRESENCE_OPTIONS = [
  { value: 'inside', label: 'Inside UAE' },
  { value: 'outside', label: 'Outside UAE' },
] as const;

// ===================================================================
// SALARY BREAKDOWN DEFAULT PERCENTAGES
// ===================================================================

export const DEFAULT_SALARY_BREAKDOWN = {
  basic: 0.6, // 60%
  accommodation: 0.3, // 30%
  transport: 0.1, // 10%
  food: 0, // 0%
  other: 0, // 0%
} as const;

export const SALARY_BREAKDOWN_EXPLANATION =
  'Sample common split in the UAE is: Basic 60%, Accommodation 30%, Transport 10%. ' +
  "The percentage is NOT defined in the UAE Labour Law. It is the employer's decision. " +
  'You can adjust these values, but the total must equal the monthly salary.';

// ===================================================================
// BANK OPTIONS (Common banks in UAE)
// ===================================================================

export const UAE_BANKS = [
  'Emirates NBD',
  'Abu Dhabi Commercial Bank (ADCB)',
  'First Abu Dhabi Bank (FAB)',
  'Dubai Islamic Bank (DIB)',
  'Mashreq Bank',
  'RAKBANK',
  'Commercial Bank of Dubai (CBD)',
  'Sharjah Islamic Bank',
  'HSBC Middle East',
  'Standard Chartered',
  'Citibank UAE',
  'United Arab Bank (UAB)',
  'Arab Bank for Investment & Foreign Trade (Al Masraf)',
  'Bank of Sharjah',
  'Invest Bank',
  'National Bank of Fujairah',
  'National Bank of Ras Al-Khaimah (RAKBANK)',
  'Union National Bank (UNB)',
  'Abu Dhabi Islamic Bank (ADIB)',
  'Ajman Bank',
  'Emirates Islamic Bank',
  'Noor Bank',
  'Al Hilal Bank',
  'WIO Bank',
  'Liv.',
  'Other',
] as const;

export type UAEBank = (typeof UAE_BANKS)[number];

// ===================================================================
// UI CONSTANTS
// ===================================================================

export const TME_COLORS = {
  primary: '#243F7B',
  secondary: '#D2BC99',
  background: '#f5f5f5',
  border: '#e5e7eb',
  borderFocus: '#243F7B',
  error: '#ef4444',
  success: '#22c55e',
} as const;

export const INPUT_HEIGHT = 42;
