/**
 * Visa Document Validation for Staff Onboarding
 *
 * Uses Claude Vision to verify uploaded visa documents match the expected category
 * and are legible/genuine.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface VisaDocumentValidationResult {
  valid: boolean;
  details: string;
  errorMessage?: string;
  detected_type?: string;
  expiry_date?: string;
}

const VISA_CATEGORY_LABELS: Record<string, string> = {
  tourist_visa: 'Tourist Visa',
  employment_visa: 'Employment Visa',
  immigration_cancellation: 'Immigration Cancellation document',
  other_na: 'visa or immigration document',
};

/**
 * Validate a visa document image using Claude Vision
 */
export async function validateVisaDocument(
  imageBase64: string,
  expectedCategory: string
): Promise<VisaDocumentValidationResult> {
  try {
    const client = getAnthropicClient();
    const expectedLabel = VISA_CATEGORY_LABELS[expectedCategory] || 'visa document';

    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:(image\/\w+);/);
      if (match) mediaType = match[1] as typeof mediaType;
      imageBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    }

    const response = await withTimeout(
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
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
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: `You are part of an authorized employee onboarding system. The document owner has uploaded this visa document with explicit consent for employment processing as required by UAE labor law.

Analyze this document image. The user claims it is a "${expectedLabel}" for a UAE visa/immigration purpose.

Verify:
1. Is this document related to UAE immigration/visa? (It should be a UAE-issued document or immigration-related)
2. Does it appear to match the expected type: "${expectedLabel}"?
3. Is the document legible and appears genuine (not blank, not a random photo)?
4. If dates are visible, what is the expiry date?

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "valid": true/false,
  "detected_type": "what type of document this appears to be",
  "details": "brief explanation of what you see",
  "errorMessage": "if invalid, explain why (null if valid)",
  "expiry_date": "DD.MM.YYYY if visible, null otherwise"
}

Be lenient — if it's a UAE immigration/visa related document and is legible, mark it as valid even if the exact type doesn't perfectly match. The important thing is that it's a real, legible immigration document.`,
              },
            ],
          },
        ],
      }),
      30000
    );

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return { valid: false, details: '', errorMessage: 'No response from AI' };
    }

    const jsonStr = textContent.text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const parsed = JSON.parse(jsonStr);

    return {
      valid: !!parsed.valid,
      details: parsed.details || '',
      errorMessage: parsed.errorMessage || undefined,
      detected_type: parsed.detected_type || undefined,
      expiry_date: parsed.expiry_date || undefined,
    };
  } catch (error) {
    console.error('Visa document validation error:', error);
    return {
      valid: false,
      details: '',
      errorMessage: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}
