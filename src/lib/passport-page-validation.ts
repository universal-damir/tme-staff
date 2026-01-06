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
 * Passport page validation - count pages
 */
const PASSPORT_PAGE_VALIDATION_PROMPT = `How many passport pages are visible in this image?

- If it's the outside cover of a closed passport: return "COVER"
- If 2 pages visible (open passport lying flat): return "INSIDE_PAGES"
- If only 1 page visible (just the data page): return "INVALID"
- If not a passport: return "INVALID"

Return JSON:
{
  "page_type": "COVER" | "INSIDE_PAGES" | "INVALID",
  "confidence": 0-100,
  "pages_visible": number
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
    const validPageTypes: PassportPageType[] = ['COVER', 'INSIDE_PAGES', 'INVALID'];
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
