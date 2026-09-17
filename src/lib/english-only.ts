/**
 * English letters only.
 *
 * Every authority a TME client deals with — ICP, MoHRE, DET, the banks — takes
 * A-Z and nothing else. A passport's machine-readable zone is A-Z. So a name or
 * address that reaches us in Turkish, Polish, Cyrillic or Arabic script cannot
 * be filed anywhere: it has to be written in English letters first.
 *
 * This is the single rule. It runs in three places:
 *   1. the staff onboarding form (tme-staff) — as the person types,
 *   2. the portal's client and staff forms — as we type,
 *   3. the server, on every save — so an old submission, an OCR autofill or a
 *      direct API write cannot slip past the two forms.
 *
 * MIRRORED FILE: `tme-portal/src/lib/english-only.ts` must stay identical.
 * Two repos, one rule — change both or neither.
 *
 * It replaced a WinAnsi fold that existed only inside the PDF generators. That
 * fold stays as the last net, but it only ever fired because this rule was
 * missing at the door: on 16.09.2026 a Turkish home address killed the whole
 * confirmation step for 11524-003 and nobody was told.
 */

/**
 * Latin letters that carry no A-Z form and do NOT decompose under NFD, so the
 * diacritic strip cannot reach them. Each maps to how the letter is written in
 * an English-letter passport line.
 */
const NON_DECOMPOSING_LATIN: Record<string, string> = {
  '\u0131': 'i', // dotless i (Turkish)
  '\u0130': 'I', // I with dot above (Turkish)
  '\u0142': 'l', '\u0141': 'L', // l with stroke (Polish)
  '\u0111': 'd', '\u0110': 'D', // d with stroke (Croatian, Vietnamese)
  '\u00F0': 'd', '\u00D0': 'D', // eth (Icelandic)
  '\u00F8': 'o', '\u00D8': 'O', // o with stroke (Nordic)
  '\u00E6': 'ae', '\u00C6': 'AE', // ae ligature
  '\u0153': 'oe', '\u0152': 'OE', // oe ligature
  '\u00DF': 'ss', '\u1E9E': 'SS', // sharp s (German)
  '\u00FE': 'th', '\u00DE': 'Th', // thorn (Icelandic)
  '\u0127': 'h', '\u0126': 'H', // h with stroke (Maltese)
  '\u014B': 'n', '\u014A': 'N', // eng
  '\u0167': 't', '\u0166': 'T', // t with stroke
  '\u017F': 's', // long s
  '\u0138': 'k', // kra
};

/** Word/keyboard punctuation that has a plain ASCII equivalent. */
const PUNCTUATION: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2039\u203A\u00B4\u0060]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'],
  [/\u2026/g, '...'],
  // Non-breaking and typographic spaces become an ordinary space.
  [/[\u00A0\u2007\u202F\u2000-\u200A]/g, ' '],
  // Zero-width characters carry no meaning and confuse every downstream form.
  [/[\u200B-\u200D\uFEFF]/g, ''],
];

/**
 * Symbols that are not letters and so are not what this rule is about. A note
 * reading "EUR 1.200 / 15 \u00B0C" must survive: the rule blocks alphabets,
 * not arithmetic and currency.
 */
const KEPT_SYMBOLS = new Set(
  '\u20AC\u00A2\u00A3\u00A5\u00A4\u00A7\u00A9\u00AE\u00B0\u00B1\u00B5\u00B6\u00B7\u00D7\u00F7\u00B9\u00B2\u00B3\u00BC\u00BD\u00BE\u2030\u2032\u2033\u2122\u2020\u2021\u2022'
);

/** Printable ASCII, the line breaks a textarea needs, and the symbols above. */
const isEnglish = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  if ((code >= 0x20 && code <= 0x7e) || code === 0x0a || code === 0x0d) return true;
  return KEPT_SYMBOLS.has(ch);
};

/**
 * Rewrite text in English letters.
 *
 * A letter with a Latin base becomes that base — "Kar\u015F\u0131yaka" reads
 * "Karsiyaka", "M\u00FCller" reads "Muller", exactly as the passport line
 * writes them. A character with no Latin base at all (Arabic, Chinese,
 * Cyrillic, emoji) is DROPPED, not replaced: typing in another script must
 * produce nothing, so it is obvious the field wants English.
 *
 * Symbols are not alphabets and are left alone: "\u20AC", "\u00B0", "\u00A7" and
 * the like pass through untouched.
 */
export function toEnglishLetters(text: string): string {
  if (!text) return text;

  let working = text;
  for (const [pattern, replacement] of PUNCTUATION) {
    working = working.replace(pattern, replacement);
  }
  working = working.replace(
    /[\u0131\u0130\u0142\u0141\u0111\u0110\u00F0\u00D0\u00F8\u00D8\u00E6\u00C6\u0153\u0152\u00DF\u1E9E\u00FE\u00DE\u0127\u0126\u014A\u014B\u0166\u0167\u017F\u0138]/g,
    (ch) => NON_DECOMPOSING_LATIN[ch]
  );

  // Split each letter into base + combining marks, then keep only the base.
  let out = '';
  for (const ch of working.normalize('NFD')) {
    // U+0300-U+036F are the combining marks left behind by the split.
    if (ch >= '\u0300' && ch <= '\u036F') continue;
    if (isEnglish(ch)) out += ch;
  }
  return out;
}

/** True when the text carries anything `toEnglishLetters` would change. */
export function hasNonEnglish(text: string): boolean {
  return Boolean(text) && toEnglishLetters(text) !== text;
}

/**
 * Fold every string in a payload.
 *
 * `exempt` names the fields that legitimately hold another script — the Arabic
 * company and person names we copy from a trade licence — plus anything that
 * is data rather than text (base64 images, tokens).
 */
export function foldPayloadToEnglish<T>(value: T, exempt: readonly string[] = []): T {
  const fold = (input: unknown): unknown => {
    if (typeof input === 'string') return toEnglishLetters(input);
    if (Array.isArray(input)) return input.map(fold);
    // Only plain objects are walked: a Date, a Buffer or a class instance is
    // passed through as it is.
    if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, val]) => [
          key,
          exempt.includes(key) ? val : fold(val),
        ])
      );
    }
    return input;
  };
  return fold(value) as T;
}

/**
 * Fields that hold another script ON PURPOSE and must never be folded.
 * The Arabic name is copied from the trade licence and printed back onto
 * government paperwork exactly as issued.
 */
export const NON_ENGLISH_FIELDS = [
  'company_name_arabic',
  'name_arabic',
  'client_name_arabic',
  'description_arabic',
] as const;

/** Marks an input the guard must leave alone. Spread onto the element. */
export const ALLOW_NON_ENGLISH_ATTR = { 'data-allow-non-english': 'true' } as const;
