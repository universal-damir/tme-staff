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
