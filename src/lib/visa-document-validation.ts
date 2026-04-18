/**
 * Visa Document Validation for Staff Onboarding
 *
 * Uses Claude Vision to verify uploaded visa documents match the expected category
 * and are legible/genuine.
 */

import Anthropic from '@anthropic-ai/sdk';
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

    // Detect if PDF or image
    const isPdf = imageBase64.startsWith('data:application/pdf') || imageBase64.includes('application/pdf');
    let base64Data = imageBase64;
    let detectedMediaType = 'image/jpeg';

    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,/);
      if (match) detectedMediaType = match[1];
      base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
    }

    // Build content block — PDF uses 'document' type, images use 'image' type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileContent: any = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
      : { type: 'image', source: { type: 'base64', media_type: detectedMediaType, data: base64Data } };

    const response = await withTimeout(
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        tools: [
          {
            name: 'validate_visa_document',
            description: 'Validate whether an uploaded document is a legitimate UAE visa/immigration document',
            input_schema: {
              type: 'object' as const,
              properties: {
                valid: { type: 'boolean', description: 'true if this is a legible UAE immigration/visa document' },
                detected_type: { type: 'string', description: 'What type of document this appears to be' },
                details: { type: 'string', description: 'Brief explanation of what is visible' },
                errorMessage: { type: 'string', description: 'If invalid, explain why. Null if valid.' },
                expiry_date: { type: 'string', description: 'Expiry date in DD.MM.YYYY if visible, null otherwise' },
              },
              required: ['valid', 'details'],
            },
          },
        ],
        tool_choice: { type: 'tool' as const, name: 'validate_visa_document' },
        messages: [
          {
            role: 'user',
            content: [
              fileContent,
              {
                type: 'text',
                text: `This is an authorized employee onboarding system. Validate if this is a "${expectedLabel}" for UAE visa/immigration. Be lenient — if it's a legible immigration document, mark valid.`,
              },
            ],
          },
        ],
      }),
      30000
    );

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      return { valid: false, details: '', errorMessage: 'No response from AI' };
    }

    const parsed = toolUseBlock.input as Record<string, unknown>;

    return {
      valid: !!parsed.valid,
      details: String(parsed.details || ''),
      errorMessage: parsed.errorMessage ? String(parsed.errorMessage) : undefined,
      detected_type: parsed.detected_type ? String(parsed.detected_type) : undefined,
      expiry_date: parsed.expiry_date ? String(parsed.expiry_date) : undefined,
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
