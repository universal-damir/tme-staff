import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, COMPANY_SETUP_BUCKET } from '@/lib/supabase-server';
import {
  verifyCompanySetupAccess,
  documentsErrorForRow,
} from '@/lib/company-setup-token';
import { sanitizeFreeText } from '@/lib/submit-validation';
import { validateSubmission } from '@/lib/company-setup-validation';
import { passportAdditionalPageVariant } from '@/lib/staff-form-logic';
import type {
  CompanySetupDocuments,
  CompanySetupPerson,
  CompanySetupPersonDocuments,
  CompanySetupSubmittedData,
} from '@/types/company-setup';

export const runtime = 'nodejs';

const MAX_SUBMIT_BYTES = 256 * 1024;

/**
 * Server-side required-documents gate. The client form gates every step, but
 * the server is the authority — a stale client state or hand-crafted POST must
 * never reach status='submitted' with missing documents.
 *
 * Per person: passport + photo + proof of address ALWAYS.
 * Indian / Syrian nationals additionally need the passport's additional page.
 * EID/visa set depends on currentOrPastEidVisa:
 *   'current' -> eid_front + eid_back + visa_document
 *   'past'    -> previous_visa_document
 *   'none'    -> nothing extra
 */
function missingPersonDocuments(
  persons: CompanySetupPerson[],
  documents: CompanySetupDocuments
): string[] {
  const missing: string[] = [];
  persons.forEach((person, index) => {
    const label = person?.fullName?.trim() || `Person ${index + 1}`;
    const docs: CompanySetupPersonDocuments = documents[String(index)] ?? {};
    if (!docs.passport?.path) missing.push(`${label}: passport copy`);
    const additionalVariant = passportAdditionalPageVariant(person?.nationality);
    if (additionalVariant && !docs.passport_additional?.path) {
      missing.push(
        additionalVariant === 'syria'
          ? `${label}: passport issue-details page`
          : `${label}: passport address / family-details page`
      );
    }
    if (!docs.photo?.path) missing.push(`${label}: portrait photo`);
    if (!docs.proof_of_address?.path) missing.push(`${label}: proof of address (bank statement)`);
    if (person?.currentOrPastEidVisa === 'current') {
      if (!docs.eid_front?.path) missing.push(`${label}: Emirates ID (front)`);
      if (!docs.eid_back?.path) missing.push(`${label}: Emirates ID (back)`);
      if (!docs.visa_document?.path) missing.push(`${label}: current UAE visa copy`);
    } else if (person?.currentOrPastEidVisa === 'past') {
      if (!docs.previous_visa_document?.path) missing.push(`${label}: previous UAE visa copy`);
    }
  });
  return missing;
}

/**
 * The storage paths of the documents the gate above just declared present.
 * Used for the existence check: a ref in the JSON is not proof of a file in
 * the bucket (an upload can fail after the client recorded it, or a path can
 * be hand-crafted), and a submission that flips to 'submitted' with a dangling
 * path becomes a broken sync in the portal.
 */
function requiredDocumentPaths(
  persons: CompanySetupPerson[],
  documents: CompanySetupDocuments
): string[] {
  const paths: string[] = [];
  persons.forEach((person, index) => {
    const docs: CompanySetupPersonDocuments = documents[String(index)] ?? {};
    const slots: Array<keyof CompanySetupPersonDocuments> = ['passport', 'photo', 'proof_of_address'];
    if (passportAdditionalPageVariant(person?.nationality)) slots.push('passport_additional');
    if (person?.currentOrPastEidVisa === 'current') {
      slots.push('eid_front', 'eid_back', 'visa_document');
    } else if (person?.currentOrPastEidVisa === 'past') {
      slots.push('previous_visa_document');
    }
    for (const slot of slots) {
      const path = docs[slot]?.path;
      if (path) paths.push(path);
    }
  });
  return Array.from(new Set(paths));
}

