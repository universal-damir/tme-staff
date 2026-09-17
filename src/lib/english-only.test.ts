/**
 * English letters only — the rule that decides what can be stored.
 *
 * It exists because a UAE authority form takes A-Z and nothing else, and
 * because on 16.09.2026 a Turkish home address typed on the onboarding form
 * ("Bestekar Sadi Ho{s-cedilla}ses cd. ... Kar{s-cedilla}{dotless-i}yaka")
 * reached the confirmation PDF unfiltered and killed it: no PDF was stored and
 * no confirmation email was sent, while the onboarding looked complete.
 *
 * MIRRORED TEST: `tme-portal/src/__tests__/clients-v2/english-only.test.ts`
 * runs the same cases against the copy in that repo. If one changes, both change.
 */

import { describe, it, expect } from 'vitest';
import {
  toEnglishLetters,
  hasNonEnglish,
  foldPayloadToEnglish,
  NON_ENGLISH_FIELDS,
} from '@/lib/english-only';

describe('toEnglishLetters', () => {
  it('rewrites the Turkish address that broke 11524-003', () => {
    expect(
      toEnglishLetters(
        'Bestekar Sadi Hoşses cd. no:45 daire:11 Atakent-Karşıyaka Izmir, Turkey'
      )
    ).toBe('Bestekar Sadi Hosses cd. no:45 daire:11 Atakent-Karsiyaka Izmir, Turkey');
  });

  it('writes a name the way a passport line writes it', () => {
    expect(toEnglishLetters('Şengül Gökçe')).toBe('Sengul Gokce');
    expect(toEnglishLetters('Müller')).toBe('Muller');
    expect(toEnglishLetters('José Martínez')).toBe('Jose Martinez');
    expect(toEnglishLetters('Łukasz Wałęsa')).toBe('Lukasz Walesa');
    expect(toEnglishLetters('Đorđe Škoda')).toBe('Dorde Skoda');
    expect(toEnglishLetters('Østergaard')).toBe('Ostergaard');
    expect(toEnglishLetters('Weiß')).toBe('Weiss');
    expect(toEnglishLetters('İstanbul')).toBe('Istanbul');
    expect(toEnglishLetters('Nguyễn')).toBe('Nguyen');
  });

  it('drops a script that has no Latin base — typing it must produce nothing', () => {
    expect(toEnglishLetters('محمد')).toBe('');
    expect(toEnglishLetters('中文')).toBe('');
    expect(toEnglishLetters('Владимир')).toBe('');
    expect(toEnglishLetters('\u{1F600}')).toBe('');
  });

  it('keeps the English part when a name is written in both scripts', () => {
    expect(toEnglishLetters('Mohammed محمد')).toBe('Mohammed ');
  });

  it('normalizes Word punctuation rather than dropping it', () => {
    expect(toEnglishLetters('“Quoted” – it’s fine…')).toBe(
      '"Quoted" - it\'s fine...'
    );
    expect(toEnglishLetters('a b')).toBe('a b');
    expect(toEnglishLetters('a​b')).toBe('ab');
  });

  it('leaves symbols alone — the rule is about alphabets, not arithmetic', () => {
    expect(toEnglishLetters('€1.200 at 15°C ± 2 § 4')).toBe(
      '€1.200 at 15°C ± 2 § 4'
    );
  });

  it('keeps the line breaks a multi-line address needs', () => {
    expect(toEnglishLetters('Line one\nLine two')).toBe('Line one\nLine two');
  });

  it('leaves text that is already English exactly as it is', () => {
    const plain = "O'Brien-Smith, Flat 12/B, P.O. Box 9000 (Dubai)";
    expect(toEnglishLetters(plain)).toBe(plain);
  });

  it('is idempotent — folding twice changes nothing more', () => {
    const once = toEnglishLetters('Şengül محمد “test”');
    expect(toEnglishLetters(once)).toBe(once);
  });

  it('never returns a letter outside A-Z', () => {
    const nasty =
      'Şığİłđøæß 中文 محمد ' +
      'Влад “—… José \u{1F600}';
    for (const ch of toEnglishLetters(nasty)) {
      if (/\p{L}/u.test(ch)) expect(/[A-Za-z]/.test(ch)).toBe(true);
    }
  });

  it('handles empty and missing input without throwing', () => {
    expect(toEnglishLetters('')).toBe('');
    expect(toEnglishLetters(undefined as unknown as string)).toBe(undefined);
  });
});

describe('hasNonEnglish', () => {
  it('reports only text the rule would change', () => {
    expect(hasNonEnglish('Dilara Ozkilic')).toBe(false);
    expect(hasNonEnglish('Karşıyaka')).toBe(true);
    expect(hasNonEnglish('')).toBe(false);
  });
});

describe('foldPayloadToEnglish', () => {
  it('folds nested strings and arrays', () => {
    const folded = foldPayloadToEnglish({
      first_name: 'Dilara',
      home_street_address: 'Karşıyaka',
      nationalities: ['Türkiye', 'Deutschland'],
      dependents: [{ name: 'Şengül' }],
    });
    expect(folded.home_street_address).toBe('Karsiyaka');
    expect(folded.nationalities).toEqual(['Turkiye', 'Deutschland']);
    expect(folded.dependents[0].name).toBe('Sengul');
  });

  it('leaves the Arabic name fields alone — they are copied off the licence', () => {
    const arabic = 'شركة تي إم إي';
    const folded = foldPayloadToEnglish(
      { company_name: 'FSB Middle East Trading LLC', company_name_arabic: arabic },
      NON_ENGLISH_FIELDS
    );
    expect(folded.company_name_arabic).toBe(arabic);
    expect(folded.company_name).toBe('FSB Middle East Trading LLC');
  });

  it('passes a Date and other non-plain objects through untouched', () => {
    const date = new Date('2026-09-16T11:39:07.932Z');
    const folded = foldPayloadToEnglish({ date, name: 'Gökçe' });
    expect(folded.date).toBe(date);
    expect(folded.name).toBe('Gokce');
  });

  it('leaves numbers, booleans and null as they are', () => {
    const folded = foldPayloadToEnglish({ age: 34, active: true, ended: null });
    expect(folded).toEqual({ age: 34, active: true, ended: null });
  });
});
