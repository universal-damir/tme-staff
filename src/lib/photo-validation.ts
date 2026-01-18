/**
 * Photo Validation for Staff Onboarding
 *
 * Uses Claude Vision to validate passport photos against UAE visa requirements.
 * Based on official UAE passport photo standards.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface PhotoValidationResult {
  valid: boolean;
  errors: string[];
  suggestions: string[];
  confidence: number;
}

/**
 * Simple photo validation - 5 rules + common sense
 */
const PHOTO_VALIDATION_PROMPT = `Check this passport photo against these requirements:

1. White background
2. Face takes up 70-80% of photo (head to top of shoulders visible)
3. Eyes open and clearly visible, no hair covering eyes or face
4. No glasses
5. No harsh shadows on face, no flash reflection, no red-eye

If it looks like a professional passport photo, accept it. Use common sense - don't reject for minor imperfections that any real passport office would accept.

Return JSON:
{
  "valid": true or false,
  "errors": ["which requirement failed"],
  "suggestions": ["how to fix"],
  "confidence": 0-100
}`;

/**
 * Validate a passport photo using Claude Vision
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @returns PhotoValidationResult
 */
export async function validatePhoto(imageBase64: string): Promise<PhotoValidationResult> {
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
        max_tokens: 1024,
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
                text: PHOTO_VALIDATION_PROMPT,
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
    console.log('[Photo Validation] Raw Claude response:', textBlock.text);

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON response');
    }

    const result = JSON.parse(jsonMatch[0]) as PhotoValidationResult;
    console.log('[Photo Validation] Parsed result:', result);

    // Validate response structure
    if (typeof result.valid !== 'boolean') {
      throw new Error('Invalid response: missing valid field');
    }

    return {
      valid: result.valid,
      errors: result.errors || [],
      suggestions: result.suggestions || [],
      confidence: result.confidence || 0,
    };
  } catch (error) {
    console.error('Photo validation error:', error);

    // Return a safe error response
    return {
      valid: false,
      errors: ['Unable to validate photo. Please try again.'],
      suggestions: ['Ensure the image is clear and try uploading again.'],
      confidence: 0,
    };
  }
}