// POST /api/company-setup/[token]/submit
// Body: { submittedData: CompanySetupSubmittedData, documents?: CompanySetupDocuments }
// Full server-side gate (rules + required documents), then flips the row to
// 'submitted' so the portal's sync-company-setup cron picks it up.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const access = await verifyCompanySetupAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }
  const row = access.row;

  const raw = await req.text();
  if (raw.length > MAX_SUBMIT_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let body: { submittedData?: unknown; documents?: unknown; confirmed?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (
    body.submittedData === null ||
    body.submittedData === undefined ||
    typeof body.submittedData !== 'object' ||
    Array.isArray(body.submittedData)
  ) {
    return NextResponse.json({ error: 'invalid_submitted_data' }, { status: 400 });
  }

  // The client must explicitly tick "I confirm the details are true and
  // complete". The server stamps confirmedAt itself — never trusted from the
  // browser.
  if (body.confirmed !== true) {
    return NextResponse.json({ error: 'confirmation_required' }, { status: 400 });
  }

  const submittedData = sanitizeFreeText(
    body.submittedData
  ) as unknown as CompanySetupSubmittedData;
  submittedData.confirmedAt = new Date().toISOString();

  // Structural sanity before the rule validators walk the object.
  if (!submittedData.company || typeof submittedData.company !== 'object') {
    return NextResponse.json({ error: 'invalid_submitted_data' }, { status: 400 });
  }
  if (!Array.isArray(submittedData.persons)) {
    return NextResponse.json({ error: 'invalid_submitted_data' }, { status: 400 });
  }

  // Documents: prefer the payload (the form's final state), fall back to the
  // autosaved refs on the row. Either way every path must belong to this row.
  let documents: CompanySetupDocuments;
  if (body.documents !== undefined) {
    const docsError = documentsErrorForRow(body.documents, row.id);
    if (docsError) {
      return NextResponse.json({ error: 'invalid_documents', detail: docsError }, { status: 400 });
    }
    documents = sanitizeFreeText(body.documents) as CompanySetupDocuments;
  } else {
    documents = row.documents ?? {};
  }

  // Full rule gate: exactly 3 rule-valid names, 1..10 activities, 1..6
  // persons, exactly one GM, exactly one secretary, >=1 director,
  // shareholders total 100%.
  const validation = validateSubmission(submittedData);

  // Required documents per person.
  const missingDocs = missingPersonDocuments(submittedData.persons, documents);

  if (!validation.valid || missingDocs.length > 0) {
    return NextResponse.json(
      {
        error: 'validation_failed',
        errors: validation.errors,
        missingDocuments: missingDocs,
      },
      { status: 422 }
    );
  }

  // Proof of address is ALWAYS a manual-review document (bank statement, max
  // 3 months old — a human checks the date and the address match). Enforced
  // here so a client payload can never clear the flag.
  for (const personDocs of Object.values(documents)) {
    if (personDocs?.proof_of_address) {
      personDocs.proof_of_address.needsReview = true;
    }
  }

  const supabase = getSupabaseAdmin();

  // Every required document must actually exist in the bucket. createSignedUrls
  // is one round trip for the whole set and reports per-path errors.
  const paths = requiredDocumentPaths(submittedData.persons, documents);
  if (paths.length > 0) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(COMPANY_SETUP_BUCKET)
      .createSignedUrls(paths, 60);
    if (signErr) {
      console.error('company-setup/submit: could not verify stored documents');
      return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
    }
    const missingFiles = (signed ?? [])
      .filter((entry) => entry.error || !entry.signedUrl)
      .map((entry) => entry.path)
      .filter((p): p is string => typeof p === 'string');
    // A path we asked about but got no row back for is missing too.
    const returned = new Set((signed ?? []).map((entry) => entry.path));
    for (const p of paths) if (!returned.has(p)) missingFiles.push(p);
    if (missingFiles.length > 0) {
      console.error(
        `company-setup/submit: ${missingFiles.length} recorded document(s) are not in storage`
      );
      return NextResponse.json(
        {
          error: 'validation_failed',
          errors: [],
          missingDocuments: [
            'Some uploaded files could not be found any more. Please re-upload the documents marked below and submit again.',
          ],
          missingPaths: missingFiles,
        },
        { status: 422 }
      );
    }
  }
  const { error, count } = await supabase
    .from('company_setup_intake_submissions')
    .update(
      {
        submitted_data: submittedData,
        documents,
        status: 'submitted',
        synced_to_tme: false,
        submitted_at: new Date().toISOString(),
      },
      { count: 'exact' }
    )
    .eq('id', row.id)
    // Guard against double-submit racing the row to 'submitted' twice.
    .in('status', ['invited', 'in_progress']);

  if (error) {
    console.error('company-setup/submit: failed to submit');
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
