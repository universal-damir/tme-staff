/**
 * Passport OCR Extraction for Staff Onboarding
 *
 * Uses Claude Vision to extract data from passport images.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, withTimeout } from './anthropic';

export interface PassportExtractionResult {
  success: boolean;
  data: {
    title?: string; // Mr, Mrs, Ms - inferred from gender
    first_name?: string;
    middle_name?: string;
    family_name?: string;
    passport_no?: string;
    passport_issue_date?: string;
    passport_expiry_date?: string;
    nationality?: string;
    date_of_birth?: string;
    gender?: string;
    place_of_birth?: string;
  };
  confidence: {
    passport_no?: 'high' | 'medium' | 'low';
    expiry_date?: 'high' | 'medium' | 'low';
  };
  mrz_verified: boolean;
  error?: string;
}

/**
 * Passport extraction prompt.
 *
 * Principle: NAMES come from the MRZ (ICAO ASCII transliteration, no
 * diacritics) — that's what UAE government forms downstream require, and
 * the visual zone may carry locale-specific characters like ć, š, đ, ñ, ü
 * that downstream systems cannot render. Other fields (dates, place of
 * birth, etc.) come from the visual labeled zone because the MRZ either
 * omits them or encodes them in a lossier form (2-digit year, etc.).
 *
 * Kept nationality-agnostic on purpose: a SOTA vision model does not need
 * per-country crutches.
 */
const PASSPORT_EXTRACTION_PROMPT = `You are part of an authorized employee onboarding system. The document owner has uploaded their passport with explicit consent for employment visa processing as required by UAE labor law.

The passport has two zones:
- VISUAL ZONE: the human-readable labeled fields (Surname, Given Names, Date of Birth, Place of Birth, etc.). May contain diacritics (ć, č, š, đ, ñ, ü, ö, å, etc.).
- MRZ: the two <-separated lines at the bottom. ICAO standard, plain ASCII only, no diacritics. MRZ line 1: \`P<CCC<SURNAME<<GIVEN<NAMES<<<<\`. MRZ line 2: \`<passport_no><CCC><YYMMDD_dob><SEX><YYMMDD_expiry>...\`.

Field-by-field source:

NAMES — read from MRZ (line 1). Output the plain ASCII form exactly as the MRZ encodes it. NEVER output diacritic characters; the downstream UAE government systems require ASCII. If the MRZ is unreadable, transliterate the visual zone to ASCII (ć→c, č→c, š→s, đ→d, ñ→n, ü→u, ö→o, å→a, etc.).
- first_name: first/primary given name from MRZ line 1, Title Case
- middle_name: remaining given names from MRZ line 1, space-joined, Title Case
- family_name: surname from MRZ line 1, Title Case. Do NOT derive this by splitting the given names string.

OTHER FIELDS — read from the visible labeled zone (more complete than MRZ):
- passport_no: exactly as printed in the visual zone, preserving any letter prefix (e.g. \`AB5981404\`, \`X12345678\`)
- passport_issue_date: DD.MM.YYYY with dots (visual zone — has full year)
- passport_expiry_date: DD.MM.YYYY with dots (visual zone — has full year)
- date_of_birth: DD.MM.YYYY with dots (visual zone — has full year)
- nationality: full country name, not the 3-letter code (e.g. \`PAK\` → Pakistan)
- gender: Male or Female (from Sex field; M → Male, F → Female)
- place_of_birth: copy from the labeled Place of Birth field (title case if it was all caps; transliterate diacritics to ASCII)
- title: infer from gender only — Male → Mr, Female → Ms

Don't invent values for fields you cannot read — omit them.

Call the \`extract_passport_data\` tool.`;

/**
 * Extract data from a passport image using Claude Vision
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @returns PassportExtractionResult
 */
