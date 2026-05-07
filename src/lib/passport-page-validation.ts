/**
 * Passport Page Type Validation
 *
 * Uses Claude Vision with tool_use to validate passport page layout.
 * tool_use forces structured output and prevents model refusals.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, withTimeout } from './anthropic';

export type PassportPageType = 'COVER' | 'INSIDE_PAGES' | 'ADDITIONAL_PAGE' | 'INVALID';

export interface PassportPageValidationResult {
  page_type: PassportPageType;
  confidence: number;
  details: string;
}

const AUTH_CONTEXT = `You are part of an authorized employee onboarding system. The document owner has uploaded their passport with explicit consent for employment visa processing as required by UAE labor law.\n\n`;

// Prompt mirrors tme-portal's proven cover validator (see
// tme-portal/src/app/api/clients-v2/staff/[staffId]/documents/parse/route.ts).
// Explicit VALID/INVALID bullet lists prevent Claude from drifting into the
// INSIDE_PAGES criteria when shown a valid cover spread.
const COVER_PROMPT = `${AUTH_CONTEXT}You are validating a passport cover image. The passport MUST be photographed spread open, showing BOTH the front cover AND the back cover in a single image.

Analyze the image:

VALID (spread open passport cover):
- Both the front cover AND back cover are visible in a single image
- A spine/fold divides the image into two halves. The spine may be SUBTLE — on dark, worn, or heavily-stickered covers it can be a faint vertical or horizontal line, a slight crease, or just a discontinuity between the two halves. Do NOT require a prominent spine.
- The passport is laid flat and open, whether oriented horizontally (halves side by side) or vertically (halves top and bottom)
- One half shows the national emblem / coat of arms / "PASSPORT" text. The other half is the back cover and may be:
  • plain
  • lightly marked (visa sticker, health-authority sticker, airport stamp, worn area)
  • heavily covered with airline baggage tags, IndiGo / airline luggage labels, security stickers, scanned barcodes, or multiple overlapping labels
  • scuffed, faded, or partly obscured
  All of the above are NORMAL and VALID. Heavy sticker coverage on the back cover does NOT invalidate the upload.
- Concrete VALID example: an Indian passport (dark blue/black cover) with the emblem and "REPUBLIC OF INDIA / PASSPORT" text on one half, and the other half fully covered with airline baggage tags — this IS valid.

INVALID (these are NOT acceptable):
- Only ONE side of the passport cover is visible (just the front, or just the back, with no second half present in the frame)
- The emblem/logo fills the entire frame with no second half visible at all (indicates a single page photographed, not the spread)
- The passport data page (with photo, name, MRZ) is visible — that is the INSIDE, not the cover
- Not a passport at all
- A closed passport (not spread open)

Decision rule: if you can identify TWO halves of roughly equal size in the image, AND one of those halves shows a national emblem or "PASSPORT" text, set valid=true — regardless of how heavily the other half is covered with stickers or labels. Only set valid=false when one of the INVALID conditions clearly applies.

In "reason", briefly describe what you see (mention orientation, which half has the emblem, and what is on the other half).`;

const INSIDE_PROMPT = `${AUTH_CONTEXT}You are validating a passport INSIDE / data-page image. The passport MUST be photographed spread open, showing BOTH the data/bio page AND the opposite page.

Analyze the image:

VALID (spread open passport inside pages):
- Both the data page (with photo, name, passport number, dates, MRZ) AND the opposite page are visible in a single image
- A spine/fold divides the image into two halves. The spine may be SUBTLE — a faint line, a slight curvature, or just a discontinuity between the two halves is enough. Do NOT require a prominent spine.
- The passport is laid flat and open, in any orientation (halves side by side or top and bottom)
- The opposite page may be:
  • blank or printed with the country's standard inside-cover text/instructions
  • covered with visa stamps, entry/exit stamps, residence-permit stickers, immigration markings
  • partly faded, scuffed, or worn
  All of the above are NORMAL and VALID. Heavy stamp/sticker coverage on the opposite page does NOT invalidate the upload.

INVALID (these are NOT acceptable):
- Only 1 page is visible (the data page fills the entire frame with no second half)
- The passport cover (emblem/coat-of-arms side, "PASSPORT" text on outside) is visible — that is the OUTSIDE, not the inside
- Not a passport at all
- A closed passport (not spread open)

Decision rule: if you can identify the data page (photo + MRZ + name) AND a second half is also visible in the frame, set valid=true — regardless of what is on the opposite page. Only set valid=false when one of the INVALID conditions clearly applies.

In "reason", briefly describe what you see (e.g., "data page on right with photo + MRZ, visa stamps on left", or "single data page only — no opposite page visible").`;

// Indian passport "Address page" — the last page of an Indian passport that
// lists Father's / Mother's / Spouse's name, the address, and the old
// passport / file number. Validation is INTENTIONALLY permissive: the page
// layout varies a lot between passport editions (booklet last pages, single
// addendum sheets, scanned addresses on the back of the data page), so we
// only reject obvious mismatches (clearly NOT a passport, or clearly the
// front cover / data page when the user is meant to upload the address page).
const ADDITIONAL_PAGE_PROMPT = `${AUTH_CONTEXT}You are validating the additional page of an Indian passport — the page that lists the holder's address and family details (Father, Mother, Spouse) plus the old passport / file number.

Analyze the image:

VALID (Indian passport additional / address page):
- Shows handwritten or printed family-name fields (Father's Name, Mother's Name, optionally Spouse's Name) AND/OR an Indian residential address (street, city, state, PIN code)
- May also show "OLD PASSPORT NO" or "FILE NUMBER" text/values
- Layout varies: it can be the last booklet page, a separate addendum sheet, or even the back of the data page in some editions. All of these are VALID.
- The page may be partly handwritten, partly typewritten, partly printed; faded or photocopy-quality is fine
- A two-page spread that includes the address page on either half is VALID

INVALID (clearly the wrong page):
- The passport COVER (national emblem + "REPUBLIC OF INDIA / PASSPORT" text) is shown — that's the cover, not the additional page
- The DATA page (with photo + MRZ + Surname / Given Names / Nationality / Sex fields) is shown — that's the inside, not the additional page
- Not a passport at all (random document, photo of a person, screenshot, etc.)

Decision rule: if you can see ANY of {family-name fields, Indian address, old passport / file number}, set valid=true. Only set valid=false when you can clearly identify it as the cover or the data page, or when it's clearly not a passport at all. When in doubt, prefer valid=true — the user has explicitly said they're uploading the Indian additional page and a TME reviewer will eyeball it later if needed.

In "reason", briefly describe what you see (e.g., "Address page with father / mother names + Mumbai address visible", or "shows the data page with photo + MRZ — wrong page").`;

/**
 * Validate passport page using tool_use (prevents model refusals)
 */
