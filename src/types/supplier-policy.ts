// Supplier Verification Policy (SVP) client intake - shared data contract.
// MIRROR of the portal repo's src/lib/supplier-checks/types.ts (the single
// source of truth) - keep both copies in sync. Only the part the client form
// needs lives here: the answers, the prefill, the role keys and the limits.
//
// The portal mints the link and pushes `prefill_data` (SvpPrefill) to the
// Supabase `svp_intake_submissions` row; this app writes `submitted_data`
// (SvpPolicyAnswers) and flips the row to 'submitted'.

export type SvpRoleKey = 'implementer' | 'reviewer' | 'supervisor';
export const SVP_ROLE_KEYS: readonly SvpRoleKey[] = ['implementer', 'reviewer', 'supervisor'];

export interface SvpPerson {
  name: string;
  position: string;
  /** Required for the Supervisor (the signer); optional for the other two. */
  email: string;
}

export interface SvpPolicyAnswers {
  implementer: SvpPerson;
  reviewer: SvpPerson;
  supervisor: SvpPerson;
  /** Free text, max 300. Ignored when recordsLocationIsRegisteredOffice. */
  recordsLocation: string;
  recordsLocationIsRegisteredOffice: boolean;
  /** The client ticked the price box. The form refuses to submit without it. */
  priceAgreed: true;
  /** Optional "anything we should know", max 1000. */
  note?: string;
  /**
   * The client ticked "TME Services does not check your suppliers or purchases
   * and does not keep these documents" (policy section 8). tme-staff only so
   * far: the form refuses to submit without it and the submit route rejects a
   * body without it. Rides in submitted_data (JSONB); the portal sync ignores
   * unknown keys, so old rows (without it) and new rows both sync.
   */
  dutyAcknowledged?: true;
  /**
   * Company details the client says are different from our records (TRN,
   * VAT periods, registered office). Only the changed ones are present; absent
   * = the client confirmed what we have. The portal shows them to the VAT
   * team, who fix the client record; the policy keeps reading the record.
   */
  companyChanges?: SvpCompanyChanges;
}

/** The client's corrections to the read-only company block. Plain text. */
export interface SvpCompanyChanges {
  trn?: string;
  /** As a sentence: "February to April, May to July, ..." or the client's own words. */
  vatPeriods?: string;
  registeredAddress?: string;
}

/** Pushed to Supabase at mint; shown read-only or as defaults on the form. */
export interface SvpPrefill {
  companyName: string;
  companyCode: string;
  trn: string | null;
  registeredAddress: string | null;
  vatPeriodsText: string | null;
  /** VAT-exclusive AED. */
  priceAed: number | null;
  suggested: { implementer: SvpPerson; reviewer: SvpPerson; supervisor: SvpPerson };
  /** Active, contactable management officers, for a pick list. */
  officers: SvpPerson[];
}

/** Three different people, one person in two roles, or one person in all three. */
export type SvpRoleVariant = 'three' | 'two' | 'one';

/** Field limits, shared by the portal and this form. */
export const SVP_LIMITS = {
  name: 120,
  position: 120,
  email: 254,
  recordsLocation: 300,
  note: 1000,
  trn: 40,
  vatPeriods: 300,
  registeredAddress: 300,
} as const;

/** Supabase svp_intake_submissions.status. */
export type SvpSubmissionStatus = 'invited' | 'submitted' | 'synced' | 'cancelled';
