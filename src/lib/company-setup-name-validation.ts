// Company Setup Intake (IFZA v1) — deterministic company-name rule checks.
// Source: official IFZA Company Name Guidelines.
// PURE module — no imports. MIRROR of the portal repo's
// src/lib/company-setup/name-validation.ts (the source of truth); keep both
// copies in sync. See the portal's PLAN-company-setup-intake.md.

export interface CompanyNameValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Displayed as a visible checklist inside the client form (PM: not hidden in a tooltip).
export const COMPANY_NAME_RULES: string[] = [
  'The first word of the name must be at least 3 characters long.',
  'The name cannot start with a number.',
  'The name cannot contain the words "Limited" or "Ltd".',
  'The name cannot contain the words "Halal", "Palm", "Expo" or "United".',
  'The name cannot contain religious words (for example "Allah", "God", "Lord", "Rahman", "Rahim").',
  'The name cannot contain UAE-related names (for example "Dubai", "Emirates", "UAE", "Abu Dhabi", "Sharjah").',
  'The name cannot contain country or city names (for example "Germany", "London").',
  'Words that refer to political or well-known organizations (for example "FBI", "NATO") may be rejected by the authority.',
  'At least one of your selected business activities must be reflected in the company name.',
  'All company names get the suffix FZCO.',
  'Final approval remains subject to authority approval.',
];

// Banned outright (word-boundary, case-insensitive).
const LEGAL_FORM_WORDS = ['Limited', 'Ltd'];
const BANNED_WORDS = ['Halal', 'Palm', 'Expo', 'United'];
const RELIGIOUS_WORDS = ['Allah', 'Lord', 'God', 'Rahman', 'Rahim'];
const UAE_NAMES = [
  'Dubai',
  'Emirates',
  'UAE',
  'Abu Dhabi',
  'Sharjah',
  'Ajman',
  'Fujairah',
  'Ras Al Khaimah',
  'Umm Al Quwain',
];

// Flagged as warnings (authority may reject), not hard errors.
const WARNING_TERMS = ['FBI', 'Mafia', 'Interpol', 'UN', 'NATO'];

// English short names of the world's countries (UN members + observers + Kosovo + Taiwan).
export const COUNTRY_NAMES: string[] = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria',
  'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros',
  'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Czech Republic',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti',
  'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan',
  'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands',
  'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
  'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
  'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore',
  'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
  'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen', 'Zambia', 'Zimbabwe',
];

