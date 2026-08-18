export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export type AllowedExt = '.jpg' | '.jpeg' | '.png' | '.webp' | '.pdf' | '.heic';

const ALLOWED: ReadonlyArray<AllowedExt> = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.heic'];

export function detectExtFromMagic(bytes: Uint8Array): AllowedExt | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return '.png';

  // PDF: 25 50 44 46 2D
  if (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  ) return '.pdf';

  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return '.webp';

  // HEIC: 'ftyp' at offset 4 + 'heic'/'heix'/'hevc'/'mif1' brand
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'mif1') return '.heic';
  }

  return null;
}

export function mimeForExt(ext: AllowedExt): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    case '.heic':
      return 'image/heic';
  }
}

export function isAllowedExt(ext: string): ext is AllowedExt {
  return (ALLOWED as ReadonlyArray<string>).includes(ext.toLowerCase());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSubmissionId(id: string): boolean {
  return UUID_RE.test(id);
}

const ALLOWED_TYPES = new Set([
  'photo',
  'passport',
  'eid',
  'eid_front',
  'eid_back',
  'pakistan_id_front',
  'pakistan_id_back',
  'degree_attested',
  'transcript_of_records',
  'education_additional',
  'job_offer_letter',
  'visa_document',
  'previous_visa_document',
  // Generic document-request types (re-request flow; no dedicated slot).
  // Portal document_type keys — storage path is `<rowId>/<type>/<uuid>`.
  'visa',
  'employment_contract',
  'work_permit',
  'health_insurance',
  'iloe_insurance',
  'driving_license',
  'sponsor_passport',
  'sponsor_visa',
  'sponsor_eid_front',
  'sponsor_eid_back',
  // Dependent slots. Plain uploads: relationship certificate + the
  // previously-held UAE visa/EID set. Written as flat refs by the dependent
  // ONBOARDING form ('dependent'), and reused as generic re-request slots on
  // 'dependent_document_request' (same storage segments, but the ref lands in
  // extra_documents). A 'dependent_renewal' uses the passport/photo segments
  // above and needs nothing extra here.
  'relationship_certificate',
  'previous_visa',
  'previous_eid_front',
  'previous_eid_back',
  // Relationship-driven certificate set (dependent visa v2). Plain uploads,
  // written as flat refs by the dependent onboarding form and reusable as
  // generic re-request slots on 'dependent_document_request'.
  'marriage_certificate',
  'divorce_certificate',
  'death_certificate',
  // Non-marriage undertaking for a dependent child 18+. Requestable-only:
  // never collected in the onboarding form (TME arranges the Arabic document
  // separately), but the Request Documents flow can ask the sponsor to upload
  // the signed copy.
  'noc_unmarried',
  // Custom-named document requests upload under this fixed segment — the
  // free-text name lives only in the extra_documents key (`custom:<name>`),
  // never in the storage path.
  'custom',
]);

export function isAllowedType(t: string): boolean {
  return ALLOWED_TYPES.has(t);
}

const ALLOWED_PASSPORT_PAGES = new Set(['cover', 'insidePages', 'additionalPage']);

export function isAllowedPassportPage(p: string): boolean {
  return ALLOWED_PASSPORT_PAGES.has(p);
}
