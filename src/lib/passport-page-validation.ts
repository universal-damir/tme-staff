/**
 * Passport Page Type Validation
 *
 * Uses Claude Vision with tool_use to validate passport page layout.
 * tool_use forces structured output and prevents model refusals.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, withTimeout } from './anthropic';

export type PassportPageType = 'COVER' | 'INSIDE_PAGES' | 'INVALID';

export interface PassportPageValidationResult {
  page_type: PassportPageType;
  confidence: number;
  details: string;
}

const COVER_PROMPT = `Check if this passport is spread open (book opened flat). Valid = passport is open showing two halves with a spine/fold/crease between them. One half typically has the national emblem/text (front cover), the other half may be plain or blank (back cover) — a plain back cover is NORMAL and VALID. Invalid = passport is closed, only a single page photographed without the other half, or not a passport at all. If you can see a spine/fold/crease dividing two halves, it is VALID.`;

const INSIDE_PROMPT = `Count how many passport pages are visible. Valid = 2 pages visible (data page AND opposite page, spread open). Invalid = only 1 page visible or not a passport.`;

/**
 * Validate passport page using tool_use (prevents model refusals)
 */
export async function validatePassportPage(
  imageBase64: string,
  expectedType?: PassportPageType
): Promise<PassportPageValidationResult> {
  const client = getAnthropicClient();

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (imageBase64.includes('data:image/png')) mediaType = 'image/png';
  else if (imageBase64.includes('data:image/gif')) mediaType = 'image/gif';
  else if (imageBase64.includes('data:image/webp')) mediaType = 'image/webp';

  const prompt = expectedType === 'INSIDE_PAGES' ? INSIDE_PROMPT : COVER_PROMPT;

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        tools: [
          {
            name: 'validate_passport_page',
            description: 'Report whether the passport page layout is valid (spread open with both pages visible)',
            input_schema: {
              type: 'object' as const,
              properties: {
                valid: {
                  type: 'boolean',
                  description: 'true if passport is spread open showing required pages, false otherwise',
                },
                reason: {
                  type: 'string',
                  description: 'Brief explanation of what is visible in the image',
                },
              },
              required: ['valid', 'reason'],
            },
          },
        ],
        tool_choice: { type: 'tool' as const, name: 'validate_passport_page' },
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
      30000
    );

    // Extract tool_use result — guaranteed structured output
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      throw new Error('No tool_use response');
    }

    const result = toolUseBlock.input as { valid: boolean; reason: string };
    console.log('[Passport Validation] Result:', result);

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
    return {
      page_type: 'INVALID',
      confidence: 0,
      details: 'Unable to validate passport page. Please try again.',
    };
  }
}
