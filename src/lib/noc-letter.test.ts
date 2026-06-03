import { describe, it, expect } from 'vitest';
import { buildNocText, type NocLetterFields } from './noc-letter';

// A fully-populated set of merge fields used as the baseline; individual tests
// override the relationship / gender to exercise the derived wording.
const FULL: NocLetterFields = {
  sponsorName: 'John Smith',
  sponsorNationality: 'British',
  sponsorPassportNumber: 'P1234567',
  sponsorMobile: '+971501234567',
  relationship: 'husband',
  dependentName: 'Jane Smith',
  dependentNationality: 'British',
  dependentPassportNumber: 'P7654321',
  dependentGender: 'female',
  companyName: 'TME Services FZE',
  jobTitle: 'Accountant',
};

describe('buildNocText — relationship + gender wording', () => {
  it('husband relationship → sponsor "Mr.", kinship "wife", dependent "Mrs."', () => {
    // Sponsor IS the dependent's husband → sponsor is male ("Mr."),
    // dependent is his "wife" ("Mrs.").
    const text = buildNocText({ ...FULL, relationship: 'husband' });
    expect(text).toContain('I, Mr. John Smith');
    expect(text).toContain('have no objection for my wife');
    expect(text).toContain('Mrs. Jane Smith');
  });

  it('wife relationship → sponsor "Mrs.", kinship "husband", dependent "Mr."', () => {
    // Sponsor IS the dependent's wife → sponsor is female ("Mrs."),
    // dependent is her "husband" ("Mr.").
    const text = buildNocText({
      ...FULL,
      relationship: 'wife',
      dependentName: 'James Smith',
    });
    expect(text).toContain('I, Mrs. John Smith');
    expect(text).toContain('have no objection for my husband');
    expect(text).toContain('Mr. James Smith');
  });

  it('father + female dependent → sponsor "Mr.", kinship "daughter", dependent "Ms."', () => {
    const text = buildNocText({
      ...FULL,
      relationship: 'father',
      dependentGender: 'female',
    });
    expect(text).toContain('I, Mr. John Smith');
    expect(text).toContain('have no objection for my daughter');
    expect(text).toContain('Ms. Jane Smith');
  });

  it('father + male dependent → sponsor "Mr.", kinship "son", dependent "Mr."', () => {
    const text = buildNocText({
      ...FULL,
      relationship: 'father',
      dependentGender: 'male',
      dependentName: 'James Smith',
    });
    expect(text).toContain('I, Mr. John Smith');
    expect(text).toContain('have no objection for my son');
    expect(text).toContain('Mr. James Smith');
  });

  it('mother + female dependent → sponsor "Mrs.", kinship "daughter", dependent "Ms."', () => {
    const text = buildNocText({
      ...FULL,
      relationship: 'mother',
      dependentGender: 'female',
    });
    expect(text).toContain('I, Mrs. John Smith');
    expect(text).toContain('have no objection for my daughter');
    expect(text).toContain('Ms. Jane Smith');
  });

  it('mother + male dependent → sponsor "Mrs.", kinship "son", dependent "Mr."', () => {
    const text = buildNocText({
      ...FULL,
      relationship: 'mother',
      dependentGender: 'male',
      dependentName: 'James Smith',
    });
    expect(text).toContain('I, Mrs. John Smith');
    expect(text).toContain('have no objection for my son');
    expect(text).toContain('Mr. James Smith');
  });

  it('son + male dependent → sponsor "Mr.", kinship "father", dependent "Mr."', () => {
    // Sponsor IS the dependent's son → sponsor is male ("Mr.");
    // a male dependent is the sponsor's "father" ("Mr.").
    const text = buildNocText({
      ...FULL,
      relationship: 'son',
      dependentGender: 'male',
      dependentName: 'James Smith',
    });
    expect(text).toContain('I, Mr. John Smith');
    expect(text).toContain('have no objection for my father');
    expect(text).toContain('Mr. James Smith');
  });

  it('son + female dependent → sponsor "Mr.", kinship "mother", dependent "Mrs."', () => {
    const text = buildNocText({
      ...FULL,
      relationship: 'son',
      dependentGender: 'female',
    });
    expect(text).toContain('I, Mr. John Smith');
    expect(text).toContain('have no objection for my mother');
    expect(text).toContain('Mrs. Jane Smith');
  });

  it('daughter + female dependent → sponsor "Ms.", kinship "mother", dependent "Mrs."', () => {
    // Sponsor IS the dependent's daughter → sponsor is female ("Ms.");
    // a female dependent is the sponsor's "mother" ("Mrs.").
    const text = buildNocText({
      ...FULL,
      relationship: 'daughter',
      dependentGender: 'female',
    });
    expect(text).toContain('I, Ms. John Smith');
    expect(text).toContain('have no objection for my mother');
    expect(text).toContain('Mrs. Jane Smith');
  });

  it('daughter + male dependent → sponsor "Ms.", kinship "father", dependent "Mr."', () => {
    const text = buildNocText({
      ...FULL,
      relationship: 'daughter',
      dependentGender: 'male',
      dependentName: 'James Smith',
    });
    expect(text).toContain('I, Ms. John Smith');
    expect(text).toContain('have no objection for my father');
    expect(text).toContain('Mr. James Smith');
  });

  it('parent relationship with missing gender → defaults to the male branch', () => {
    // dependentGender undefined → father/mother resolve to "son" ("Mr.").
    const text = buildNocText({
      ...FULL,
      relationship: 'father',
      dependentGender: undefined,
      dependentName: 'James Smith',
    });
    expect(text).toContain('have no objection for my son');
    expect(text).toContain('Mr. James Smith');
  });

  it('child relationship with missing gender → defaults to the male branch', () => {
    // dependentGender undefined → son/daughter resolve to "father" ("Mr.").
    const text = buildNocText({
      ...FULL,
      relationship: 'son',
      dependentGender: undefined,
      dependentName: 'James Smith',
    });
    expect(text).toContain('have no objection for my father');
    expect(text).toContain('Mr. James Smith');
  });
});