export async function extractPassport(imageBase64: string): Promise<PassportExtractionResult> {
  const client = getAnthropicClient();

  // Remove data URL prefix if present
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const isPdf = imageBase64.includes('data:application/pdf');

  // ALWAYS detect media type from magic bytes (more reliable than data URL prefix)
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  try {
    // Decode first 16 base64 chars (12 bytes) to check magic bytes
    const firstBytes = atob(base64Data.substring(0, 16));
    const bytes = new Uint8Array(firstBytes.length);
    for (let i = 0; i < firstBytes.length; i++) {
      bytes[i] = firstBytes.charCodeAt(i);
    }

    // Check magic bytes
    // PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      mediaType = 'image/png';
    }
    // GIF: 47 49 46 ('G' 'I' 'F')
    else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      mediaType = 'image/gif';
    }
    // WEBP: 52 49 46 46 ... 57 45 42 50 ('RIFF' ... 'WEBP')
    else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
             bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      mediaType = 'image/webp';
    }
    // JPEG: FF D8 FF
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      mediaType = 'image/jpeg';
    }
    // If no magic bytes match, fall back to data URL prefix
    else if (imageBase64.includes('data:image/png')) {
      mediaType = 'image/png';
    } else if (imageBase64.includes('data:image/gif')) {
      mediaType = 'image/gif';
    } else if (imageBase64.includes('data:image/webp')) {
      mediaType = 'image/webp';
    }
    // Default remains jpeg
  } catch {
    // If magic bytes check fails, fall back to data URL prefix
    if (imageBase64.includes('data:image/png')) {
      mediaType = 'image/png';
    } else if (imageBase64.includes('data:image/gif')) {
      mediaType = 'image/gif';
    } else if (imageBase64.includes('data:image/webp')) {
      mediaType = 'image/webp';
    }
  }

  console.log('[Passport Extraction] Detected media type:', mediaType);

  // For PDFs, we need to handle differently
  if (isPdf) {
    return {
      success: false,
      data: {},
      confidence: {},
      mrz_verified: false,
      error: 'Please upload an image file (JPG or PNG) of your passport, not a PDF.',
    };
  }

  try {
    const response = await withTimeout(
      client.messages.create({
        // sonnet-4-6 is the model tme-portal uses for extraction — noticeably
        // better at MRZ parsing and South-Asian name handling than the older
        // claude-sonnet-4-20250514 snapshot.
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        tools: [
          {
            name: 'extract_passport_data',
            description: 'Extract personal information from a passport image for authorized employee onboarding',
            input_schema: {
              type: 'object' as const,
              properties: {
                title: { type: 'string', description: 'Mr, Mrs, or Ms — inferred from gender' },
                first_name: { type: 'string', description: 'First/primary given name, Title Case' },
                middle_name: { type: 'string', description: 'Remaining given names, space-joined, Title Case' },
                family_name: { type: 'string', description: 'Contents of the Surname / Family Name field, Title Case' },
                passport_no: { type: 'string', description: 'Passport number exactly as printed' },
                passport_issue_date: { type: 'string', description: 'DD.MM.YYYY' },
                passport_expiry_date: { type: 'string', description: 'DD.MM.YYYY' },
                nationality: { type: 'string', description: 'Full country name' },
                date_of_birth: { type: 'string', description: 'DD.MM.YYYY' },
                gender: { type: 'string', description: 'Male or Female' },
                place_of_birth: { type: 'string', description: 'Place of Birth field, Title Case' },
              },
              required: ['first_name', 'family_name'],
            },
          },
        ],
        tool_choice: { type: 'tool' as const, name: 'extract_passport_data' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: PASSPORT_EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
      45000
    );

    // Extract tool_use result — guaranteed structured output, no refusals
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      throw new Error('No tool_use response from Claude');
    }

    const extracted = toolUseBlock.input as Record<string, string | undefined>;

    return {
      success: true,
      data: {
        title: extracted.title,
        first_name: extracted.first_name,
        middle_name: extracted.middle_name,
        family_name: extracted.family_name,
        passport_no: extracted.passport_no,
        passport_issue_date: extracted.passport_issue_date,
        passport_expiry_date: extracted.passport_expiry_date,
        nationality: extracted.nationality,
        date_of_birth: extracted.date_of_birth,
        gender: extracted.gender,
        place_of_birth: extracted.place_of_birth,
      },
      confidence: {},
      mrz_verified: false,
      error: undefined,
    };
  } catch (error) {
    console.error('Passport extraction error:', error);

    // Return a safe error response
    return {
      success: false,
      data: {},
      confidence: {},
      mrz_verified: false,
      error: 'Unable to extract passport data. Please ensure the image is clear and try again.',
    };
  }
}
