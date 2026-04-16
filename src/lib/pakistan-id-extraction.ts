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

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "cnic_number": "...",
  "full_name": "...",
  "father_name": "...",
  "date_of_birth": "...",
  "gender": "...",
  "issue_date": "...",
  "expiry_date": "...",
  "address": "full address as shown on card",
  "address_city": "city name extracted from address (e.g. Lahore, Karachi, Islamabad)",
  "confidence": {
    "cnic_number": "high|medium|low",
    "issue_date": "high|medium|low",
    "expiry_date": "high|medium|low"
  }
}

If this is NOT a Pakistani National ID, respond with: {"error": "not_pakistan_id", "cnic_number": null}

Use null for any field you cannot read.`;

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

    const jsonStr = textContent.text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const parsed = JSON.parse(jsonStr);

    // Check if the AI rejected it as not a Pakistan ID
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
        cnic_number: parsed.cnic_number || undefined,
        full_name: parsed.full_name || undefined,
        father_name: parsed.father_name || undefined,
        date_of_birth: parsed.date_of_birth || undefined,
        gender: parsed.gender || undefined,
        issue_date: parsed.issue_date || undefined,
        expiry_date: parsed.expiry_date || undefined,
        address: parsed.address || undefined,
        address_city: parsed.address_city || undefined,
      },
      confidence: parsed.confidence || {},
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
