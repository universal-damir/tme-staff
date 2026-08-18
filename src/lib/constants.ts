/**
 * Staff onboarding constants
 * Dropdown options for job titles, departments, religions, languages, etc.
 */

// ===================================================================
// JOB TITLES
// ===================================================================

/** @deprecated Use useMohreProfessions() hook instead. Kept as fallback. */
export const JOB_TITLES = [
  'Accountant',
  'Admin Assistant',
  'Admin Manager',
  'Assistant Manager',
  'Business Development Manager',
  'Consultant',
  'Customer Service Representative',
  'Designer',
  'Director',
  'Driver',
  'Engineer',
  'Finance Manager',
  'General Manager',
  'HR Executive',
  'HR Manager',
  'IT Manager',
  'IT Specialist',
  'Legal Advisor',
  'Manager',
  'Marketing Executive',
  'Marketing Manager',
  'Office Boy',
  'Operations Manager',
  'PRO (Public Relations Officer)',
  'Project Manager',
  'Receptionist',
  'Sales Executive',
  'Sales Manager',
  'Senior Accountant',
  'Supervisor',
  'Technician',
  'Other',
] as const;

export type JobTitle = (typeof JOB_TITLES)[number];

// ===================================================================
// DEPARTMENTS
// @deprecated — Department is now a free-text field. Kept for backward compat.
// ===================================================================

