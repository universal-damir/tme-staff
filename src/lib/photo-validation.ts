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
const PHOTO_VALIDATION_PROMPT = `Analyze this passport/visa photo against official UAE visa photo requirements.

Check ALL of the following criteria carefully:

1. BACKGROUND: Must be white or uniform light color (no patterns, objects, or other people visible)
2. FACE SIZE: Face should occupy approximately 70-80% of the photo height
3. FOCUS: Image must be sharp and clear, not blurry or pixelated
4. GAZE: Person must be looking directly at the camera
5. EYES: Both eyes must be open and clearly visible
6. HAIR: No hair should cover the eyes or face
7. ANGLE: Face must be square to the camera (not turned to the side/portrait style)
8. TILT: Head must not be tilted to either side
9. GLASSES: No glasses allowed (even clear lenses)
10. HEAD COVERING: Only permitted for religious reasons; if present, face from chin to forehead and both cheeks must still be fully visible
11. EXPRESSION: Neutral expression with mouth closed (no smiling)
12. FACE SHADOWS: No shadows across the face
13. BACKGROUND SHADOWS: No shadows behind the head
14. FLASH: No flash reflection or glare on skin
15. RED-EYE: No red-eye effect
16. SINGLE PERSON: Only one person in the photo
17. CENTERING: Face must be centered in the frame
18. TOO CLOSE: Face should not be cropped or too close to edges
19. TOO FAR: Face should not be too small (must be 70-80% of frame)

Respond with a JSON object in exactly this format:
{
  "valid": true or false,
  "errors": ["list of specific issues found - be clear and helpful"],
  "suggestions": ["specific action to fix each error"],
  "confidence": 0-100 (how confident you are in this assessment)
}

If the photo passes all criteria, return:
{
  "valid": true,
  "errors": [],
  "suggestions": [],
  "confidence": 95
}

Be strict but fair. Only flag clear violations. If something is borderline acceptable, lean towards accepting it.`;

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
