/**
 * Passport OCR Extraction for Staff Onboarding
 *
 * Uses Claude Vision to extract data from passport images.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface PassportExtractionResult {
  success: boolean;
  data: {
    first_name?: string;
    middle_name?: string;
    family_name?: string;
    passport_no?: string;
    passport_issue_date?: string;
    passport_expiry_date?: string;
    nationality?: string;
    date_of_birth?: string;
    gender?: string;
    place_of_birth?: string;
  };
  confidence: {
    passport_no?: 'high' | 'medium' | 'low';
    expiry_date?: 'high' | 'medium' | 'low';
  };
  mrz_verified: boolean;
  error?: string;
}

/**
 * Passport extraction prompt
 */
const PASSPORT_EXTRACTION_PROMPT = `Extract information from this passport image.

Look for and extract:
1. First name (given name only - the FIRST given name, not middle names)
2. Middle name(s) (all names between first name and family name)
3. Family name / Surname
4. Passport number (usually near top right, 6-9 alphanumeric characters)
5. Issue date (date of issue)
6. Expiry date (date of expiry)
7. Nationality / Citizenship
8. Date of birth
9. Gender (Male/Female)
10. Place of birth

IMPORTANT formatting rules:
- Convert ALL dates to DD.MM.YYYY format (e.g., 15.03.2025)
- Convert names from ALL CAPS to Title Case (e.g., JOHN SMITH → John Smith)
- Keep passport number in original format (usually uppercase)

Also check the MRZ (Machine Readable Zone - the two lines of characters at the bottom of the passport):
- Verify passport number matches
- Verify expiry date matches
- If MRZ is readable, use it to cross-verify extracted data

Respond with a JSON object in exactly this format:
{
  "success": true,
  "data": {
    "first_name": "John",
    "middle_name": "Michael",
    "family_name": "Smith",
    "passport_no": "X12345678",
    "passport_issue_date": "15.03.2020",
    "passport_expiry_date": "15.03.2030",
    "nationality": "United Kingdom",
    "date_of_birth": "25.12.1985",
    "gender": "Male",
    "place_of_birth": "London"
  },
  "confidence": {
    "passport_no": "high",
    "expiry_date": "high"
  },
  "mrz_verified": true
}

If a field is not visible or cannot be extracted, omit it from the data object.
If you cannot read the passport at all, return:
{
  "success": false,
  "data": {},
  "confidence": {},
  "mrz_verified": false,
  "error": "Description of the problem"
}`;

/**
 * Extract data from a passport image using Claude Vision
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @returns PassportExtractionResult
 */
export async function extractPassport(imageBase64: string): Promise<PassportExtractionResult> {
  const client = getAnthropicClient();

  // Remove data URL prefix if present
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const isPdf = imageBase64.includes('data:application/pdf');

  // Detect media type
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (imageBase64.includes('data:image/png')) {
    mediaType = 'image/png';
  } else if (imageBase64.includes('data:image/gif')) {
    mediaType = 'image/gif';
  } else if (imageBase64.includes('data:image/webp')) {
    mediaType = 'image/webp';
  }

  // For PDFs, we need to handle differently
  if (isPdf) {
    return {
      success: false,
      data: {},
      confidence: {},
      mrz_verified: false,
      error: 'Please upload an image file (JPG or PNG) of your passport, not a PDF.',
    };
  }

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-20250514', // Sonnet for better accuracy
        max_tokens: 2048,
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
                text: PASSPORT_EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
      45000 // 45 second timeout for extraction
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

    const result = JSON.parse(jsonMatch[0]) as PassportExtractionResult;

    // Validate response structure
    if (typeof result.success !== 'boolean') {
      throw new Error('Invalid response: missing success field');
    }

    return {
      success: result.success,
      data: result.data || {},
      confidence: result.confidence || {},
      mrz_verified: result.mrz_verified || false,
      error: result.error,
    };
  } catch (error) {
    console.error('Passport extraction error:', error);

    // Return a safe error response
    return {
      success: false,
      data: {},
      confidence: {},
      mrz_verified: false,
      error: 'Unable to extract passport data. Please ensure the image is clear and try again.',
    };
  }
}