export const DEPARTMENTS = [
  'Administration',
  'Business Development',
  'Customer Service',
  'Finance & Accounting',
  'Human Resources',
  'Information Technology',
  'Legal',
  'Logistics',
  'Maintenance',
  'Marketing',
  'Operations',
  'Procurement',
  'Production',
  'Quality Assurance',
  'Research & Development',
  'Sales',
  'Security',
  'Other',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// ===================================================================
// WORKING LOCATIONS
// ===================================================================

export const WORKING_LOCATIONS = [
  'JAFZA',
  'DMCC',
  'DAFZA',
  'DIC',
  'DMC',
  'JLT',
  'Business Bay',
  'DIFC',
  'Sharjah',
  'Abu Dhabi',
  'Other',
] as const;

export type WorkingLocation = (typeof WORKING_LOCATIONS)[number];

// ===================================================================
// SPONSOR OPTIONS
// ===================================================================

export const SPONSOR_OPTIONS = [
  'Company',
  'Self-sponsored',
  'GCC National',
  'Spouse',
  'Parent',
  'Child',
] as const;

export type SponsorOption = (typeof SPONSOR_OPTIONS)[number];

// ===================================================================
// RELIGIONS
// ===================================================================

export const RELIGIONS = [
  'Muslim - Sunni',
  'Muslim - Shia',
  'Christian - Catholic',
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

// Includes the formal-degree levels required by the DET work-permit form
// ("Associate Diploma" and "Post Graduate Diploma") so that this single
// dropdown also covers DET's "Degree Type" field — no duplicate dropdown
// needed on the employee form.
export const EDUCATIONAL_QUALIFICATIONS = [
  'Primary School',
  'Secondary School / High School',
  'Vocational Certificate',
  'Associate Diploma',
  'Diploma',
  'Post Graduate Diploma',
  "Bachelor's Degree",
  "Master's Degree",
  'Doctorate (PhD)',
  'Professional Certification',
  'Other',
] as const;

export type EducationalQualification = (typeof EDUCATIONAL_QUALIFICATIONS)[number];

// ===================================================================
// DET — EXTENDED DEGREE DETAILS
// ===================================================================
// Year ranges for the DET-specific extra fields shown alongside
// Educational Qualification when the registered authority is DET and
// the qualification is degree-level.

export const DET_DEGREE_YEAR_MIN = 1960;
export const DET_DEGREE_ACTUAL_YEARS_MAX = 25;

// ===================================================================
// LANGUAGES
// ===================================================================

export const LANGUAGES = [
  'Afrikaans',
  'Albanian',
  'Amharic',
  'Arabic',
  'Armenian',
  'Assamese',
  'Azerbaijani',
  'Balochi',
  'Belarusian',
  'Bengali',
  'Bhojpuri',
  'Bosnian',
  'Bulgarian',
  'Burmese',
  'Cebuano',
  'Chinese (Cantonese)',
  'Chinese (Mandarin)',
  'Croatian',
  'Czech',
  'Danish',
  'Dari',
  'Dutch',
  'English',
  'Estonian',
  'Farsi',
  'Filipino',
  'Finnish',
  'French',
  'Georgian',
  'German',
  'Greek',
  'Gujarati',
  'Hausa',
  'Hebrew',
  'Hindi',
  'Hungarian',
  'Igbo',
  'Ilocano',
  'Indonesian',
  'Italian',
  'Japanese',
  'Kannada',
  'Kazakh',
  'Khmer',
  'Kinyarwanda',
  'Konkani',
  'Korean',
  'Kurdish',
  'Kyrgyz',
  'Lao',
  'Latvian',
  'Lithuanian',
  'Luganda',
  'Macedonian',
  'Malay',
  'Malayalam',
  'Maltese',
  'Marathi',
  'Mongolian',
  'Nepali',
  'Norwegian',
  'Odia',
  'Pashto',
  'Polish',
  'Portuguese',
  'Punjabi',
  'Romanian',
  'Russian',
  'Serbian',
  'Shona',
  'Sindhi',
  'Sinhala',
  'Slovak',
  'Slovenian',
  'Somali',
  'Spanish',
  'Swahili',
  'Swedish',
  'Tagalog',
  'Tajik',
  'Tamil',
  'Telugu',
  'Thai',
  'Tigrinya',
  'Turkish',
  'Turkmen',
  'Ukrainian',
  'Urdu',
  'Uzbek',
  'Vietnamese',
  'Wolof',
  'Xhosa',
  'Yoruba',
  'Zulu',
] as const;

export type Language = (typeof LANGUAGES)[number];

// ===================================================================
// NATIONALITIES
// ===================================================================

export const NATIONALITIES = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Cape Verde',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo (DRC)',
  'Congo (Republic)',
  'Costa Rica',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'East Timor',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Ivory Coast',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kosovo',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
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
  { value: 'saturday_sunday', label: 'Saturday & Sunday' },
  { value: 'sunday', label: 'Sunday only' },
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
  "The percentage is NOT defined in the UAE Labour Law. It is the employer's decision.";

// ===================================================================
// "OTHER" ALLOWANCE BREAKDOWN TYPES
// Mirrors tme-portal PAYROLL_OTHER_TYPE_OPTIONS — same 11 categories so
// contract and payroll breakdowns are interchangeable. The 'other' fallback
// covers anything that doesn't fit a named category.
// ===================================================================

export const PAYROLL_OTHER_TYPE_OPTIONS = [
  { value: 'education', label: 'Education / Schooling' },
  { value: 'phone', label: 'Phone / Telephone' },
  { value: 'commute', label: 'Commute' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'salik', label: 'Salik' },
  { value: 'petrol', label: 'Petrol / Fuel' },
  { value: 'pension', label: 'Pension' },
  { value: 'health_insurance', label: 'Health Insurance' },
  { value: 'car', label: 'Car' },
  { value: 'flight', label: 'Flight / Air Ticket' },
  { value: 'prepay_card', label: 'Prepaid Card' },
  { value: 'other', label: 'Other' },
] as const;

export type PayrollOtherType = (typeof PAYROLL_OTHER_TYPE_OPTIONS)[number]['value'];

export interface PayrollOtherBreakdownEntry {
  type: PayrollOtherType;
  amount: number;
}

// ===================================================================
// BANK OPTIONS (Common banks in UAE)
// @deprecated — Use uae-bank-directory.ts for IBAN-based auto-derivation.
// Kept for backwards compat with any code that still references it.
// ===================================================================

export const UAE_BANKS = [
  'Abu Dhabi Commercial Bank (ADCB)',
  'Abu Dhabi Islamic Bank (ADIB)',
  'Ajman Bank',
  'Al Hilal Bank',
  'Arab Bank for Investment & Foreign Trade (Al Masraf)',
  'Bank of Sharjah',
  'Citibank UAE',
  'Commercial Bank of Dubai (CBD)',
  'Dubai Islamic Bank (DIB)',
  'Emirates Islamic Bank',
  'Emirates NBD',
  'First Abu Dhabi Bank (FAB)',
  'HSBC Middle East',
  'Invest Bank',
  'Liv.',
  'Mashreq Bank',
  'National Bank of Fujairah',
  'National Bank of Ras Al-Khaimah (RAKBANK)',
  'Noor Bank',
  'RAKBANK',
  'Sharjah Islamic Bank',
  'Standard Chartered',
  'Union National Bank (UNB)',
  'United Arab Bank (UAB)',
  'WIO Bank',
  'Other',
] as const;

export type UAEBank = (typeof UAE_BANKS)[number];

export const UAE_EMIRATES = [
  'Abu Dhabi',
  'Ajman',
  'Dubai',
  'Fujairah',
  'Ras Al Khaimah',
  'Sharjah',
  'Umm Al Quwain',
] as const;

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
