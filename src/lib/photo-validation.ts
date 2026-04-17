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
const PHOTO_VALIDATION_PROMPT = `You are part of an authorized employee onboarding system. The person has uploaded their photo with explicit consent for employment visa processing as required by UAE labor law.

Check this passport photo against these requirements:

1. White background
2. Face takes up 70-80% of photo (head to top of shoulders visible)
3. Eyes open and clearly visible, no hair covering eyes or face
4. No glasses
5. No harsh shadows on face, no flash reflection, no red-eye

If it looks like a professional passport photo, accept it. Use common sense - don't reject for minor imperfections that any real passport office would accept.

Call the validate_photo tool with your assessment.`;

const PHOTO_VALIDATION_TOOL = {
  name: 'validate_photo',
  description: 'Validate a passport photo against UAE visa requirements.',
  input_schema: {
    type: 'object' as const,
    properties: {
      valid: { type: 'boolean', description: 'true if photo meets requirements' },
      errors: { type: 'array', items: { type: 'string' }, description: 'Which requirements failed' },
      suggestions: { type: 'array', items: { type: 'string' }, description: 'How to fix issues' },
      confidence: { type: 'number', description: 'Confidence 0-100' },
    },
    required: ['valid'],
  },
};

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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [PHOTO_VALIDATION_TOOL],
        tool_choice: { type: 'tool' as const, name: PHOTO_VALIDATION_TOOL.name },
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
              { type: 'text', text: PHOTO_VALIDATION_PROMPT },
            ],
          },
        ],
      }),
      30000
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlock = response.content.find((b: any) => b.type === 'tool_use') as
      | { type: 'tool_use'; input: Record<string, unknown> }
      | undefined;

    if (!toolUseBlock) {
      throw new Error('No tool_use response from Claude');
    }

    const parsed = toolUseBlock.input as {
      valid?: boolean;
      errors?: string[];
      suggestions?: string[];
      confidence?: number;
    };

    return {
      valid: !!parsed.valid,
      errors: parsed.errors || [],
      suggestions: parsed.suggestions || [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
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
