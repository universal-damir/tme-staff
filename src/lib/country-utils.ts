/**
 * Utility to map nationality names to ISO 3166-1 alpha-2 country codes.
 * Used to auto-set phone input country when user selects a nationality.
 */

import en from 'react-phone-number-input/locale/en';
import type { Country } from 'react-phone-number-input';

// Build reverse map: country name -> ISO code
const nameToCode: Record<string, Country> = {};
for (const [code, name] of Object.entries(en)) {
  // Skip non-country keys (ext, country, phone, ZZ)
  if (code.length === 2 && code !== 'ZZ' && typeof name === 'string') {
    nameToCode[name] = code as Country;
  }
}

// Manual overrides for NATIONALITIES names that differ from locale names
const NATIONALITY_OVERRIDES: Record<string, Country> = {
  'Brunei': 'BN',
  'Congo (DRC)': 'CD',
  'Congo (Republic)': 'CG',
  'East Timor': 'TL',
  'Eswatini': 'SZ',
  'Ivory Coast': 'CI',
  'Micronesia': 'FM',
  'Vatican City': 'VA',
  'South Korea': 'KR',
  'North Korea': 'KP',
  'Palestine': 'PS',
  'Taiwan': 'TW',
  'Tanzania': 'TZ',
  'Venezuela': 'VE',
  'Vietnam': 'VN',
  'Bolivia': 'BO',
  'Iran': 'IR',
  'Syria': 'SY',
  'Laos': 'LA',
  'Moldova': 'MD',
  'Russia': 'RU',
  'Macedonia': 'MK',
};

export function nationalityToCountryCode(nationality: string): Country | undefined {
  return NATIONALITY_OVERRIDES[nationality] || nameToCode[nationality] || undefined;
}

/**
 * Common passport-printed variants → NATIONALITIES entry.
 * The passport extractor is instructed to return "full country name" but real
 * passports print demonyms ("PAKISTANI"), official long names ("Islamic
 * Republic of Pakistan"), or uppercase forms. This map normalizes those into
 * the NATIONALITIES list values used by the dropdown.
 *
 * Keys are lowercased for lookup. Keep demonyms + common long-form variants.
 */