export async function validatePassportPage(
  imageBase64: string,
  expectedType?: PassportPageType
): Promise<PassportPageValidationResult> {
  const client = getAnthropicClient();

  // Strip the data URL prefix regardless of mime — handles both
  // `data:image/...;base64,...` and `data:application/pdf;base64,...`.
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');

  // PDF support via Claude's `document` content block — Anthropic
  // rasterizes pages and runs the same vision model. Mirrors the
  // pattern in visa-document-validation.ts so a user who scanned
  // their passport once as a PDF can reuse that file here.
  const isPdf =
    imageBase64.startsWith('data:application/pdf') || imageBase64.includes('application/pdf');

  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (imageBase64.includes('data:image/png')) mediaType = 'image/png';
  else if (imageBase64.includes('data:image/gif')) mediaType = 'image/gif';
  else if (imageBase64.includes('data:image/webp')) mediaType = 'image/webp';

  const prompt =
    expectedType === 'INSIDE_PAGES'
      ? INSIDE_PROMPT
      : expectedType === 'ADDITIONAL_PAGE'
        ? ADDITIONAL_PAGE_PROMPT
        : COVER_PROMPT;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileContent: any = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        tools: [
          {
            name: 'validate_passport_page',
            description: 'Report whether the passport page layout is valid (spread open with both pages visible)',
            input_schema: {
              type: 'object' as const,
              properties: {
                valid: {
                  type: 'boolean',
                  description: 'true if passport is spread open showing required pages, false otherwise',
                },
                reason: {
                  type: 'string',
                  description: 'Brief explanation of what is visible in the image',
                },
              },
              required: ['valid', 'reason'],
            },
          },
        ],
        tool_choice: { type: 'tool' as const, name: 'validate_passport_page' },
        messages: [
          {
            role: 'user',
            content: [
              fileContent,
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
      30000
    );

    // Extract tool_use result — guaranteed structured output
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      throw new Error('No tool_use response');
    }

    const result = toolUseBlock.input as { valid: boolean; reason: string };
    console.log('[Passport Validation] Result:', result);

    if (result.valid) {
      return {
        page_type: expectedType || 'COVER',
        confidence: 90,
        details: result.reason || 'Valid passport page',
      };
    } else {
      return {
        page_type: 'INVALID',
        confidence: 90,
        details: result.reason || 'Not a valid spread passport - need both pages visible',
      };
    }
  } catch (error) {
    console.error('Passport page validation error:', error);
    return {
      page_type: 'INVALID',
      confidence: 0,
      details: 'Unable to validate passport page. Please try again.',
    };
  }
}
