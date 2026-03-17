/**
 * Passport Page Type Validation
 *
 * Uses Claude Vision to identify what type of passport page an uploaded image is.
 * Used to validate that users upload the correct passport pages.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export type PassportPageType = 'COVER' | 'INSIDE_PAGES' | 'INVALID';

export interface PassportPageValidationResult {
  page_type: PassportPageType;
  confidence: number;
  details: string;
}

/**
 * Passport page validation - requires spread/open passport (both pages visible)
 * UAE government requirement: passport must be photographed open/spread, not single pages
 */

// Prompt for COVER validation
const COVER_VALIDATION_PROMPT = `You are validating a passport cover image. The passport MUST be photographed spread open, showing BOTH the front cover AND the back cover in a single image.

Analyze the image:

VALID (spread open passport cover):
- Two distinct halves visible side by side
- One side has the national emblem/coat of arms/text, the other side is plain or has minor markings
- The book spine/fold is visible in the center
- The image shows the passport laid flat and open

INVALID (these are NOT acceptable):
- Only ONE side of the passport cover is visible (just the front or just the back)
- The emblem/logo is centered in the image (indicating a single page, not spread open)
- The passport data page is visible (this is the inside, not the cover)
- Not a passport at all
- A closed passport (not spread open)

Respond with ONLY a JSON object:
{"valid": true, "reason": "brief explanation"} or {"valid": false, "reason": "brief explanation"}`;

// Prompt for INSIDE_PAGES validation
const INSIDE_PAGES_VALIDATION_PROMPT = `Step 1: How many passport pages are visible in this image? (Count: 1 or 2)
Step 2: Based on count, answer valid or invalid.

If count is 1 (only the data page visible, no second page): {"count": 1, "valid": false}
If count is 2 (data page AND opposite page both visible): {"count": 2, "valid": true}`;

/**
 * Validate passport page based on expected type
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @param expectedType - The type of page we expect (COVER or INSIDE_PAGES)
 * @returns PassportPageValidationResult
 */
export async function validatePassportPage(
  imageBase64: string,
  expectedType?: PassportPageType
): Promise<PassportPageValidationResult> {
  const client = getAnthropicClient();

  // Remove data URL prefix if present
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  // Detect media type
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (imageBase64.includes('data:image/png')) {
    mediaType = 'image/png';
  } else if (imageBase64.includes('data:image/gif')) {
    mediaType = 'image/gif';
  } else if (imageBase64.includes('data:image/webp')) {
    mediaType = 'image/webp';
  }

  // Select prompt based on expected type
  const prompt = expectedType === 'COVER'
    ? COVER_VALIDATION_PROMPT
    : expectedType === 'INSIDE_PAGES'
    ? INSIDE_PAGES_VALIDATION_PROMPT
    : COVER_VALIDATION_PROMPT; // default

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-6', // Latest Sonnet for best visual analysis
        max_tokens: 256,
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
      30000 // 30 second timeout
    );

    // Extract text content
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // DEBUG: Log raw Claude response
    console.log('[Passport Validation] Raw Claude response:', textBlock.text);

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON response');
    }

    const result = JSON.parse(jsonMatch[0]) as { valid: boolean; reason?: string };
    console.log('[Passport Validation] Parsed result:', result);

    // Convert valid/invalid to page_type
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

    // Return a safe error response
    return {
      page_type: 'INVALID',
      confidence: 0,
      details: 'Unable to validate passport page. Please try again.',
    };
  }
}
