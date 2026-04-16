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

const EID_EXTRACTION_PROMPT = `You are part of an authorized employee onboarding system. The document owner has uploaded their Emirates ID with explicit consent for employment processing as required by UAE labor law.

You are an expert document reader. Analyze this image and determine if it is a UAE Emirates ID card.

FIRST: Verify this is actually a UAE Emirates ID card (also known as "Identity Card" / "بطاقة الهوية"). It should have:
- A 15-digit ID number at the top (format: 784-XXXX-XXXXXXX-X)
- A photo of the cardholder
- Text in both Arabic and English
- "United Arab Emirates" or "الإمارات العربية المتحدة" text

If this is NOT a UAE Emirates ID card (e.g., it's a spreadsheet, random photo, other document, or unrelated image), respond with:
{"error": "not_emirates_id", "emirates_id_number": null}

If it IS a UAE Emirates ID card, this may be an expired one — that is expected. Extract ALL data regardless of expiry date.

Extract the following fields:
1. **emirates_id_number**: The 15-digit ID number, MUST be formatted as XXX-XXXX-XXXXXXX-X (with dashes). If the card shows "784123412345671", format it as "784-1234-1234567-1". This is typically at the top of the card.
2. **first_name**: Given/first name(s) in English. Convert ALL CAPS to Title Case (e.g., "JOHN" → "John").
3. **family_name**: Surname/family name in English. Convert ALL CAPS to Title Case.
4. **nationality**: Full country name in English (e.g., "Indian", "Pakistani", not country codes).
5. **issue_date**: Date of issue in DD.MM.YYYY format (with dots, not slashes).
6. **expiry_date**: Expiry date in DD.MM.YYYY format (with dots, not slashes).
7. **date_of_birth**: Date of birth in DD.MM.YYYY format if visible.
8. **gender**: "Male" or "Female" if visible.

If the back of the card is visible with MRZ (3 lines), use it to verify the ID number.

If this IS a valid Emirates ID, respond ONLY with a JSON object (no markdown, no code fences):
{
  "emirates_id_number": "...",
  "first_name": "...",
  "family_name": "...",
  "nationality": "...",
  "issue_date": "...",
  "expiry_date": "...",
  "date_of_birth": "...",
  "gender": "...",
  "confidence": {
    "emirates_id_number": "high|medium|low",
    "issue_date": "high|medium|low",
    "expiry_date": "high|medium|low"
  }
}

If this is NOT an Emirates ID, respond with: {"error": "not_emirates_id", "emirates_id_number": null}

Use null for any field you cannot read. For confidence, use "high" if clearly visible, "medium" if partially obscured, "low" if guessing.`;

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

    const prompt = side === 'back'
      ? `You are part of an authorized employee onboarding system. The document owner has uploaded their Emirates ID with explicit consent for employment processing as required by UAE labor law.

You are an expert document reader. Analyze this image and determine if it is the BACK of a UAE Emirates ID card.

The BACK of a UAE Emirates ID should contain:
- MRZ (Machine Readable Zone): 3 lines of encoded text at the bottom (characters like < mixed with letters/numbers)
- May show: Card Number, Occupation/Title, Employer name, Issuing Place
- Should NOT be a front side (no photo, no 15-digit ID number at the top)

If this is NOT the back of a UAE Emirates ID card (e.g., it's a random photo, spreadsheet, or unrelated document), respond with:
{"error": "not_emirates_id_back", "is_valid_back": false}

If it IS the back of an Emirates ID, respond with a JSON object (no markdown, no code fences):
{
  "is_valid_back": true,
  "card_number": "if visible",
  "occupation": "if visible",
  "employer": "if visible"
}

Use null for any field you cannot read.`
      : EID_EXTRACTION_PROMPT;

    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
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
                  data: imageBase64,
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
      45000
    );

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return { success: false, data: {}, confidence: {}, error: 'No text response from AI' };
    }

    // Parse JSON response
    const jsonStr = textContent.text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const parsed = JSON.parse(jsonStr);

    // Check if the AI rejected it
    if (side === 'back') {
      // Back side: check for back-specific rejection
      if (parsed.error === 'not_emirates_id_back' || parsed.is_valid_back === false) {
        return {
          success: false,
          data: {},
          confidence: {},
          error: 'This does not appear to be the back of a UAE Emirates ID card.',
        };
      }
      // Back is valid — return success with whatever data was found
      return {
        success: true,
        data: {
          emirates_id_number: parsed.card_number || undefined,
        },
        confidence: {},
      };
    }

    // Front side: must have emirates_id_number
    if (parsed.error === 'not_emirates_id' || (!parsed.emirates_id_number && !parsed.first_name && !parsed.family_name)) {
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
        emirates_id_number: parsed.emirates_id_number || undefined,
        first_name: parsed.first_name || undefined,
        family_name: parsed.family_name || undefined,
        nationality: parsed.nationality || undefined,
        issue_date: parsed.issue_date || undefined,
        expiry_date: parsed.expiry_date || undefined,
        date_of_birth: parsed.date_of_birth || undefined,
        gender: parsed.gender || undefined,
      },
      confidence: parsed.confidence || {},
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
