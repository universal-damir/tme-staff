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
 * Practical photo validation prompt for UAE visa photos
 *
 * IMPORTANT: This should accept standard professional passport photos.
 * Only reject photos with CLEAR, OBVIOUS problems.
 */
const PHOTO_VALIDATION_PROMPT = `Analyze this passport/visa photo. Your job is to accept standard passport photos and only reject photos with CLEAR PROBLEMS.

IMPORTANT MINDSET: If this photo looks like a normal passport photo taken at a photo studio, ACCEPT IT. Do not be pedantic about minor details.

ACCEPT the photo if:
- It's a professional-looking passport/ID photo
- The person's face is clearly visible
- Background is white, off-white, or very light gray (typical studio backgrounds)
- Normal lighting with the face clearly lit

ONLY REJECT for these CLEAR PROBLEMS:

1. BACKGROUND - Only reject if:
   - Background is a CLEARLY VISIBLE COLOR (blue, red, green, etc.)
   - Background shows objects, furniture, or is clearly not a studio background
   - DO NOT reject for: minor shadows, slight gradients, off-white tones - these are NORMAL in studio photos

2. FACE VISIBILITY - Only reject if:
   - Face is significantly cut off (forehead or chin missing from frame)
   - Face is way too small (clearly a full-body or distance shot)
   - Hair or objects ACTUALLY COVERING the eyes or significant part of face
   - DO NOT reject for: normal hairstyles, hair on forehead that doesn't cover eyes

3. EYES - Only reject if:
   - Eyes are closed
   - Sunglasses or dark glasses covering eyes
   - DO NOT reject for: regular prescription glasses with clear lenses

4. HEAD POSITION - Only reject if:
   - Head is significantly tilted or turned away (profile shot)
   - Person looking away from camera
   - DO NOT reject for: slight natural head position variations

5. EXPRESSION - Only reject if:
   - Wide open mouth or extreme expression
   - DO NOT reject for: slight smile, neutral expression variations

6. LIGHTING - Only reject if:
   - Face is in complete shadow or severely underexposed
   - Harsh flash making face completely white/overexposed
   - DO NOT reject for: normal studio lighting shadows, natural skin tones

THINGS TO ALWAYS ACCEPT (DO NOT FLAG):
- Minor shadows on background (normal in studio photos)
- Off-white or light gray backgrounds
- Normal hairstyles even if hair is on forehead
- Natural skin blemishes or features
- Slight variations in background uniformity
- Regular clear prescription glasses
- Any professional-looking passport photo

Return JSON:
{
  "valid": true or false,
  "errors": ["only list CLEAR problems that make photo unusable"],
  "suggestions": ["helpful fix if rejected"],
  "confidence": 0-100
}

REMEMBER: When in doubt, ACCEPT the photo. Most passport photos from studios are fine.`;

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