// Well-known world cities (UAE cities live in UAE_NAMES, not here).
export const MAJOR_CITIES: string[] = [
  'London', 'Paris', 'New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami',
  'San Francisco', 'Boston', 'Washington', 'Toronto', 'Vancouver', 'Montreal',
  'Sao Paulo', 'Rio de Janeiro', 'Buenos Aires', 'Lima', 'Bogota', 'Santiago',
  'Madrid', 'Barcelona', 'Lisbon', 'Rome', 'Milan', 'Venice', 'Florence',
  'Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Vienna', 'Zurich', 'Geneva',
  'Amsterdam', 'Brussels', 'Copenhagen', 'Stockholm', 'Oslo', 'Helsinki',
  'Dublin', 'Edinburgh', 'Manchester', 'Liverpool', 'Prague', 'Warsaw',
  'Budapest', 'Athens', 'Istanbul', 'Moscow', 'Saint Petersburg', 'Kyiv',
  'Cairo', 'Casablanca', 'Lagos', 'Nairobi', 'Johannesburg', 'Cape Town',
  'Riyadh', 'Jeddah', 'Doha', 'Muscat', 'Manama', 'Tehran', 'Baghdad',
  'Amman', 'Beirut', 'Jerusalem', 'Karachi', 'Lahore', 'Mumbai', 'Delhi',
  'Bangalore', 'Chennai', 'Kolkata', 'Dhaka', 'Bangkok', 'Kuala Lumpur',
  'Jakarta', 'Manila', 'Hanoi', 'Ho Chi Minh City', 'Hong Kong', 'Shanghai',
  'Beijing', 'Shenzhen', 'Guangzhou', 'Tokyo', 'Osaka', 'Kyoto', 'Seoul',
  'Sydney', 'Melbourne', 'Auckland',
];

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive whole-word (or whole-phrase) match. */
function containsWord(normalizedName: string, term: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`, 'i');
  return pattern.test(normalizedName);
}

function findTerms(normalizedName: string, terms: string[]): string[] {
  return terms.filter((term) => containsWord(normalizedName, term));
}

/**
 * Deterministic IFZA company-name rule check.
 * Errors block submission; warnings are shown but do not block.
 */
export function validateCompanyName(name: string): CompanyNameValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const trimmed = (name || '').trim().replace(/\s+/g, ' ');

  if (!trimmed) {
    return { valid: false, errors: ['Please enter a company name.'], warnings: [] };
  }

  // Rule: first word must be at least 3 characters (letters, numbers and symbols count).
  const firstWord = trimmed.split(' ')[0];
  if (firstWord.length < 3) {
    errors.push('The first word must be at least 3 characters long.');
  }

  // Rule: the name must not begin with a number.
  if (/^\d/.test(trimmed)) {
    errors.push('The name cannot start with a number.');
  }

  for (const term of findTerms(trimmed, LEGAL_FORM_WORDS)) {
    errors.push(`The name cannot contain the word "${term}".`);
  }

  for (const term of findTerms(trimmed, BANNED_WORDS)) {
    errors.push(`The name cannot contain the word "${term}".`);
  }

  for (const term of findTerms(trimmed, RELIGIOUS_WORDS)) {
    errors.push(`The name cannot contain the religious word "${term}".`);
  }

  for (const term of findTerms(trimmed, UAE_NAMES)) {
    errors.push(`The name cannot contain the UAE-related name "${term}".`);
  }

  for (const term of findTerms(trimmed, COUNTRY_NAMES)) {
    errors.push(`The name cannot contain the country name "${term}".`);
  }

  for (const term of findTerms(trimmed, MAJOR_CITIES)) {
    errors.push(`The name cannot contain the city name "${term}".`);
  }

  for (const term of findTerms(trimmed, WARNING_TERMS)) {
    warnings.push(
      `The word "${term}" may be rejected by the authority. Please consider a different word.`
    );
  }

  // Dedupe while keeping order (e.g. "United" appears in more than one list context).
  const uniqueErrors = Array.from(new Set(errors));
  const uniqueWarnings = Array.from(new Set(warnings));

  return {
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
  };
}

// ---------------------------------------------------------------------------
// Activity fit: does a name reflect the selected business activities?
// ---------------------------------------------------------------------------
// IFZA expects at least one licensed activity to show in the name, and a name
// must not suggest a line of business the licence does not cover. Used to
// filter AI suggestions (hard) and to warn on typed names (soft).
//
// A name word is one of three kinds:
//  - ACTIVITY word: derived from the activity wording ("Plants" from
//    "Flowers & Ornamental Plants Trading", "Consultants" from "Consultancy").
//  - DESCRIPTOR word: a business-type word ("Design", "Studio", "Advisory")
//    that is NOT derived from the activities. It claims a business the client
//    did not choose, so the name does not fit.
//  - Anything else: a brand or coined word ("Tina", "GreenThumb") or a neutral
//    word ("Premium", "Global"). Allowed, but it does not count as an activity.

/** The rule text shown on the names step (also in COMPANY_NAME_RULES). */
export const NAME_ACTIVITY_RULE =
  'At least one of your selected business activities must be reflected in the company name.';

// Never count as an activity word, never flagged.
const CONNECTOR_WORDS = new Set([
  'and', 'the', 'for', 'with', 'other', 'all', 'any', 'including', 'related',
  'general', 'activities', 'activity', 'fzco',
]);

// Neutral words that fit IFZA naming: allowed, but they do not reflect an activity.
const NEUTRAL_WORDS = new Set([
  'premium', 'global', 'group', 'international', 'prime', 'elite', 'first',
]);

// Business-type words an AI likes to add. Allowed only when derived from the
// selected activities (e.g. "Trading" is fine when an activity says Trading).
const DESCRIPTOR_WORDS = new Set([
  'design', 'designs', 'designer', 'designers', 'studio', 'studios', 'atelier',
  'advisory', 'advisors', 'advisers', 'consulting', 'consultancy', 'consultants',
  'consultant', 'solutions', 'services', 'service', 'technologies', 'technology',
  'tech', 'digital', 'media', 'marketing', 'logistics', 'ventures', 'holdings',
  'holding', 'partners', 'management', 'creative', 'creations', 'labs', 'lab',
  'systems', 'engineering', 'interiors', 'interior', 'events', 'properties',
  'realty', 'capital', 'investments', 'investment', 'finance', 'financial',
  'agency', 'works', 'innovations', 'industries', 'supplies', 'supply',
  'imports', 'exports', 'import', 'export', 'trading', 'trade', 'traders',
  'commerce', 'commercial', 'enterprises', 'concepts', 'projects', 'associates',
  'research', 'health', 'wellness', 'beauty', 'fashion', 'foods', 'food',
  'retail', 'store', 'shop', 'boutique', 'collective', 'crafts', 'academy',
  'education', 'training', 'software', 'hospitality', 'travel', 'tours',
  'transport', 'shipping', 'freight', 'construction', 'contracting',
  'maintenance', 'cleaning', 'security', 'energy', 'electronics', 'motors',
  'rentals', 'brokerage', 'brokers', 'accounting', 'audit', 'legal', 'tax',
  'insurance', 'medical', 'pharma', 'analytics', 'data', 'cloud', 'network',
  'networks', 'communications', 'telecom', 'productions', 'production', 'films',
  'publishing', 'printing', 'packaging', 'manufacturing', 'development',
  'developers', 'builders', 'strategy', 'strategies', 'branding', 'decor',
  'landscaping', 'landscapes', 'architecture', 'architects',
]);

/** Letters-only words; splits "GreenThumb" into "Green", "Thumb". */
function nameWords(text: string): string[] {
  return (text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2);
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Same word family: "trade"/"trading", "consultants"/"consultancy", "plant"/"plants". */
function sameWordFamily(a: string, b: string): boolean {
  const x = singular(a);
  const y = singular(b);
  if (x === y) return true;
  let prefix = 0;
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++;
  return prefix >= 4 && prefix >= 0.6 * Math.min(x.length, y.length);
}

/** The words of the activity descriptions that can reflect an activity in a name. */
export function activityKeywords(activities: string[]): string[] {
  const words = new Set<string>();
  for (const activity of activities) {
    for (const word of nameWords(activity)) {
      if (word.length >= 3 && !CONNECTOR_WORDS.has(word)) words.add(word);
    }
  }
  return Array.from(words);
}

export interface NameActivityFit {
  /** true when the name reflects an activity and adds no unrelated business word. */
  fits: boolean;
  /** At least one word of the name comes from the activity wording. */
  hasActivityWord: boolean;
  /** Business-type words that do not come from the activities (e.g. "Design"). */
  unrelatedWords: string[];
}

/**
 * Checks a name against the selected activity descriptions. With no activity
 * text there is nothing to check against, so the name fits.
 */
export function checkNameActivityFit(name: string, activities: string[]): NameActivityFit {
  const keywords = activityKeywords(activities);
  if (keywords.length === 0) return { fits: true, hasActivityWord: true, unrelatedWords: [] };

  let hasActivityWord = false;
  const unrelated: string[] = [];
  const original = (name || '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).filter(Boolean);
  for (const word of nameWords(name)) {
    if (CONNECTOR_WORDS.has(word)) continue;
    const derived = keywords.some((k) => sameWordFamily(word, k));
    if (derived && !NEUTRAL_WORDS.has(word)) {
      hasActivityWord = true;
      continue;
    }
    if (derived || NEUTRAL_WORDS.has(word)) continue;
    if (DESCRIPTOR_WORDS.has(word) || DESCRIPTOR_WORDS.has(singular(word))) {
      const shown = original.find((w) => w.toLowerCase() === word) ?? word;
      if (!unrelated.includes(shown)) unrelated.push(shown);
    }
  }
  return { fits: hasActivityWord && unrelated.length === 0, hasActivityWord, unrelatedWords: unrelated };
}

/**
 * A short example name built from the first activity ("Horizon Plants Trading"),
 * or null when no clean example can be made.
 */
export function exampleNameFromActivities(activities: string[], brand = 'Horizon'): string | null {
  const first = (activities.find((a) => a && a.trim()) ?? '').trim();
  if (!first) return null;
  const words = first
    .split(/[,(;/]/)[0]
    .replace(/[^A-Za-z&\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  while (words.length > 0 && ['&', 'and', 'of', 'the', 'for'].includes(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  if (words.length === 0) return null;
  const example = `${brand} ${words.join(' ')}`;
  return validateCompanyName(example).valid ? example : null;
}
