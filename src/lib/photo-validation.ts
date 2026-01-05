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
 * Photo validation prompt based on UAE visa photo requirements
 */
const PHOTO_VALIDATION_PROMPT = `Analyze this passport/visa photo against UAE visa photo requirements.

ONLY check these CRITICAL requirements (ignore everything else like clothing, hairstyle, etc.):

1. BACKGROUND: Must be white or light colored (not busy/patterned)
2. FACE VISIBLE: Full face clearly visible, not obscured
3. EYES: Both eyes open and visible (no hair covering eyes)
4. GLASSES: No glasses (this is strict - any glasses = fail)
5. FACE ANGLE: Looking at camera, face not turned sideways
6. HEAD COVERING: Only religious head coverings allowed (face must still be visible)
7. IMAGE QUALITY: Not blurry, reasonably clear
8. SINGLE PERSON: Only one person in photo
9. OBVIOUS ISSUES: No sunglasses, masks, or face covered

DO NOT flag these (they are acceptable):
- Clothing style, color, or patterns
- Hair style or if hair looks "messy"
- Minor shadows that don't obscure the face
- Slight smile (only flag wide open-mouth smiles)
- Exact face size percentage (as long as face is clearly visible)
- Minor lighting variations

BE LENIENT. This photo will be reviewed by a human anyway. Only reject if there's a CLEAR problem that would definitely cause the visa photo to be rejected.

Return JSON:
{
  "valid": true or false,
  "errors": ["only list REAL problems"],
  "suggestions": ["how to fix"],
  "confidence": 0-100
}

When in doubt, ACCEPT the photo.`;

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

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON response');
    }

    const result = JSON.parse(jsonMatch[0]) as PhotoValidationResult;

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
