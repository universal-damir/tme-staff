/**
 * Pure builder for the sponsor "No Objection Certificate" (NOC) letter body.
 *
 * Family-sponsored staff have their residence visa held by a family member
 * (husband, wife, father, mother, son or daughter). That sponsor must declare
 * they have no objection to the dependent working at TME. This module renders
 * the human-readable letter text with the merge fields interpolated — it is the
 * in-form preview the sponsor sees before signing. The portal renders the final
 * signed PDF separately.
 *
 * Kept pure (no React, no I/O) so it can be unit-tested in isolation and
 * shared by the preview and any server-side rendering.
 *
 * The `relationship` value means "the SPONSOR is the dependent's {relationship}"
 * (recorded from the employee/dependent's perspective). The NOC is written in
 * the sponsor's voice, so the wording is flipped: e.g. when the sponsor is the
 * dependent's "husband", the sponsor refers to the dependent as "my wife".
 *
 * Canonical wording is taken from the TME master NOC template.
 */

export type SponsorRelationship =
  | 'husband'
  | 'wife'
  | 'father'
  | 'mother'
  | 'son'
  | 'daughter';

export interface NocLetterFields {
  sponsorName?: string;
  sponsorNationality?: string;
  sponsorPassportNumber?: string;
  sponsorMobile?: string;
  relationship?: SponsorRelationship;
  dependentName?: string;
  dependentNationality?: string;
  dependentPassportNumber?: string;
  dependentGender?: 'male' | 'female';
  companyName?: string;
  jobTitle?: string;
}

// Placeholder rendered for any merge field that is missing or blank, so the
// preview never shows "undefined" and never throws.
const PLACEHOLDER = '—';

/** Trim a possibly-undefined value, falling back to the em-dash placeholder. */
function fill(value: string | undefined | null): string {
  if (typeof value !== 'string') return PLACEHOLDER;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : PLACEHOLDER;
}

/**
 * The honorific the dependent uses for the SPONSOR, derived from the
 * relationship (the role the sponsor plays in the dependent's family):
 *   husband | father | son → "Mr."
 *   wife    | mother       → "Mrs."
 *   daughter              → "Ms."
 * Falls back to the placeholder when the relationship is unknown.
 */
function sponsorTitle(relationship: NocLetterFields['relationship']): string {
  switch (relationship) {
    case 'husband':
    case 'father':
    case 'son':
      return 'Mr.';
    case 'wife':
    case 'mother':
      return 'Mrs.';
    case 'daughter':
      return 'Ms.';
    default:
      return PLACEHOLDER;
  }
}

/**
 * The kinship word the sponsor uses for the dependent — the relationship flipped
 * to the sponsor's voice. Where the flipped word is gendered (parent ↔ child),
 * the dependent's own gender decides it (defaulting to the male branch when
 * unknown):
 *   husband  → "wife"
 *   wife     → "husband"
 *   father   → "son" (male) / "daughter" (female)
 *   mother   → "son" (male) / "daughter" (female)
 *   son      → "father" (male) / "mother" (female)
 *   daughter → "father" (male) / "mother" (female)
 * Falls back to the placeholder when the relationship is unknown.
 */
function dependentWord(
  relationship: NocLetterFields['relationship'],
  dependentGender: NocLetterFields['dependentGender'],
): string {
  switch (relationship) {
    case 'husband':
      return 'wife';
    case 'wife':
      return 'husband';
    case 'father':
    case 'mother':
      return dependentGender === 'female' ? 'daughter' : 'son';
    case 'son':
    case 'daughter':
      return dependentGender === 'female' ? 'mother' : 'father';
    default:
      return PLACEHOLDER;
  }
}

/**
 * The dependent's honorific, derived from the resolved kinship word:
 *   wife | mother → "Mrs."
 *   daughter      → "Ms."
 *   husband | son | father → "Mr."
 * Falls back to the placeholder when the kinship word is unknown.
 */
function dependentTitleFromWord(word: string): string {
  switch (word) {
    case 'wife':
    case 'mother':
      return 'Mrs.';
    case 'daughter':
      return 'Ms.';
    case 'husband':
    case 'son':
    case 'father':
      return 'Mr.';
    default:
      return PLACEHOLDER;
  }
}

/**
 * Build the NOC letter body with all merge fields interpolated. Missing fields
 * are rendered as an em-dash placeholder rather than throwing, so the preview
 * stays robust while the sponsor is still filling the form.
 */
export function buildNocText(fields: NocLetterFields): string {
  const title = sponsorTitle(fields.relationship);
  const kinship = dependentWord(fields.relationship, fields.dependentGender);
  const depTitle = dependentTitleFromWord(kinship);

  return (
    `Please be informed that I, ${title} ${fill(fields.sponsorName)}, ` +
    `${fill(fields.sponsorNationality)} national holding passport number ` +
    `${fill(fields.sponsorPassportNumber)} have no objection for my ${kinship} ` +
    `${depTitle} ${fill(fields.dependentName)}, ${fill(fields.dependentNationality)} ` +
    `national holding passport number ${fill(fields.dependentPassportNumber)} ` +
    `working at ${fill(fields.companyName)} as a ${fill(fields.jobTitle)}.` +
    `\n\nIf you have any questions on this matter, please do not hesitate to contact ` +
    `me on ${fill(fields.sponsorMobile)}.`
  );
}
