/**
 * Passport Page Type Validation
 *
 * Uses Claude Vision to identify what type of passport page an uploaded image is.
 * Used to validate that users upload the correct passport pages.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export type PassportPageType = 'COVER' | 'INSIDE_PAGES' | 'DATA_PAGE' | 'OBSERVATIONS_PAGE' | 'INVALID';

export interface PassportPageValidationResult {
  page_type: PassportPageType;
  confidence: number;
  details: string;
}

/**
 * Prompt for identifying passport page types
 */
const PASSPORT_PAGE_VALIDATION_PROMPT = `Analyze this passport image and determine what type of page it is.

COVER: The outer cover/front of a closed passport. Usually shows:
- Country name and emblem/coat of arms
- The word "PASSPORT" in the country's language
- Typically has a distinct color (burgundy, blue, green, etc.)

INSIDE_PAGES: An open passport showing both inside pages together (data page + opposite page). MUST have:
- Holder's photograph visible
- Personal details (name, date of birth, nationality, etc.)
- MRZ (Machine Readable Zone) - two lines at the bottom
- Shows TWO pages side by side (the open passport)

DATA_PAGE: Just the biographical data page alone (not the full open passport). Has:
- Holder's photograph
- Personal details
- MRZ at the bottom
- Only ONE page visible

OBSERVATIONS_PAGE: Just the observations/amendments page alone.

INVALID: Not a valid passport page.

Respond ONLY with JSON:
{
  "page_type": "COVER" | "INSIDE_PAGES" | "DATA_PAGE" | "OBSERVATIONS_PAGE" | "INVALID",
  "confidence": 0-100,
  "details": "Brief description"
}`;

/**
 * Validate what type of passport page an image is
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @returns PassportPageValidationResult
 */
export async function validatePassportPage(imageBase64: string): Promise<PassportPageValidationResult> {
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

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-3-5-haiku-20241022', // Haiku for speed and cost
        max_tokens: 512,
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
                text: PASSPORT_PAGE_VALIDATION_PROMPT,
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

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON response');
    }

    const result = JSON.parse(jsonMatch[0]) as PassportPageValidationResult;

    // Validate response structure
    const validPageTypes: PassportPageType[] = ['COVER', 'INSIDE_PAGES', 'DATA_PAGE', 'OBSERVATIONS_PAGE', 'INVALID'];
    if (!validPageTypes.includes(result.page_type)) {
      result.page_type = 'INVALID';
    }

    return {
      page_type: result.page_type,
      confidence: result.confidence || 0,
      details: result.details || 'Unable to determine page type',
    };
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