const NATIONALITY_ALIAS_TO_CANONICAL: Record<string, string> = {
  // Demonyms
  'pakistani': 'Pakistan',
  'indian': 'India',
  'bangladeshi': 'Bangladesh',
  'afghan': 'Afghanistan',
  'british': 'United Kingdom',
  'english': 'United Kingdom',
  'scottish': 'United Kingdom',
  'welsh': 'United Kingdom',
  'northern irish': 'United Kingdom',
  'american': 'United States',
  'canadian': 'Canada',
  'australian': 'Australia',
  'kiwi': 'New Zealand',
  'german': 'Germany',
  'french': 'France',
  'italian': 'Italy',
  'spanish': 'Spain',
  'portuguese': 'Portugal',
  'dutch': 'Netherlands',
  'swiss': 'Switzerland',
  'austrian': 'Austria',
  'belgian': 'Belgium',
  'swedish': 'Sweden',
  'norwegian': 'Norway',
  'danish': 'Denmark',
  'finnish': 'Finland',
  'irish': 'Ireland',
  'greek': 'Greece',
  'polish': 'Poland',
  'russian': 'Russia',
  'ukrainian': 'Ukraine',
  'romanian': 'Romania',
  'hungarian': 'Hungary',
  'bulgarian': 'Bulgaria',
  'czech': 'Czech Republic',
  'slovak': 'Slovakia',
  'serbian': 'Serbia',
  'croatian': 'Croatia',
  'bosnian': 'Bosnia and Herzegovina',
  'albanian': 'Albania',
  'turkish': 'Turkey',
  'iranian': 'Iran',
  'iraqi': 'Iraq',
  'syrian': 'Syria',
  'lebanese': 'Lebanon',
  'jordanian': 'Jordan',
  'saudi': 'Saudi Arabia',
  'saudi arabian': 'Saudi Arabia',
  'emirati': 'United Arab Emirates',
  'emirian': 'United Arab Emirates',
  'qatari': 'Qatar',
  'bahraini': 'Bahrain',
  'kuwaiti': 'Kuwait',
  'omani': 'Oman',
  'yemeni': 'Yemen',
  'egyptian': 'Egypt',
  'moroccan': 'Morocco',
  'algerian': 'Algeria',
  'tunisian': 'Tunisia',
  'libyan': 'Libya',
  'sudanese': 'Sudan',
  'somali': 'Somalia',
  'ethiopian': 'Ethiopia',
  'kenyan': 'Kenya',
  'ugandan': 'Uganda',
  'tanzanian': 'Tanzania',
  'south african': 'South Africa',
  'nigerian': 'Nigeria',
  'ghanaian': 'Ghana',
  'senegalese': 'Senegal',
  'ivorian': 'Ivory Coast',
  'zimbabwean': 'Zimbabwe',
  'rwandan': 'Rwanda',
  'chinese': 'China',
  'japanese': 'Japan',
  'korean': 'South Korea',
  'south korean': 'South Korea',
  'north korean': 'North Korea',
  'taiwanese': 'Taiwan',
  'filipino': 'Philippines',
  'filipina': 'Philippines',
  'philippine': 'Philippines',
  'indonesian': 'Indonesia',
  'malaysian': 'Malaysia',
  'singaporean': 'Singapore',
  'thai': 'Thailand',
  'vietnamese': 'Vietnam',
  'burmese': 'Myanmar',
  'cambodian': 'Cambodia',
  'laotian': 'Laos',
  'sri lankan': 'Sri Lanka',
  'nepali': 'Nepal',
  'nepalese': 'Nepal',
  'bhutanese': 'Bhutan',
  'maldivian': 'Maldives',
  'mexican': 'Mexico',
  'brazilian': 'Brazil',
  'argentinian': 'Argentina',
  'argentine': 'Argentina',
  'chilean': 'Chile',
  'colombian': 'Colombia',
  'peruvian': 'Peru',
  'venezuelan': 'Venezuela',
  'ecuadorian': 'Ecuador',
  'uruguayan': 'Uruguay',
  'paraguayan': 'Paraguay',
  'bolivian': 'Bolivia',

  // Long official names
  'islamic republic of pakistan': 'Pakistan',
  'republic of india': 'India',
  'people\'s republic of china': 'China',
  'peoples republic of china': 'China',
  'united states of america': 'United States',
  'united kingdom of great britain and northern ireland': 'United Kingdom',
  'great britain': 'United Kingdom',
  'russian federation': 'Russia',
  'federal republic of germany': 'Germany',
  'french republic': 'France',
  'italian republic': 'Italy',
  'kingdom of saudi arabia': 'Saudi Arabia',
  'syrian arab republic': 'Syria',
  'the syrian arab republic': 'Syria',
  'arab republic of syria': 'Syria',
  'hashemite kingdom of jordan': 'Jordan',
  'the hashemite kingdom of jordan': 'Jordan',
  'arab republic of egypt': 'Egypt',
  'republic of iraq': 'Iraq',
  'lebanese republic': 'Lebanon',
  'republic of lebanon': 'Lebanon',
};

/**
 * Resolve an extracted nationality string (from passport / ID document AI
 * extraction) to a canonical entry in NATIONALITIES. Handles case differences,
 * demonyms, and common official long-form country names. Returns undefined if
 * no reasonable match can be found — callers should leave the dropdown blank
 * rather than set a nonsense value the dropdown can't display.
 */
export function resolveExtractedNationality(
  extracted: string | undefined | null,
  nationalities: readonly string[]
): string | undefined {
  if (!extracted) return undefined;
  const trimmed = extracted.trim();
  if (!trimmed) return undefined;

  // 1) Exact match against the canonical list
  if (nationalities.includes(trimmed)) return trimmed;

  // 2) Case-insensitive match — handles "PAKISTAN" or "pakistan"
  const lower = trimmed.toLowerCase();
  const ciMatch = nationalities.find(n => n.toLowerCase() === lower);
  if (ciMatch) return ciMatch;

  // 3) Demonym / long-name alias table
  const aliased = NATIONALITY_ALIAS_TO_CANONICAL[lower];
  if (aliased && nationalities.includes(aliased)) return aliased;

  return undefined;
}
