/**
 * Passport Page Type Validation
 *
 * Uses Claude Vision with tool_use to validate passport page layout.
 * tool_use forces structured output and prevents model refusals.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, withTimeout } from './anthropic';

export type PassportPageType = 'COVER' | 'INSIDE_PAGES' | 'INVALID';

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
- The book spine/fold is visible between the two halves
- The passport is laid flat and open, whether oriented horizontally (halves side by side) or vertically (halves top and bottom)
- One half has the national emblem/coat of arms/text, the other is plain or has minor markings (e.g. a visa sticker, health-authority sticker, airport stamp, worn area) — minor markings on the back cover are NORMAL and VALID

INVALID (these are NOT acceptable):
- Only ONE side of the passport cover is visible (just the front or just the back)
- The emblem/logo is centered in the image with no second half visible (indicates a single page, not spread open)
- The passport data page is visible (this is the INSIDE, not the cover — should be uploaded as passport INSIDE instead)
- Not a passport at all
- A closed passport (not spread open)

Set "valid" to true if this is a spread-open passport cover per the rules above. If you see a fold/spine dividing two halves AND one half shows a national emblem/symbol, it is VALID even if the other half has stickers or minor markings.

In "reason", briefly describe what you see (mention orientation and which half has the emblem).`;

const INSIDE_PROMPT = `${AUTH_CONTEXT}You are validating a passport INSIDE / data-page image. The passport MUST be photographed spread open, showing BOTH the data/bio page AND the opposite page.

Analyze the image:

VALID (spread open passport inside pages):
- Both the data page (with photo, name, passport number, dates, MRZ) AND the opposite page are visible in a single image
- The book spine/fold is visible between the two halves
- The passport is laid flat and open

INVALID (these are NOT acceptable):
- Only 1 page is visible (just the data page by itself)
- The passport cover is visible (this is the OUTSIDE, not the inside)
- Not a passport at all
- A closed passport

Set "valid" to true only if this shows 2 passport inside pages spread open.

In "reason", briefly describe what you see (e.g., "data page on right with photo + MRZ, visa stamps on left", or "single data page only").`;

/**
 * Validate passport page using tool_use (prevents model refusals)
 */
export async function validatePassportPage(
  imageBase64: string,
  expectedType?: PassportPageType
): Promise<PassportPageValidationResult> {
  const client = getAnthropicClient();

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (imageBase64.includes('data:image/png')) mediaType = 'image/png';
  else if (imageBase64.includes('data:image/gif')) mediaType = 'image/gif';
  else if (imageBase64.includes('data:image/webp')) mediaType = 'image/webp';

  const prompt = expectedType === 'INSIDE_PAGES' ? INSIDE_PROMPT : COVER_PROMPT;

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
