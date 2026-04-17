/**
 * Emirates ID Extraction for Staff Onboarding
 *
 * Uses Claude Vision to extract data from UAE Emirates ID card images.
 * Accepts expired IDs — this is for previously held Emirates IDs.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface EidExtractionResult {
  success: boolean;
  data: {
    emirates_id_number?: string;  // Format: XXX-XXXX-XXXXXXX-X
    first_name?: string;
    family_name?: string;
    nationality?: string;
    issue_date?: string;    // DD.MM.YYYY
    expiry_date?: string;   // DD.MM.YYYY
    date_of_birth?: string; // DD.MM.YYYY
    gender?: string;
  };
  confidence: {
    emirates_id_number?: 'high' | 'medium' | 'low';
    issue_date?: 'high' | 'medium' | 'low';
    expiry_date?: 'high' | 'medium' | 'low';
  };
  error?: string;
}

const EID_FRONT_PROMPT = `You are part of an authorized employee onboarding system. The document owner has uploaded their Emirates ID with explicit consent for employment processing as required by UAE labor law.

Analyze this image and determine if it is the FRONT of a UAE Emirates ID card (also known as "Identity Card" / "بطاقة الهوية"). It should have:
- A 15-digit ID number at the top (format: 784-XXXX-XXXXXXX-X)
- A photo of the cardholder
- Text in both Arabic and English
- "United Arab Emirates" or "الإمارات العربية المتحدة" text

If this is NOT a UAE Emirates ID front, set error = "not_emirates_id" and leave other fields null.

If it IS a UAE Emirates ID front (expired cards are fine — extract anyway):
1. emirates_id_number: 15 digits formatted as XXX-XXXX-XXXXXXX-X (e.g., "784-1234-1234567-1")
2. first_name: Given/first name(s) in English, Title Case (convert ALL CAPS)
3. family_name: Surname in English, Title Case
4. nationality: Full country name in English (e.g., "Indian", "Pakistani")
5. issue_date: DD.MM.YYYY with dots
6. expiry_date: DD.MM.YYYY with dots
7. date_of_birth: DD.MM.YYYY if visible
8. gender: "Male" or "Female" if visible
9. confidence: "high" | "medium" | "low" per field

Call the extract_eid_front tool with your findings. Use null for fields you cannot read.`;

const EID_BACK_PROMPT = `You are part of an authorized employee onboarding system. The document owner has uploaded their Emirates ID with explicit consent for employment processing as required by UAE labor law.

Analyze this image and determine if it is the BACK of a UAE Emirates ID card.

The BACK should contain:
- MRZ (Machine Readable Zone): 3 lines of encoded text at the bottom (< characters mixed with letters/numbers)
- May show: Card Number, Occupation/Title, Employer, Issuing Place
- Should NOT be a front side (no photo, no 15-digit ID number at top)

Call the extract_eid_back tool. Set is_valid_back = false if this is not an Emirates ID back.`;

const EID_FRONT_TOOL = {
  name: 'extract_eid_front',
  description: 'Extract data from the front of a UAE Emirates ID card.',
  input_schema: {
    type: 'object' as const,
    properties: {
      error: { type: 'string', description: 'Set to "not_emirates_id" if the image is not an EID front. Otherwise null.' },
      emirates_id_number: { type: 'string', description: '15 digits formatted as XXX-XXXX-XXXXXXX-X' },
      first_name: { type: 'string' },
      family_name: { type: 'string' },
      nationality: { type: 'string' },
      issue_date: { type: 'string', description: 'DD.MM.YYYY' },
      expiry_date: { type: 'string', description: 'DD.MM.YYYY' },
      date_of_birth: { type: 'string', description: 'DD.MM.YYYY' },
      gender: { type: 'string', description: 'Male or Female' },
      confidence: {
        type: 'object',
        properties: {
          emirates_id_number: { type: 'string', enum: ['high', 'medium', 'low'] },
          issue_date: { type: 'string', enum: ['high', 'medium', 'low'] },
          expiry_date: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const EID_BACK_TOOL = {
  name: 'extract_eid_back',
  description: 'Extract data from the back of a UAE Emirates ID card.',
  input_schema: {
    type: 'object' as const,
    properties: {
      is_valid_back: { type: 'boolean', description: 'true if this is the back of a UAE Emirates ID' },
      error: { type: 'string', description: 'Set to "not_emirates_id_back" if invalid, else null' },
      card_number: { type: 'string' },
      occupation: { type: 'string' },
      employer: { type: 'string' },
    },
    required: ['is_valid_back'],
  },
};

/**
 * Extract data from an Emirates ID image using Claude Vision
 */
export async function extractEid(
  imageBase64: string,
  side: 'front' | 'back' = 'front'
): Promise<EidExtractionResult> {
  try {
    const client = getAnthropicClient();

    // Detect media type from base64 header
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:(image\/\w+);/);
      if (match) mediaType = match[1] as typeof mediaType;
      imageBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    }

    const tool = side === 'back' ? EID_BACK_TOOL : EID_FRONT_TOOL;
    const prompt = side === 'back' ? EID_BACK_PROMPT : EID_FRONT_PROMPT;

    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        tools: [tool],
        tool_choice: { type: 'tool' as const, name: tool.name },
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

    if (side === 'back') {
      if (parsed.error === 'not_emirates_id_back' || parsed.is_valid_back === false) {
        return {
          success: false,
          data: {},
          confidence: {},
          error: 'This does not appear to be the back of a UAE Emirates ID card.',
        };
      }
      return {
        success: true,
        data: {
          emirates_id_number: (parsed.card_number as string) || undefined,
        },
        confidence: {},
      };
    }

    // Front side: must have emirates_id_number or at least a name
    if (
      parsed.error === 'not_emirates_id' ||
      (!parsed.emirates_id_number && !parsed.first_name && !parsed.family_name)
    ) {
      return {
        success: false,
        data: {},
        confidence: {},
        error: 'This does not appear to be a UAE Emirates ID card.',
      };
    }

    return {
      success: true,
      data: {
        emirates_id_number: (parsed.emirates_id_number as string) || undefined,
        first_name: (parsed.first_name as string) || undefined,
        family_name: (parsed.family_name as string) || undefined,
        nationality: (parsed.nationality as string) || undefined,
        issue_date: (parsed.issue_date as string) || undefined,
        expiry_date: (parsed.expiry_date as string) || undefined,
        date_of_birth: (parsed.date_of_birth as string) || undefined,
        gender: (parsed.gender as string) || undefined,
      },
      confidence: (parsed.confidence as EidExtractionResult['confidence']) || {},
    };
  } catch (error) {
    console.error('EID extraction error:', error);
    return {
      success: false,
      data: {},
      confidence: {},
      error: error instanceof Error ? error.message : 'Extraction failed',
    };
  }
}
