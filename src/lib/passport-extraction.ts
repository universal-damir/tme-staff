/**
 * Passport OCR Extraction for Staff Onboarding
 *
 * Uses Claude Vision to extract data from passport images.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface PassportExtractionResult {
  success: boolean;
  data: {
    title?: string; // Mr, Mrs, Ms - inferred from gender
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
7. Nationality / Citizenship (full country name, e.g., "Germany", "India", "United Kingdom")
8. Date of birth
9. Gender (Male/Female)
10. Place of birth
11. Title (INFER from gender: Male = "Mr", Female = "Ms")

IMPORTANT formatting rules:
- Convert ALL dates to DD.MM.YYYY format (e.g., 15.03.2025)
- Convert names from ALL CAPS to Title Case (e.g., JOHN SMITH → John Smith)
- Keep passport number in original format (usually uppercase)
- Nationality must be the FULL country name (not code): "DEU" → "Germany", "GBR" → "United Kingdom", "IND" → "India", "USA" → "United States", "PAK" → "Pakistan", "PHL" → "Philippines", etc.

Also check the MRZ (Machine Readable Zone - the two lines of characters at the bottom of the passport):
- Verify passport number matches
- Verify expiry date matches
- If MRZ is readable, use it to cross-verify extracted data

Respond with a JSON object in exactly this format:
{
  "success": true,
  "data": {
    "title": "Mr",
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
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const isPdf = imageBase64.includes('data:application/pdf');

  // ALWAYS detect media type from magic bytes (more reliable than data URL prefix)
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  try {
    // Decode first 16 base64 chars (12 bytes) to check magic bytes
    const firstBytes = atob(base64Data.substring(0, 16));
    const bytes = new Uint8Array(firstBytes.length);
    for (let i = 0; i < firstBytes.length; i++) {
      bytes[i] = firstBytes.charCodeAt(i);
    }

    // Check magic bytes
    // PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      mediaType = 'image/png';
    }
    // GIF: 47 49 46 ('G' 'I' 'F')
    else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      mediaType = 'image/gif';
    }
    // WEBP: 52 49 46 46 ... 57 45 42 50 ('RIFF' ... 'WEBP')
    else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
             bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      mediaType = 'image/webp';
    }
    // JPEG: FF D8 FF
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      mediaType = 'image/jpeg';
    }
    // If no magic bytes match, fall back to data URL prefix
    else if (imageBase64.includes('data:image/png')) {
      mediaType = 'image/png';
    } else if (imageBase64.includes('data:image/gif')) {
      mediaType = 'image/gif';
    } else if (imageBase64.includes('data:image/webp')) {
      mediaType = 'image/webp';
    }
    // Default remains jpeg
  } catch {
    // If magic bytes check fails, fall back to data URL prefix
    if (imageBase64.includes('data:image/png')) {
      mediaType = 'image/png';
    } else if (imageBase64.includes('data:image/gif')) {
      mediaType = 'image/gif';
    } else if (imageBase64.includes('data:image/webp')) {
      mediaType = 'image/webp';
    }
  }

  console.log('[Passport Extraction] Detected media type:', mediaType);

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
        model: 'claude-sonnet-4-20250514', // Sonnet 4 for accuracy
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