describe('buildNocText — merge-field interpolation', () => {
  it('interpolates every merge field into the output', () => {
    const text = buildNocText(FULL);
    expect(text).toContain('John Smith');
    expect(text).toContain('British');
    expect(text).toContain('P1234567'); // sponsor passport
    expect(text).toContain('P7654321'); // dependent passport
    expect(text).toContain('Jane Smith');
    expect(text).toContain('TME Services FZE');
    expect(text).toContain('Accountant');
    expect(text).toContain('+971501234567');
  });

  it('trims surrounding whitespace from filled fields', () => {
    const text = buildNocText({ ...FULL, sponsorName: '  John Smith  ' });
    expect(text).toContain('Mr. John Smith,');
    expect(text).not.toContain('Mr.   John Smith');
  });
});

describe('buildNocText — missing fields', () => {
  it('does not throw on a fully-empty field set', () => {
    expect(() => buildNocText({})).not.toThrow();
  });

  it('renders the em-dash placeholder for missing merge fields', () => {
    const text = buildNocText({ relationship: 'husband', dependentGender: 'female' });
    // Every merge field is absent, so each renders the placeholder.
    expect(text).toContain('—');
    // Relationship-derived words still resolve (don't fall back to placeholder).
    expect(text).toContain('have no objection for my wife');
    expect(text).toContain('Mrs. —');
  });

  it('renders the placeholder for blank / whitespace-only fields', () => {
    const text = buildNocText({ ...FULL, sponsorName: '   ', jobTitle: '' });
    expect(text).toContain('I, Mr. —,');
    expect(text).toContain('as a —.');
  });

  it('falls back to the placeholder sponsor title, kinship + dependent title when relationship is unknown', () => {
    // relationship undefined → sponsor title, kinship and dependent title all
    // render the em-dash placeholder rather than throwing.
    const text = buildNocText({ ...FULL, relationship: undefined });
    expect(text).toContain('I, — John Smith'); // sponsor title em-dash
    expect(text).toContain('for my — — Jane Smith'); // kinship + depTitle both em-dash
  });
});
