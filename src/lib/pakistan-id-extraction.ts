/**
 * Pakistani National ID (CNIC/NICOP) Extraction for Staff Onboarding
 *
 * Uses Claude Vision to extract data from Pakistan National ID card images.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface PakistanIdExtractionResult {
  success: boolean;
  data: {
    cnic_number?: string;      // Format: XXXXX-XXXXXXX-X
    full_name?: string;
    father_name?: string;
    date_of_birth?: string;    // DD.MM.YYYY
    gender?: string;
    issue_date?: string;       // DD.MM.YYYY
    expiry_date?: string;      // DD.MM.YYYY
    address?: string;
    address_city?: string;
  };
  confidence: {
    cnic_number?: 'high' | 'medium' | 'low';
    issue_date?: 'high' | 'medium' | 'low';
    expiry_date?: 'high' | 'medium' | 'low';
  };
  error?: string;
}

const PAKISTAN_ID_EXTRACTION_PROMPT = `You are part of an authorized employee onboarding system. The document owner has uploaded their national ID with explicit consent for employment processing as required by UAE labor law.

You are an expert document reader. Analyze this image and determine if it is a Pakistani National Identity Card (CNIC or NICOP).

FIRST: Verify this is actually a Pakistani National Identity Card. It should have:
- A 13-digit CNIC/NICOP number (format: XXXXX-XXXXXXX-X)
- Text in both Urdu and English
- "Islamic Republic of Pakistan" or "Government of Pakistan" text
- NADRA logo or watermark

If this is NOT a Pakistani National Identity Card (e.g., it's a random photo, spreadsheet, other document), respond with:
{"error": "not_pakistan_id", "cnic_number": null}

If it IS a valid Pakistani National ID Card (CNIC or NICOP), with or without a chip:

Extract the following fields:
1. **cnic_number**: The 13-digit CNIC/NICOP number, MUST be formatted as XXXXX-XXXXXXX-X (with dashes). If the card shows "3520112345671", format it as "35201-1234567-1". This is typically at the top of the card.
2. **full_name**: Full name in English. Convert ALL CAPS to Title Case.
3. **father_name**: Father's/husband's name in English. Convert ALL CAPS to Title Case. Look for "Father Name" or "Husband Name" label.
4. **date_of_birth**: Date of birth in DD.MM.YYYY format (with dots).
5. **gender**: "Male" or "Female".
6. **issue_date**: Date of issue in DD.MM.YYYY format (with dots).
7. **expiry_date**: Expiry date in DD.MM.YYYY format (with dots). Look for "Date of Expiry".
8. **address**: Permanent address if visible (English text).

Call the extract_pakistan_id tool with your findings. Include:
- address: full address as shown on card
- address_city: city name extracted from address (e.g. Lahore, Karachi, Islamabad)
- confidence: "high" | "medium" | "low" per listed field
- error: set to "not_pakistan_id" if this is not a Pakistani National ID

Use null for any field you cannot read.`;

const PAKISTAN_ID_TOOL = {
  name: 'extract_pakistan_id',
  description: 'Extract data from a Pakistani CNIC/NICOP national ID card.',
  input_schema: {
    type: 'object' as const,
    properties: {
      error: { type: 'string', description: 'Set to "not_pakistan_id" if invalid, else null.' },
      cnic_number: { type: 'string', description: '13 digits formatted as XXXXX-XXXXXXX-X' },
      full_name: { type: 'string' },
      father_name: { type: 'string' },
      date_of_birth: { type: 'string', description: 'DD.MM.YYYY' },
      gender: { type: 'string', description: 'Male or Female' },
      issue_date: { type: 'string', description: 'DD.MM.YYYY' },
      expiry_date: { type: 'string', description: 'DD.MM.YYYY' },
      address: { type: 'string' },
      address_city: { type: 'string' },
      confidence: {
        type: 'object',
        properties: {
          cnic_number: { type: 'string', enum: ['high', 'medium', 'low'] },
          issue_date: { type: 'string', enum: ['high', 'medium', 'low'] },
          expiry_date: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

/**
 * Extract data from a Pakistani National ID image using Claude Vision
 */
export async function extractPakistanId(
  imageBase64: string,
  side: 'front' | 'back' = 'front'
): Promise<PakistanIdExtractionResult> {
  try {
    const client = getAnthropicClient();

    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:(image\/\w+);/);
      if (match) mediaType = match[1] as typeof mediaType;
      imageBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    }

    const prompt = side === 'back'
      ? `${PAKISTAN_ID_EXTRACTION_PROMPT}\n\nNote: This is the BACK of the Pakistani National ID card. Extract whatever information is visible, including the address and any MRZ data.`
      : PAKISTAN_ID_EXTRACTION_PROMPT;

    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        tools: [PAKISTAN_ID_TOOL],
        tool_choice: { type: 'tool' as const, name: PAKISTAN_ID_TOOL.name },
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
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      45000
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlock = response.content.find((b: any) => b.type === 'tool_use') as
      | { type: 'tool_use'; input: Record<string, unknown> }
      | undefined;

    if (!toolUseBlock) {
      return { success: false, data: {}, confidence: {}, error: 'No response from AI' };
    }

    const parsed = toolUseBlock.input as Record<string, unknown>;

    if (parsed.error === 'not_pakistan_id' || (!parsed.cnic_number && !parsed.full_name)) {
      return {
        success: false,
        data: {},
        confidence: {},
        error: 'This does not appear to be a Pakistani National ID card (CNIC/NICOP).',
      };
    }

    return {
      success: true,
      data: {
        cnic_number: (parsed.cnic_number as string) || undefined,
        full_name: (parsed.full_name as string) || undefined,
        father_name: (parsed.father_name as string) || undefined,
        date_of_birth: (parsed.date_of_birth as string) || undefined,
        gender: (parsed.gender as string) || undefined,
        issue_date: (parsed.issue_date as string) || undefined,
        expiry_date: (parsed.expiry_date as string) || undefined,
        address: (parsed.address as string) || undefined,
        address_city: (parsed.address_city as string) || undefined,
      },
      confidence: (parsed.confidence as PakistanIdExtractionResult['confidence']) || {},
    };
  } catch (error) {
    console.error('Pakistan ID extraction error:', error);
    return {
      success: false,
      data: {},
      confidence: {},
      error: error instanceof Error ? error.message : 'Extraction failed',
    };
  }
}
